'use strict';

// FlowLever cockpit server — JSON API per docs/SCHEMA.md "HTTP API" + static web/.
// Node built-ins only. Same-origin usage; no CORS headers on purpose.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const ledger = require('./ledger');
const { generateReport } = require('./report');

const PORT = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 4173;
const WEB_DIR = path.resolve(__dirname, '..', 'web');
const BODY_LIMIT = 2 * 1024 * 1024; // 2MB
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

// EUSER from the ledger is either "thing not found" (→404) or bad input (→400).
function euserStatus(err) {
  return /not found|no such|does not exist|unknown feature|unknown finding/i.test(err.message) ? 404 : 400;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        const err = new Error('Request body exceeds 2MB limit');
        err.code = 'ETOOBIG';
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const err = new Error('Request body is not valid JSON');
    err.code = 'EBADJSON';
    throw err;
  }
}

// Same return-shape tolerance as the CLI: validateIngestFinding may throw,
// return an error string, an array of errors, or { errors: [...] }.
function findingError(f, idx) {
  let res;
  try {
    res = ledger.validateIngestFinding(f);
  } catch (err) {
    return `Finding #${idx + 1} invalid: ${err.message}`;
  }
  let errors = [];
  if (typeof res === 'string' && res) errors = [res];
  else if (Array.isArray(res)) errors = res;
  else if (res && typeof res === 'object' && Array.isArray(res.errors)) errors = res.errors;
  else if (res === false) errors = ['failed validation'];
  return errors.length ? `Finding #${idx + 1} invalid: ${errors.join('; ')}` : null;
}

// ---------- API handlers ----------

function handleFeatureList(res, kindFilter) {
  let features = ledger.listFeatures() || [];
  if (kindFilter) features = features.filter((f) => (f.kind || 'spec') === kindFilter);
  const summaries = features.map((f) => {
    let readiness = null;
    try {
      const r = ledger.readiness(f.id);
      readiness = { score: r.score, gate: r.gate, openCount: r.openCount, openBySeverity: r.openBySeverity };
    } catch { /* feature without ledger yet */ }
    const s = f.sources || {};
    const sourceCounts = {
      confluence: (s.confluence || []).length,
      ado: (s.ado || []).length,
      figma: (s.figma || []).length,
    };
    let lastRoundAt = null;
    try {
      const rounds = (ledger.loadRounds(f.id).rounds) || [];
      if (rounds.length) lastRoundAt = rounds[rounds.length - 1].at;
    } catch { /* no rounds yet */ }
    const findings = (ledger.loadLedger(f.id).findings) || [];
    const awaitingAuthor = findings.some((fd) => fd.postedAt && (fd.status === 'open' || fd.status === 'reworking'));
    return {
      id: f.id,
      title: f.title,
      kind: f.kind || 'spec',
      status: f.status,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      sourceCounts,
      lastRoundAt,
      readiness,
      awaitingAuthor,                                          // has posted, unaddressed comments
      authorResponded: !!(f.review && f.review.authorRespondedAt),
      reviewNote: (f.review && f.review.note) || null,
    };
  });
  sendJson(res, 200, summaries);
}

// Cross-kind inbox: one summary per workspace with the "what needs you" counts,
// sorted so the most actionable surface first (most toReview, then most open).
// toReview = open/reworking findings carrying a proposed change (draft).
function handleHome(res) {
  const features = ledger.listFeatures() || [];
  const rows = features.map((f) => {
    const findings = (ledger.loadLedger(f.id).findings) || [];
    const counts = { toReview: 0, open: 0, reworking: 0, posted: 0, resolved: 0, waived: 0 };
    for (const fd of findings) {
      const live = fd.status === 'open' || fd.status === 'reworking';
      // Posted findings are awaiting the author, not the reviewer: count them under `posted`,
      // never as `reworking` or `toReview`, so the inbox stops re-surfacing what's already out.
      if (live && fd.postedAt) { counts.posted += 1; continue; }
      if (counts[fd.status] !== undefined) counts[fd.status] += 1;
      if (live && fd.draft) counts.toReview += 1;
    }
    let readiness = { score: 0, gate: 'in-progress' };
    try {
      const r = ledger.readiness(f.id);
      readiness = { score: r.score, gate: r.gate };
    } catch { /* feature without ledger yet */ }
    return {
      id: f.id, title: f.title, kind: f.kind || 'spec', status: f.status, readiness, counts,
      authorResponded: !!(f.review && f.review.authorRespondedAt),
    };
  });
  rows.sort((a, b) =>
    // Completed workspaces sink to the bottom of the inbox.
    (Number(a.status === 'done') - Number(b.status === 'done')) ||
    (b.counts.toReview - a.counts.toReview) ||
    (b.counts.open - a.counts.open) ||
    (b.counts.reworking - a.counts.reworking) ||
    a.title.localeCompare(b.title));
  sendJson(res, 200, rows);
}

function handleFeatureDetail(res, id) {
  const feature = ledger.getFeature(id);
  sendJson(res, 200, {
    feature,
    ledger: ledger.loadLedger(id),
    rounds: ledger.loadRounds(id),
    readiness: ledger.readiness(id),
  });
}

// Set a workspace's lifecycle status — used by the "Mark review complete" / "Reopen"
// buttons (status:'done' / status:'reworking').
async function handleFeatureStatus(req, res, id) {
  const body = await readJsonBody(req);
  if (typeof body.status !== 'string') return sendError(res, 400, 'Body must include a status string');
  try {
    const feature = ledger.setFeatureStatus(id, body.status);
    sendJson(res, 200, feature);
  } catch (e) {
    sendError(res, e.code === 'EUSER' ? 400 : 500, e.message);
  }
}

// The "waiting on author" tracker. The /flowlever:watch runner POSTs here when it detects new
// author activity on the PR (authorResponded:true + a note), or the UI clears it on re-review.
async function handleFeatureActivity(req, res, id) {
  const body = await readJsonBody(req);
  const patch = {};
  if (body.authorResponded !== undefined) {
    patch.authorRespondedAt = body.authorResponded ? (typeof body.at === 'string' ? body.at : new Date().toISOString()) : null;
    if (!body.authorResponded) patch.note = null;
  }
  if (body.note !== undefined) patch.note = body.note;
  if (body.lastPostedAt !== undefined) patch.lastPostedAt = body.lastPostedAt;
  if (Object.keys(patch).length === 0) {
    return sendError(res, 400, 'Body must include authorResponded, note and/or lastPostedAt');
  }
  try {
    const feature = ledger.setFeatureReview(id, patch);
    sendJson(res, 200, feature);
  } catch (e) {
    sendError(res, e.code === 'EUSER' ? 400 : 500, e.message);
  }
}

async function handleFindingUpdate(req, res, id, fp) {
  const body = await readJsonBody(req);
  let finding;
  // Optional comment-body edit (the pr-review "Edit comment" action): the finding's
  // `suggestion` IS the proposed PR comment, so persist it via setFindingDetails.
  if (body.suggestion !== undefined) {
    finding = ledger.setFindingDetails(id, fp, { suggestion: body.suggestion, by: 'user' });
  }
  // The reviewer's triage decision (approve/edit, or null to undo) — persisted so the board,
  // stepper and Post screen agree and survive a refresh. A status change (below) clears it.
  if (body.decision !== undefined) {
    finding = ledger.setFindingDecision(id, fp, body.decision, { by: 'user' });
  }
  // The reviewer's free-text note on the finding (their objection / answer to a clarifying
  // question) — distinct from the audit suggestion; lets suggestion-only items carry a response.
  if (body.note !== undefined) {
    finding = ledger.setFindingNote(id, fp, body.note, { by: 'user' });
  }
  const change = { by: 'user' };
  if (body.status !== undefined) change.status = body.status;
  if (body.reason !== undefined) change.reason = body.reason;
  if (body.pinned !== undefined) change.pinned = body.pinned;
  if (change.status !== undefined || change.pinned !== undefined) {
    finding = ledger.setFindingStatus(id, fp, change);
  } else if (body.suggestion === undefined && body.decision === undefined && body.note === undefined) {
    return sendError(res, 400, 'Body must include status, pinned, suggestion, decision and/or note');
  }
  sendJson(res, 200, finding);
}

async function handleDraftSet(req, res, id, fp) {
  const body = await readJsonBody(req);
  if (typeof body.before !== 'string' || typeof body.after !== 'string') {
    return sendError(res, 400, 'Body must include before and after strings');
  }
  const finding = ledger.setFindingDraft(id, fp, {
    target: body.target,
    targetRef: body.targetRef,
    before: body.before,
    after: body.after,
    format: body.format,
    by: 'user',
  });
  sendJson(res, 200, finding);
}

function handleDraftClear(res, id, fp) {
  const finding = ledger.clearFindingDraft(id, fp, { by: 'user' });
  sendJson(res, 200, finding);
}

// Body is the full review object, a single-hunk patch { hunk, status, editedText? },
// and/or a finding-level counter-proposal { note?, verdict? }. Validation (status/verdict
// enum, edited requires text, draft must exist) lives in the ledger → EUSER → 400/404.
async function handleDraftReview(req, res, id, fp) {
  const body = await readJsonBody(req);
  const finding = ledger.setDraftReview(id, fp, body, { by: 'user' });
  sendJson(res, 200, finding);
}

// Reject + counter-proposal (spec workspaces). The reviewer disagrees with the proposed
// change's target/approach and supplies a counter. This does two things atomically:
//   1. records the counter on the draft (verdict='redirect' + note), and
//   2. enqueues a SCOPED re-audit request so the proposer re-evaluates THIS item against
//      the counter and drafts a revised proposal — the per-item refine loop.
// The runner (/flowlever:watch) picks up the re-audit, re-checks only the redirected
// findings, and re-drafts. Requires the finding to already carry a draft (the thing being
// countered) — setDraftReview throws (→400) otherwise. Body: { note, scope? }.
async function handleFindingCounter(req, res, id, fp) {
  const body = await readJsonBody(req);
  if (typeof body.note !== 'string' || body.note.trim() === '') {
    return sendError(res, 400, 'A counter requires a non-empty "note" (your counter-proposal)');
  }
  const finding = ledger.setDraftReview(id, fp, { verdict: 'redirect', note: body.note }, { by: 'user' });
  const request = ledger.addRequest({
    action: 're-audit',
    wsId: id,
    title: `Re-audit · ${finding.title}`.slice(0, 120),
    instructions: typeof body.scope === 'string' && body.scope.trim()
      ? body.scope.trim()
      : `Counter on ${fp}: ${body.note.trim()}`,
  });
  sendJson(res, 200, { finding, request });
}

// Bulk-apply the review-flow finish screen: set a list of findings to reworking
// (additive — the finish screen reflects in-flight work without touching Confluence/ADO).
// Validated up front so the operation is all-or-nothing: every fp must exist and the
// target status must be in the small allowlist before any write happens.
// `reworking` = spec rework in-flight; `resolved` = a PR-review comment / thread closed
// without needing the author. The transient in-flight markers — set when the reviewer clicks
// Post/Apply, BEFORE the runner does the real write — are `pending-post` / `pending-apply`
// (→ "Posting…/Applying…" lane). The runner stamps the real completion (markPosted/markApplied)
// once the comment is actually on the PR / the spec is actually written. `posted` stays accepted
// for back-compat / the runner, but the browser no longer uses it to fake a completion.
const REVIEW_APPLY_STATUSES = ['reworking', 'resolved', 'posted', 'pending-post', 'pending-apply'];

async function handleReviewApply(req, res, id) {
  const body = await readJsonBody(req);
  const status = body.status === undefined ? 'reworking' : body.status;
  const fps = body.fps;
  if (!Array.isArray(fps) || fps.length === 0 || !fps.every((x) => typeof x === 'string' && x.trim())) {
    return sendError(res, 400, 'Body must include a non-empty fps array of finding ids');
  }
  if (!REVIEW_APPLY_STATUSES.includes(status)) {
    return sendError(res, 400, `status must be one of ${REVIEW_APPLY_STATUSES.join(', ')}`);
  }
  const existing = new Set((ledger.loadLedger(id).findings || []).map((f) => f.fp));
  const missing = [...new Set(fps)].filter((fp) => !existing.has(fp));
  if (missing.length) return sendError(res, 400, `unknown finding(s): ${missing.join(', ')}`);

  const uniq = [...new Set(fps)];
  let findings;
  if (status === 'posted') findings = ledger.markPosted(id, uniq, { by: 'user' });
  else if (status === 'pending-post') findings = ledger.setFindingPending(id, uniq, 'post', { by: 'user' });
  else if (status === 'pending-apply') findings = ledger.setFindingPending(id, uniq, 'apply', { by: 'user' });
  else findings = uniq.map((fp) => ledger.setFindingStatus(id, fp, { status, by: 'user' }));
  sendJson(res, 200, { updated: findings.length, status, findings });
}

async function handleIngest(req, res, id) {
  const body = await readJsonBody(req);
  if (!Array.isArray(body.findings)) {
    return sendError(res, 400, 'Body must be { findings: [...], note?, reopenResolved? }');
  }
  for (let i = 0; i < body.findings.length; i++) {
    const message = findingError(body.findings[i], i);
    if (message) return sendError(res, 400, message);
  }
  const { round, stats } = ledger.ingestRound(id, body.findings, {
    note: body.note,
    reopenResolved: Boolean(body.reopenResolved),
    trigger: 'audit',
  });
  sendJson(res, 200, { round, stats });
}

// ---------- requests (UI-triggered job queue) ----------

async function handleRequestCreate(req, res) {
  const body = await readJsonBody(req);
  const request = ledger.addRequest({
    action: body.action,
    prId: body.prId,
    wsId: body.wsId,
    title: body.title,
    instructions: body.instructions,
  });
  sendJson(res, 201, request);
}

function handleRequestList(res, statusFilter) {
  const requests = ledger.listRequests(statusFilter ? { status: statusFilter } : {});
  sendJson(res, 200, requests);
}

async function handleRequestUpdate(req, res, id) {
  const body = await readJsonBody(req);
  const change = {};
  if (body.status !== undefined) change.status = body.status;
  if (body.note !== undefined) change.note = body.note;
  if (body.wsId !== undefined) change.wsId = body.wsId;
  if (body.phase !== undefined) change.phase = body.phase;
  if (body.needsInput !== undefined) change.needsInput = body.needsInput;
  if (change.status === undefined && change.note === undefined && change.wsId === undefined
      && change.phase === undefined && change.needsInput === undefined) {
    return sendError(res, 400, 'Body must include status, note, wsId, phase and/or needsInput');
  }
  const request = ledger.setRequestStatus(id, change);
  sendJson(res, 200, request);
}

function handleFeatureDelete(res, id) {
  const result = ledger.deleteFeature(id);
  sendJson(res, 200, result);
}

function handleRequestDelete(res, id) {
  const result = ledger.deleteRequest(id);
  sendJson(res, 200, result);
}

function handleReport(res, id) {
  const md = generateReport(id);
  res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8' });
  res.end(md);
}

// ---------- static files ----------

function handleStatic(req, res, pathname) {
  if (req.method !== 'GET') return sendError(res, 405, 'Method not allowed');
  let rel;
  try {
    rel = decodeURIComponent(pathname === '/' ? 'index.html' : pathname.slice(1));
  } catch {
    return sendError(res, 400, 'Bad request path');
  }
  const filePath = path.resolve(WEB_DIR, rel);
  // No path traversal: resolved path must stay inside web/.
  if (filePath !== WEB_DIR && !filePath.startsWith(WEB_DIR + path.sep)) {
    return sendError(res, 404, 'Not found');
  }
  const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
  if (!contentType) return sendError(res, 404, 'Not found');
  fs.readFile(filePath, (err, data) => {
    if (err) return sendError(res, 404, 'Not found');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

// ---------- routing ----------

async function route(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean).map((p) => decodeURIComponent(p));

  if (parts[0] !== 'api') return handleStatic(req, res, url.pathname);

  if (parts[1] === 'home' && parts.length === 2 && req.method === 'GET') {
    return handleHome(res);
  }
  if (parts[1] === 'features') {
    if (parts.length === 2 && req.method === 'GET') {
      return handleFeatureList(res, url.searchParams.get('kind') || null);
    }
    if (parts.length === 3 && req.method === 'GET') return handleFeatureDetail(res, parts[2]);
    if (parts.length === 3 && req.method === 'DELETE') return handleFeatureDelete(res, parts[2]);
    if (parts.length === 5 && parts[3] === 'findings' && req.method === 'POST') {
      return handleFindingUpdate(req, res, parts[2], parts[4]);
    }
    if (parts.length === 6 && parts[3] === 'findings' && parts[5] === 'draft') {
      if (req.method === 'POST') return handleDraftSet(req, res, parts[2], parts[4]);
      if (req.method === 'DELETE') return handleDraftClear(res, parts[2], parts[4]);
    }
    if (parts.length === 7 && parts[3] === 'findings' && parts[5] === 'draft'
        && parts[6] === 'review' && req.method === 'POST') {
      return handleDraftReview(req, res, parts[2], parts[4]);
    }
    if (parts.length === 6 && parts[3] === 'findings' && parts[5] === 'counter' && req.method === 'POST') {
      return handleFindingCounter(req, res, parts[2], parts[4]);
    }
    if (parts.length === 5 && parts[3] === 'review' && parts[4] === 'apply' && req.method === 'POST') {
      return handleReviewApply(req, res, parts[2]);
    }
    if (parts.length === 4 && parts[3] === 'status' && req.method === 'POST') {
      return handleFeatureStatus(req, res, parts[2]);
    }
    if (parts.length === 4 && parts[3] === 'activity' && req.method === 'POST') {
      return handleFeatureActivity(req, res, parts[2]);
    }
  }
  if (parts[1] === 'requests') {
    if (parts.length === 2 && req.method === 'POST') return handleRequestCreate(req, res);
    if (parts.length === 2 && req.method === 'GET') {
      return handleRequestList(res, url.searchParams.get('status') || null);
    }
    if (parts.length === 3 && req.method === 'POST') return handleRequestUpdate(req, res, parts[2]);
    if (parts.length === 3 && req.method === 'DELETE') return handleRequestDelete(res, parts[2]);
  }
  if (parts[1] === 'ingest' && parts.length === 3 && req.method === 'POST') {
    return handleIngest(req, res, parts[2]);
  }
  if (parts[1] === 'report' && parts.length === 3 && req.method === 'GET') {
    return handleReport(res, parts[2]);
  }
  return sendError(res, 404, 'Not found');
}

const server = http.createServer((req, res) => {
  Promise.resolve()
    .then(() => route(req, res))
    .catch((err) => {
      if (res.writableEnded) return;
      if (err && err.code === 'EUSER') {
        const status = req.method === 'GET' ? 404 : euserStatus(err);
        return sendError(res, status, err.message);
      }
      if (err && err.code === 'ETOOBIG') return sendError(res, 413, err.message);
      if (err && err.code === 'EBADJSON') return sendError(res, 400, err.message);
      console.error(err && err.stack ? err.stack : err);
      return sendError(res, 500, 'Internal server error');
    });
});

ledger.initDataDir();
server.listen(PORT, () => {
  console.log(`FlowLever cockpit → http://localhost:${server.address().port}`);
});

module.exports = { server };
