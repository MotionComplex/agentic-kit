'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..');
const DATA_DIR = process.env.FLOWLEVER_DATA || path.join(repoRoot, 'data');

const SEVERITIES = ['blocker', 'major', 'minor', 'info'];
const STATUSES = ['open', 'reworking', 'resolved', 'waived'];
// Workflow kinds a workspace can host. All ride the same finding model + stepper;
// only labels/icons differ in the UI. `spec` is the default and the back-compat
// value for any feature on disk that predates the field.
const KINDS = ['spec', 'pr-review', 'pr-respond'];
// A workspace's lifecycle status (distinct from a finding's status). `done` means the
// review/flow is finished — the cockpit shows it as completed and the inbox stops nagging.
const FEATURE_STATUSES = ['draft', 'auditing', 'reworking', 'ready', 'implementing', 'done'];
const SOURCE_TYPES = ['confluence', 'ado', 'figma'];
const COVERAGE_STATUSES = ['covered', 'partial', 'uncovered', 'orphan'];
const DRAFT_FORMATS = ['text', 'gherkin', 'markdown'];
const REVIEW_STATUSES = ['accepted', 'rejected', 'edited'];
const REVIEW_VERDICTS = ['proposed', 'redirect', 'reject'];
// UI-triggered job queue. A request is enqueued from the web UI and picked up by
// a session-side runner skill (/lever:watch) that runs the matching adapter.
const REQUEST_ACTIONS = ['pr-review', 'pr-respond', 'apply'];
const REQUEST_STATUSES = ['queued', 'running', 'done', 'error'];

const DEFAULT_CONFIG = {
  severityWeights: { blocker: 10, major: 5, minor: 2, info: 0.5 },
  gates: { blockerOpenMeansNotReady: true, readyThreshold: 85 },
  dimensions: ['consistency', 'completeness', 'testability', 'design-match', 'dor', 'ambiguity', 'feasibility'],
};

// ---------- small helpers ----------

function euser(message) {
  const err = new Error(message);
  err.code = 'EUSER';
  return err;
}

function now() {
  return new Date().toISOString();
}

function featurePath(id) { return path.join(DATA_DIR, 'features', `${id}.json`); }
function ledgerPath(id) { return path.join(DATA_DIR, 'ledger', `${id}.json`); }
function roundsPath(id) { return path.join(DATA_DIR, 'rounds', `${id}.json`); }
function configPath() { return path.join(DATA_DIR, 'config.json'); }
function requestsPath() { return path.join(DATA_DIR, 'requests.json'); }

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  fs.renameSync(tmp, file);
}

// ---------- data dir / config ----------

function initDataDir() {
  for (const sub of ['features', 'ledger', 'rounds']) {
    fs.mkdirSync(path.join(DATA_DIR, sub), { recursive: true });
  }
  if (!fs.existsSync(configPath())) {
    writeJson(configPath(), DEFAULT_CONFIG);
  }
  return DATA_DIR;
}

function loadConfig() {
  if (!fs.existsSync(configPath())) return structuredClone(DEFAULT_CONFIG);
  return readJson(configPath());
}

// ---------- features ----------

function createFeature({ id, title, kind = 'spec' }) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,64}$/.test(id)) {
    throw euser(`invalid feature id "${id}": must match [a-z0-9-]{1,64}`);
  }
  if (typeof title !== 'string' || title.trim() === '') {
    throw euser('feature title is required');
  }
  if (!KINDS.includes(kind)) {
    throw euser(`invalid kind "${kind}": must be one of ${KINDS.join(', ')}`);
  }
  if (fs.existsSync(featurePath(id))) {
    throw euser(`feature "${id}" already exists`);
  }
  const ts = now();
  const feature = {
    id,
    title,
    kind,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
    sources: { confluence: [], ado: [], figma: [] },
    specSections: [],
    coverage: [],
    notes: '',
    reviewBrief: '',
  };
  writeJson(featurePath(id), feature);
  return feature;
}

// Features written before `kind` existed are treated as `spec` everywhere.
function normalizeFeature(feature) {
  if (!feature.kind) feature.kind = 'spec';
  return feature;
}

function getFeature(id) {
  if (!fs.existsSync(featurePath(id))) {
    throw euser(`feature "${id}" not found`);
  }
  return normalizeFeature(readJson(featurePath(id)));
}

function listFeatures() {
  const dir = path.join(DATA_DIR, 'features');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => normalizeFeature(readJson(path.join(dir, f))));
}

function saveFeature(feature) {
  feature.updatedAt = now();
  writeJson(featurePath(feature.id), feature);
  return feature;
}

// Set a workspace's lifecycle status (e.g. mark a review `done`, or reopen it).
function setFeatureStatus(featureId, status) {
  if (!FEATURE_STATUSES.includes(status)) {
    throw euser(`invalid feature status "${status}": must be one of ${FEATURE_STATUSES.join(', ')}`);
  }
  const feature = getFeature(featureId);
  feature.status = status;
  return saveFeature(feature);
}

// The PR-review "waiting on author" tracker (pr-review / pr-respond). After posting, a
// workspace waits on the author; the /flowlever:watch runner checks the PR for new
// replies/commits since `lastPostedAt` and flips `authorRespondedAt` (+ a human note) so the
// cockpit can move from a passive "Waiting on author" state to "Author responded → Re-review".
// `patch` merges any of { lastPostedAt, authorRespondedAt, note } (null clears a field).
function setFeatureReview(featureId, patch = {}) {
  const feature = getFeature(featureId);
  const review = { lastPostedAt: null, authorRespondedAt: null, note: null, ...(feature.review || {}) };
  for (const k of ['lastPostedAt', 'authorRespondedAt', 'note']) {
    if (patch[k] !== undefined) review[k] = patch[k];
  }
  feature.review = review;
  return saveFeature(feature);
}

function addSource(featureId, { type, ...fields }) {
  if (!SOURCE_TYPES.includes(type)) {
    throw euser(`invalid source type "${type}": must be one of ${SOURCE_TYPES.join(', ')}`);
  }
  const feature = getFeature(featureId);
  const entry = { ...fields, lastFetched: fields.lastFetched ?? null };
  // The ado source entry carries its own "type" field (work item type), which
  // collides with the source-kind discriminator; accept it as `itemType`.
  if (type === 'ado' && 'itemType' in entry) {
    entry.type = entry.itemType;
    delete entry.itemType;
  }
  const keyField = type === 'figma' ? 'fileKey' : 'id';
  if (entry[keyField] === undefined || entry[keyField] === null || entry[keyField] === '') {
    throw euser(`${type} source requires "${keyField}"`);
  }
  feature.sources[type].push(entry);
  saveFeature(feature);
  return entry;
}

// ---------- ledger / rounds stores ----------

function loadLedger(featureId) {
  if (!fs.existsSync(ledgerPath(featureId))) return { featureId, findings: [] };
  return readJson(ledgerPath(featureId));
}

function loadRounds(featureId) {
  if (!fs.existsSync(roundsPath(featureId))) return { featureId, rounds: [] };
  return readJson(roundsPath(featureId));
}

function saveLedger(ledger) { writeJson(ledgerPath(ledger.featureId), ledger); }
function saveRounds(rounds) { writeJson(roundsPath(rounds.featureId), rounds); }

// ---------- fingerprint ----------

function fingerprint(featureId, dimension, title, locus) {
  const normTitle = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')   // strip punctuation, keep a-z0-9 and whitespace
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim()
    .slice(0, 80);
  return crypto.createHash('sha1')
    .update(`${featureId}|${dimension}|${normTitle}|${locus}`)
    .digest('hex')
    .slice(0, 10);
}

// ---------- validation ----------

function validateIngestFinding(f) {
  const config = loadConfig();
  if (!f || typeof f !== 'object') throw euser('finding must be an object');
  if (!config.dimensions.includes(f.dimension)) {
    throw euser(`invalid dimension "${f.dimension}": must be one of ${config.dimensions.join(', ')}`);
  }
  if (!SEVERITIES.includes(f.severity)) {
    throw euser(`invalid severity "${f.severity}": must be one of ${SEVERITIES.join(', ')}`);
  }
  if (typeof f.title !== 'string' || f.title.trim() === '') throw euser('finding title is required');
  if (typeof f.locus !== 'string' || f.locus.trim() === '') throw euser('finding locus is required');
  for (const opt of ['detail', 'suggestion']) {
    if (f[opt] !== undefined && f[opt] !== null && typeof f[opt] !== 'string') {
      throw euser(`finding ${opt} must be a string when provided`);
    }
  }
  return f;
}

// ---------- readiness ----------

function isOpen(finding) {
  return finding.status === 'open' || finding.status === 'reworking';
}

// A finding is "posted" once its comment/reply has been sent back to the PR: it stays
// `reworking` (so reconciliation still auto-resolves it once the author addresses it) but
// carries a `postedAt` stamp. From the reviewer's side the work is done — it's awaiting the
// author — so it sits in its own "Posted" lane and does NOT drag the readiness score down.
function isPosted(finding) {
  return Boolean(finding.postedAt) && isOpen(finding);
}

function computeReadiness(ledger, config) {
  // Posted findings are awaiting the author, not open work for the reviewer, so they don't
  // penalize the score — but they remain `isOpen` for reconciliation's auto-resolve.
  const open = ledger.findings.filter((f) => isOpen(f) && !isPosted(f));
  const openBySeverity = { blocker: 0, major: 0, minor: 0, info: 0 };
  let penalty = 0;
  for (const f of open) {
    openBySeverity[f.severity] += 1;
    penalty += config.severityWeights[f.severity] ?? 0;
  }
  const score = Math.max(0, Math.round(100 - (penalty * 100) / 40));
  const blockers = open.filter((f) => f.severity === 'blocker');
  let gate;
  if (config.gates.blockerOpenMeansNotReady && blockers.length > 0) gate = 'not-ready';
  else if (score >= config.gates.readyThreshold && blockers.length === 0) gate = 'ready';
  else gate = 'in-progress';
  return { score, gate, openBySeverity, openCount: open.length, blockers };
}

function readiness(featureId) {
  getFeature(featureId); // EUSER if missing
  return computeReadiness(loadLedger(featureId), loadConfig());
}

// ---------- ingest / reconciliation ----------

function ingestRound(featureId, findings, { note = '', reopenResolved = false, trigger = 'audit' } = {}) {
  getFeature(featureId); // EUSER if missing
  if (!Array.isArray(findings)) throw euser('findings must be an array');
  findings.forEach(validateIngestFinding);

  const config = loadConfig();
  const ledger = loadLedger(featureId);
  const rounds = loadRounds(featureId);
  const n = rounds.rounds.length + 1;
  const at = now();
  const byFp = new Map(ledger.findings.map((f) => [f.fp, f]));

  const stats = { new: 0, stillOpen: 0, autoResolved: 0, regressions: 0, totalOpen: 0 };
  const seenFps = new Set();

  for (const incoming of findings) {
    const fp = fingerprint(featureId, incoming.dimension, incoming.title, incoming.locus);
    if (seenFps.has(fp)) continue; // duplicate within the batch
    seenFps.add(fp);
    const existing = byFp.get(fp);

    if (!existing) {
      const finding = {
        fp,
        dimension: incoming.dimension,
        severity: incoming.severity,
        title: incoming.title,
        detail: incoming.detail ?? '',
        locus: incoming.locus,
        suggestion: incoming.suggestion ?? '',
        status: 'open',
        statusReason: null,
        pinned: false,
        firstSeenRound: n,
        lastSeenRound: n,
        resolvedInRound: null,
        createdAt: at,
        updatedAt: at,
        history: [],
      };
      ledger.findings.push(finding);
      byFp.set(fp, finding);
      stats.new += 1;
    } else if (isOpen(existing)) {
      existing.lastSeenRound = n;
      existing.detail = incoming.detail ?? existing.detail;
      existing.suggestion = incoming.suggestion ?? existing.suggestion;
      existing.updatedAt = at;
      stats.stillOpen += 1;
    } else {
      // resolved/waived re-flagged → regression
      stats.regressions += 1;
      if (reopenResolved) {
        existing.history.push({ at, from: existing.status, to: 'open', by: 'reconcile', note: `re-flagged in round ${n}` });
        existing.status = 'open';
        existing.statusReason = null;
        existing.resolvedInRound = null;
        existing.lastSeenRound = n;
        existing.detail = incoming.detail ?? existing.detail;
        existing.suggestion = incoming.suggestion ?? existing.suggestion;
        existing.updatedAt = at;
      }
      // else: stays closed, regression logged in round stats only
    }
  }

  // auto-resolve open findings absent from this round, unless pinned
  for (const finding of ledger.findings) {
    if (!isOpen(finding) || seenFps.has(finding.fp) || finding.pinned) continue;
    finding.history.push({ at, from: finding.status, to: 'resolved', by: 'reconcile', note: `not flagged in round ${n}` });
    finding.status = 'resolved';
    finding.statusReason = null;
    finding.resolvedInRound = n;
    finding.updatedAt = at;
    stats.autoResolved += 1;
  }

  stats.totalOpen = ledger.findings.filter(isOpen).length;

  const r = computeReadiness(ledger, config);
  const round = {
    n,
    at,
    trigger,
    stats,
    readiness: { score: r.score, gate: r.gate, openBySeverity: r.openBySeverity },
    note,
  };
  rounds.rounds.push(round);

  saveLedger(ledger);
  saveRounds(rounds);
  return { round, stats };
}

// ---------- finding lifecycle ----------

function setFindingStatus(featureId, fp, { status, reason = null, pinned, by = 'user' } = {}) {
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);

  const at = now();
  if (pinned !== undefined) finding.pinned = Boolean(pinned);

  if (status !== undefined && status !== finding.status) {
    if (!STATUSES.includes(status)) {
      throw euser(`invalid status "${status}": must be one of ${STATUSES.join(', ')}`);
    }
    if (status === 'waived' && (typeof reason !== 'string' || reason.trim() === '')) {
      throw euser('waiving a finding requires a reason');
    }
    const from = finding.status;
    finding.history.push({ at, from, to: status, by, note: reason ?? '' });
    finding.status = status;
    finding.statusReason = status === 'waived' ? reason : reason ?? null;
    // A status change supersedes any pending triage decision (approve/edit) — drop it.
    delete finding.decision;
    // Reopening a posted finding pulls it back into the review flow, so drop the posted stamp.
    if (status === 'open') delete finding.postedAt;
    if (isOpen(finding)) {
      finding.resolvedInRound = null; // reopening clears the resolution round
    } else if (status === 'resolved') {
      finding.resolvedInRound = loadRounds(featureId).rounds.length || null;
    }
  }

  finding.updatedAt = at;
  saveLedger(ledger);
  return finding;
}

// Mark findings as posted back to the PR (their inline comment / reply has been sent).
// A posted finding stays `reworking` — so a later re-review reconciliation auto-resolves it
// once the author addresses it — but gains a `postedAt` stamp that moves it into the
// "Posted — awaiting author" lane and excludes it from the readiness penalty and the
// "to review" count. Idempotent: re-posting refreshes the stamp without duplicating history.
// `fps` may be a single fp or an array. Returns the updated findings.
function markPosted(featureId, fps, { by = 'post' } = {}) {
  const list = Array.isArray(fps) ? fps : [fps];
  const ledger = loadLedger(featureId);
  const at = now();
  const updated = [];
  for (const fp of [...new Set(list)]) {
    const finding = ledger.findings.find((f) => f.fp === fp);
    if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
    // Posting only applies to live findings; a waived/resolved finding isn't awaiting anyone.
    if (finding.status === 'open') {
      finding.history.push({ at, from: 'open', to: 'reworking', by, note: 'posted to PR' });
      finding.status = 'reworking';
      finding.resolvedInRound = null;
    } else if (!finding.postedAt) {
      finding.history.push({ at, from: finding.status, to: finding.status, by, note: 'posted to PR' });
    }
    finding.postedAt = at;
    delete finding.decision;   // posting supersedes the pending approve/edit decision
    finding.updatedAt = at;
    updated.push(finding);
  }
  saveLedger(ledger);
  // Posting (re)starts the wait on the author: anchor the "since" time and clear any prior
  // "author responded" flag. Best-effort — a missing feature file shouldn't fail the post.
  if (updated.length) {
    try { setFeatureReview(featureId, { lastPostedAt: at, authorRespondedAt: null, note: null }); }
    catch { /* feature gone — ignore */ }
  }
  return updated;
}

// The reviewer's triage decision on a PR comment that hasn't been posted yet:
// `approve` / `edit` mean "will post on the next Post" (the finding stays open/reworking);
// a dismiss is modelled by the `waived` status instead, not here. Persisting the decision
// (rather than holding it only in the browser's review flow) is what keeps the board, the
// stepper and the Post screen in sync and makes a decision survive a page refresh.
// Pass null to clear the decision (undo). Returns the finding.
const FINDING_DECISIONS = ['approve', 'edit'];
function setFindingDecision(featureId, fp, decision, { by = 'user' } = {}) {
  if (decision !== null && !FINDING_DECISIONS.includes(decision)) {
    throw euser(`invalid decision "${decision}": must be one of ${FINDING_DECISIONS.join(', ')} or null`);
  }
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
  const at = now();
  if (decision === null) {
    if (finding.decision === undefined) return finding;   // nothing to clear
    delete finding.decision;
    finding.history.push({ at, from: finding.status, to: finding.status, by, note: 'cleared decision' });
  } else if (finding.decision !== decision) {
    finding.decision = decision;
    finding.history.push({ at, from: finding.status, to: finding.status, by, note: `decided: ${decision}` });
  } else {
    return finding;   // unchanged
  }
  finding.updatedAt = at;
  saveLedger(ledger);
  return finding;
}

// Refine a finding's descriptive text without touching its identity. title, locus and
// dimension feed the fingerprint, so they are intentionally NOT editable here — changing
// them would create a different finding. detail/suggestion/severity can be corrected as
// understanding improves during refinement; a history entry records the refinement.
function setFindingDetails(featureId, fp, { detail, suggestion, severity, by = 'user', note = '' } = {}) {
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);

  if (severity !== undefined && !SEVERITIES.includes(severity)) {
    throw euser(`invalid severity "${severity}": must be one of ${SEVERITIES.join(', ')}`);
  }
  if (detail === undefined && suggestion === undefined && severity === undefined) {
    throw euser('nothing to refine: provide detail, suggestion or severity');
  }

  const at = now();
  const changed = [];
  if (detail !== undefined && detail !== finding.detail) { finding.detail = String(detail); changed.push('detail'); }
  if (suggestion !== undefined && suggestion !== finding.suggestion) { finding.suggestion = String(suggestion); changed.push('suggestion'); }
  if (severity !== undefined && severity !== finding.severity) {
    changed.push(`severity ${finding.severity}→${severity}`);
    finding.severity = severity;
  }
  if (changed.length) {
    finding.history.push({ at, from: finding.status, to: finding.status, by, note: note || `refined ${changed.join(', ')}` });
    finding.updatedAt = at;
    saveLedger(ledger);
  }
  return finding;
}

// ---------- finding rework drafts ----------

// A draft is a proposed before→after change to the spec/ticket that fixes a finding,
// shown in the cockpit as a PR-style red/green diff before it is written back to the
// real source. It is purely descriptive: it does NOT touch the finding's identity
// fields (dimension/title/locus), so the fingerprint is unaffected. A history entry
// records the draft so the trail shows when a fix was proposed.
function setFindingDraft(featureId, fp, { target, before, after, format = 'text', by = 'user' } = {}) {
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);

  if (typeof before !== 'string' || typeof after !== 'string') {
    throw euser('a draft requires "before" and "after" strings');
  }
  if (!DRAFT_FORMATS.includes(format)) {
    throw euser(`invalid draft format "${format}": must be one of ${DRAFT_FORMATS.join(', ')}`);
  }

  const at = now();
  finding.draft = {
    target: typeof target === 'string' && target.trim() ? target : finding.locus,
    format,
    before,
    after,
    updatedAt: at,
  };
  finding.history.push({ at, from: finding.status, to: finding.status, by, note: 'drafted change' });
  finding.updatedAt = at;
  saveLedger(ledger);
  return finding;
}

function clearFindingDraft(featureId, fp, { by = 'user' } = {}) {
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);

  if (finding.draft) {
    const at = now();
    delete finding.draft;
    finding.history.push({ at, from: finding.status, to: finding.status, by, note: 'cleared draft' });
    finding.updatedAt = at;
    saveLedger(ledger);
  }
  return finding;
}

// A draft review records the user's decisions on a rework draft so they can be
// exported as a work order for a coding agent. It lives under draft.review and,
// like the draft itself, never touches the finding's identity fields
// (dimension/title/locus) — the fingerprint is unaffected.
//
// Two LEVELS of decision live here, both merged into the existing review:
//   - PER-HUNK Accept/Reject/Edit: `review` carries a full object
//     `{ hunks: { "<idx>": { status, editedText? } } }` or a single-hunk patch
//     `{ hunk, status, editedText? }`. A status of 'undecided' (or null) clears
//     that hunk's decision.
//   - FINDING-LEVEL counter-proposal: an optional `note` (free text aimed at the
//     coding agent) and an optional `verdict` ('proposed' | 'redirect' | 'reject').
//     `redirect` = do it differently/elsewhere, see note; `reject` = don't do it
//     at all. These override the per-hunk proposal in the export.
// Any combination may be sent in one call; each field present is merged.
function setDraftReview(featureId, fp, review, { by = 'user' } = {}) {
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
  if (!finding.draft) throw euser(`finding "${fp}" has no draft to review`);
  if (!review || typeof review !== 'object') throw euser('review must be an object');

  const hasHunkPatch = 'hunk' in review && review.hunk !== undefined && review.hunk !== null;
  const hasHunks = review.hunks && typeof review.hunks === 'object';
  const hasNote = 'note' in review;
  const hasVerdict = 'verdict' in review;
  if (!hasHunkPatch && !hasHunks && !hasNote && !hasVerdict) {
    throw euser('review must include "hunks", a single-hunk patch { hunk, status }, a note or a verdict');
  }

  const at = now();
  const prior = finding.draft.review || {};
  const merged = { ...(prior.hunks || {}) };

  if (hasHunkPatch || hasHunks) {
    const patches = hasHunkPatch
      ? { [String(review.hunk)]: { status: review.status, editedText: review.editedText } }
      : review.hunks;
    for (const [idx, hk] of Object.entries(patches)) {
      if (!hk || typeof hk !== 'object') throw euser(`hunk "${idx}" decision must be an object`);
      if (hk.status === 'undecided' || hk.status === null) { delete merged[String(idx)]; continue; }
      if (!REVIEW_STATUSES.includes(hk.status)) {
        throw euser(`invalid hunk status "${hk.status}": must be one of ${REVIEW_STATUSES.join(', ')}`);
      }
      if (hk.editedText !== undefined && hk.editedText !== null && typeof hk.editedText !== 'string') {
        throw euser('hunk editedText must be a string when provided');
      }
      if (hk.status === 'edited' && typeof hk.editedText !== 'string') {
        throw euser('an edited hunk requires editedText (string)');
      }
      const entry = { status: hk.status, at };
      if (hk.status === 'edited') entry.editedText = hk.editedText;
      merged[String(idx)] = entry;
    }
  }

  // Finding-level note + verdict (merge: keep prior value unless this call sets it).
  let note = prior.note ?? '';
  if (hasNote) {
    if (review.note !== null && review.note !== undefined && typeof review.note !== 'string') {
      throw euser('note must be a string when provided');
    }
    note = review.note == null ? '' : String(review.note);
  }
  let verdict = prior.verdict ?? 'proposed';
  if (hasVerdict) {
    if (review.verdict == null) {
      verdict = 'proposed';
    } else if (!REVIEW_VERDICTS.includes(review.verdict)) {
      throw euser(`invalid verdict "${review.verdict}": must be one of ${REVIEW_VERDICTS.join(', ')}`);
    } else {
      verdict = review.verdict;
    }
  }

  finding.draft.review = { hunks: merged, note, verdict, updatedAt: at };
  finding.draft.updatedAt = at;
  // A pure note/verdict change is a counter-proposal, not a per-hunk review.
  const histNote = (hasNote || hasVerdict) && !hasHunkPatch && !hasHunks ? 'reviewer note' : 'reviewed draft';
  finding.history.push({ at, from: finding.status, to: finding.status, by, note: histNote });
  finding.updatedAt = at;
  saveLedger(ledger);
  return finding;
}

// ---------- requests (UI-triggered job queue) ----------

// The queue file holds a monotonic counter alongside the requests, so ids are
// derived from the counter (req-1, req-2, …) — never from a clock. This keeps
// ids deterministic in tests and stable across reads.
function loadRequests() {
  if (!fs.existsSync(requestsPath())) return { counter: 0, requests: [] };
  const doc = readJson(requestsPath());
  if (!doc || typeof doc !== 'object') return { counter: 0, requests: [] };
  if (!Array.isArray(doc.requests)) doc.requests = [];
  if (typeof doc.counter !== 'number') doc.counter = doc.requests.length;
  return doc;
}

function saveRequests(doc) { writeJson(requestsPath(), doc); }

// Enqueue a job. `pr-review`/`pr-respond` target a PR (require prId); `apply`
// posts the reviewed output of an existing workspace (require wsId). Optional
// title is a human label shown on the queued card; optional `instructions` is
// free-text scope/focus for THAT run (e.g. "front-end only") the runner honors.
function addRequest({ action, prId, wsId, title, instructions } = {}) {
  if (!REQUEST_ACTIONS.includes(action)) {
    throw euser(`invalid action "${action}": must be one of ${REQUEST_ACTIONS.join(', ')}`);
  }
  if ((action === 'pr-review' || action === 'pr-respond') && (prId === undefined || prId === null || String(prId).trim() === '')) {
    throw euser(`${action} requires "prId"`);
  }
  if (action === 'apply' && (wsId === undefined || wsId === null || String(wsId).trim() === '')) {
    throw euser('apply requires "wsId"');
  }
  if (instructions !== undefined && instructions !== null && typeof instructions !== 'string') {
    throw euser('instructions must be a string when provided');
  }
  const doc = loadRequests();
  doc.counter += 1;
  const ts = now();
  const request = {
    id: `req-${doc.counter}`,
    action,
    prId: prId === undefined || prId === null || String(prId).trim() === '' ? null : String(prId).trim(),
    wsId: wsId === undefined || wsId === null || String(wsId).trim() === '' ? null : String(wsId).trim(),
    title: typeof title === 'string' && title.trim() ? title.trim() : null,
    // Per-run scope/focus the runner honors (e.g. "front-end only"); null when omitted.
    instructions: typeof instructions === 'string' && instructions.trim() ? instructions.trim() : null,
    status: 'queued',
    // phase = short free-text label of the runner's current step (e.g. "fetching PR diff");
    // needsInput = the job is blocked waiting on the user (e.g. a 2FA/auth prompt), with the
    // human-facing instruction in `note`.
    phase: null,
    needsInput: false,
    note: null,
    createdAt: ts,
    updatedAt: ts,
  };
  doc.requests.push(request);
  saveRequests(doc);
  return request;
}

function listRequests({ status } = {}) {
  let requests = loadRequests().requests;
  if (status !== undefined && status !== null && status !== '') {
    if (!REQUEST_STATUSES.includes(status)) {
      throw euser(`invalid status "${status}": must be one of ${REQUEST_STATUSES.join(', ')}`);
    }
    requests = requests.filter((r) => r.status === status);
  }
  return requests;
}

// Merge a status update onto a request. Only specified fields are touched, so the
// runner can advance `phase` without clobbering `note`, set `needsInput` on its own,
// etc. Reaching a terminal status (done/error) implicitly clears needsInput — a
// finished job is never still waiting on the user.
function setRequestStatus(id, { status, note, wsId, phase, needsInput } = {}) {
  if (status !== undefined && !REQUEST_STATUSES.includes(status)) {
    throw euser(`invalid status "${status}": must be one of ${REQUEST_STATUSES.join(', ')}`);
  }
  const doc = loadRequests();
  const request = doc.requests.find((r) => r.id === id);
  if (!request) throw euser(`request "${id}" not found`);
  if (status !== undefined) request.status = status;
  if (note !== undefined) request.note = note === null || note === '' ? null : String(note);
  if (wsId !== undefined && wsId !== null && String(wsId).trim() !== '') request.wsId = String(wsId).trim();
  if (phase !== undefined) request.phase = phase === null || phase === '' ? null : String(phase);
  if (needsInput !== undefined) request.needsInput = Boolean(needsInput);
  // A terminal status is never "waiting on you".
  if (status === 'done' || status === 'error') request.needsInput = false;
  request.updatedAt = now();
  saveRequests(doc);
  return request;
}

// ---------- delete ----------

function deleteFeature(id) {
  if (!fs.existsSync(featurePath(id))) throw euser(`feature "${id}" not found`);
  for (const p of [featurePath(id), ledgerPath(id), roundsPath(id)]) {
    try { fs.rmSync(p); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { id, deleted: true };
}

function deleteRequest(id) {
  const doc = loadRequests();
  const idx = doc.requests.findIndex((r) => r.id === id);
  if (idx === -1) throw euser(`request "${id}" not found`);
  doc.requests.splice(idx, 1);
  saveRequests(doc);
  return { id, deleted: true };
}

// ---------- coverage ----------

function setCoverage(featureId, coverage) {
  if (!Array.isArray(coverage)) throw euser('coverage must be an array');
  for (const entry of coverage) {
    if (!entry || typeof entry !== 'object') throw euser('coverage entries must be objects');
    if (!COVERAGE_STATUSES.includes(entry.status)) {
      throw euser(`invalid coverage status "${entry.status}": must be one of ${COVERAGE_STATUSES.join(', ')}`);
    }
  }
  const feature = getFeature(featureId);
  feature.coverage = coverage;
  return saveFeature(feature);
}

module.exports = {
  DATA_DIR,
  KINDS,
  FEATURE_STATUSES,
  REQUEST_ACTIONS,
  REQUEST_STATUSES,
  initDataDir,
  loadConfig,
  createFeature,
  getFeature,
  listFeatures,
  saveFeature,
  addSource,
  setFeatureStatus,
  setFeatureReview,
  loadLedger,
  loadRounds,
  fingerprint,
  ingestRound,
  setFindingStatus,
  markPosted,
  setFindingDecision,
  setFindingDetails,
  setFindingDraft,
  clearFindingDraft,
  setDraftReview,
  readiness,
  setCoverage,
  loadRequests,
  addRequest,
  listRequests,
  setRequestStatus,
  deleteFeature,
  deleteRequest,
  validateIngestFinding,
};
