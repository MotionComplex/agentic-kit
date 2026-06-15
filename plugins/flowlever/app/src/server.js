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
    const counts = { toReview: 0, open: 0, reworking: 0, resolved: 0, waived: 0 };
    for (const fd of findings) {
      if (counts[fd.status] !== undefined) counts[fd.status] += 1;
      if ((fd.status === 'open' || fd.status === 'reworking') && fd.draft) counts.toReview += 1;
    }
    let readiness = { score: 0, gate: 'in-progress' };
    try {
      const r = ledger.readiness(f.id);
      readiness = { score: r.score, gate: r.gate };
    } catch { /* feature without ledger yet */ }
    return { id: f.id, title: f.title, kind: f.kind || 'spec', readiness, counts };
  });
  rows.sort((a, b) =>
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

async function handleFindingUpdate(req, res, id, fp) {
  const body = await readJsonBody(req);
  const change = { by: 'user' };
  if (body.status !== undefined) change.status = body.status;
  if (body.reason !== undefined) change.reason = body.reason;
  if (body.pinned !== undefined) change.pinned = body.pinned;
  if (change.status === undefined && change.pinned === undefined) {
    return sendError(res, 400, 'Body must include status and/or pinned');
  }
  const finding = ledger.setFindingStatus(id, fp, change);
  sendJson(res, 200, finding);
}

async function handleDraftSet(req, res, id, fp) {
  const body = await readJsonBody(req);
  if (typeof body.before !== 'string' || typeof body.after !== 'string') {
    return sendError(res, 400, 'Body must include before and after strings');
  }
  const finding = ledger.setFindingDraft(id, fp, {
    target: body.target,
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

// Bulk-apply the review-flow finish screen: set a list of findings to reworking
// (additive — the finish screen reflects in-flight work without touching Confluence/ADO).
// Validated up front so the operation is all-or-nothing: every fp must exist and the
// target status must be in the small allowlist before any write happens.
const REVIEW_APPLY_STATUSES = ['reworking'];

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

  const findings = [...new Set(fps)].map((fp) => ledger.setFindingStatus(id, fp, { status, by: 'user' }));
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
    if (parts.length === 5 && parts[3] === 'review' && parts[4] === 'apply' && req.method === 'POST') {
      return handleReviewApply(req, res, parts[2]);
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
