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
// The systems a draft can be written back to on apply (spec workspaces). A draft's
// machine-addressable write target (`draft.targetRef`) names one of these.
const TARGET_SYSTEMS = ['ado', 'confluence'];
// UI-triggered job queue. A request is enqueued from the web UI and picked up by
// a session-side runner skill (/lever:watch) that runs the matching adapter.
//   pr-review / pr-respond → load a PR (require prId)
//   apply                  → write a workspace's reviewed output back to its source
//                            (require wsId): PR comments for PR kinds, ADO/Confluence
//                            edits for a spec workspace — the runner branches on kind
//   re-audit               → scoped re-audit of a spec workspace (require wsId): re-check
//                            only the findings the reviewer countered (verdict=redirect)
//   audit                  → start a NEW spec analysis (require instructions = the spec /
//                            work-item / Figma URLs): the runner creates the workspace,
//                            registers the sources, and runs the audit sweep
//   poll                   → the cockpit's manual "↻ Refresh": run a discovery pass NOW
//                            instead of waiting for the scheduled /flowlever:poll — find new
//                            PRs and re-check known ones for counterpart updates. Optional
//                            `kind` narrows it to one section (pr-review / pr-respond)
const REQUEST_ACTIONS = ['pr-review', 'pr-respond', 'apply', 're-audit', 'audit', 'propose', 'poll'];
const REQUEST_STATUSES = ['queued', 'running', 'done', 'error'];
// Workspace kinds a `poll` request may be narrowed to (null = both).
const REQUEST_KINDS = ['pr-review', 'pr-respond'];

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
//
// Two DIFFERENT clocks live here and must not be conflated:
//   - `authorRespondedAt` — when the RUNNER NOTICED the activity (detection time).
//   - `lastActivityAt`    — the real timestamp OF the newest counterpart update on the PR
//                           (their latest comment / pushed commit), as reported by ADO, with
//                           `lastActivityBy` naming who made it. This is what the cockpit shows
//                           as "PR updated <when>" and compares against the last review round
//                           to decide whether a re-review is worth running.
// `patch` merges any of { lastPostedAt, authorRespondedAt, lastActivityAt, lastActivityBy, note }
// (null clears a field).
const REVIEW_FIELDS = ['lastPostedAt', 'authorRespondedAt', 'lastActivityAt', 'lastActivityBy', 'note'];
function setFeatureReview(featureId, patch = {}) {
  const feature = getFeature(featureId);
  const review = {
    lastPostedAt: null, authorRespondedAt: null, lastActivityAt: null, lastActivityBy: null, note: null,
    ...(feature.review || {}),
  };
  for (const k of REVIEW_FIELDS) {
    if (patch[k] !== undefined) review[k] = patch[k];
  }
  feature.review = review;
  return saveFeature(feature);
}

// Is `a` strictly later than `b`? Parsed (not string-compared) so timestamps that ADO hands
// back with a different offset/precision than our own `now()` still order correctly. An
// unparseable or missing value is never "later".
function isAfter(a, b) {
  const ta = Date.parse(a);
  if (Number.isNaN(ta)) return false;
  const tb = Date.parse(b);
  return Number.isNaN(tb) ? true : ta > tb;
}

// The two timestamps the cockpit reads to answer "can I re-review yet?": when WE last reviewed
// (the last ingest round — no separate stamp needed, a round IS a review pass) and when the
// counterpart last touched the PR. `newSinceReview` is the whole point: their update landed
// after our last round, so a re-review would actually see something new.
function reviewStamps(feature, lastRoundAt = null) {
  const rv = (feature && feature.review) || {};
  const lastReviewedAt = lastRoundAt || null;
  const lastActivityAt = rv.lastActivityAt || null;
  return {
    lastReviewedAt,
    lastActivityAt,
    lastActivityBy: rv.lastActivityBy || null,
    lastPostedAt: rv.lastPostedAt || null,
    authorRespondedAt: rv.authorRespondedAt || null,
    newSinceReview: Boolean(lastActivityAt && isAfter(lastActivityAt, lastReviewedAt)),
  };
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
  if (f.duplicateOf !== undefined && f.duplicateOf !== null) {
    validateDuplicateOf(f.duplicateOf);
  }
  return f;
}

// A finding can mark itself as a duplicate of an already-raised comment/finding, so the UI
// can badge it and the posted reply can be a cross-reference instead of a second answer.
// Shape: { label: "Oriol on OktaErrorHelper.cs:39", url?: <deep link>, threadId?: <n>, fp?: <fp> }.
function validateDuplicateOf(d) {
  if (typeof d !== 'object' || Array.isArray(d)) throw euser('duplicateOf must be an object');
  if (typeof d.label !== 'string' || d.label.trim() === '') throw euser('duplicateOf.label is required (e.g. "Oriol on file.cs:39")');
  for (const opt of ['url', 'fp']) {
    if (d[opt] !== undefined && d[opt] !== null && typeof d[opt] !== 'string') {
      throw euser(`duplicateOf.${opt} must be a string when provided`);
    }
  }
  return d;
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

// Spec mirror of isPosted: a finding whose accepted change has actually been written back to
// Confluence/ADO carries an `appliedAt` stamp. It stays `reworking` (so a re-audit auto-resolves
// it once the spec genuinely reflects the fix) but sits in the "Applied — awaiting re-audit" lane
// and, like posted, does not drag readiness down — the reviewer's work is out.
function isApplied(finding) {
  return Boolean(finding.appliedAt) && isOpen(finding);
}

// Transient: the user clicked Post/Apply and the runner is mid-flight. `pending` is 'post' | 'apply'.
// Set on confirm, cleared the moment the runner stamps postedAt/appliedAt (or on error / reopen).
// Only meaningful while the finding is still open/reworking and NOT yet stamped done.
function isPending(finding) {
  return Boolean(finding.pending) && isOpen(finding) && !finding.postedAt && !finding.appliedAt;
}

function computeReadiness(ledger, config) {
  // Posted / applied / in-flight findings are out of the reviewer's hands (awaiting the author,
  // awaiting re-audit, or mid write-back), not open work — so they don't penalize the score, but
  // they remain `isOpen` for reconciliation's auto-resolve.
  const open = ledger.findings.filter((f) => isOpen(f) && !isPosted(f) && !isApplied(f) && !isPending(f));
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
        duplicateOf: incoming.duplicateOf ?? null,
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
      existing.duplicateOf = incoming.duplicateOf ?? existing.duplicateOf ?? null;
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
    // A status change supersedes any pending triage decision (approve/edit) and any in-flight
    // post/apply marker — drop them.
    delete finding.decision;
    delete finding.pending;
    // Reopening a posted/applied finding pulls it back into the review flow, so drop the stamps.
    if (status === 'open') { delete finding.postedAt; delete finding.appliedAt; }
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

// ---------- the fix gate: a claimed code fix must point at a real pushed commit ----------

// Does this finding represent a CODE CHANGE the author agreed to make (as opposed to a comment,
// a reply, or a suggestion handed to someone else)? True when it carries a before→after draft that
// actually changes something AND the reviewer signed that change off — either via the finding-level
// decision (`edit` = fix + reply, `fix-only` = fix, no reply) or by accepting/editing its hunks in
// the diff. The hunk path matters: going straight from per-hunk Accept to Post never sets the
// finding-level `decision`, so keying off `decision` alone would leave the commonest case ungated.
// `redirect`/`reject` verdicts are excluded — those are explicitly "don't apply this".
function isAgreedCodeFix(finding) {
  const d = finding.draft;
  if (!d || typeof d.after !== 'string' || d.after === d.before) return false;
  const review = d.review || {};
  if (review.verdict === 'redirect' || review.verdict === 'reject') return false;
  if (finding.decision === 'edit' || finding.decision === 'fix-only') return true;
  return Object.values(review.hunks || {}).some((h) => h && (h.status === 'accepted' || h.status === 'edited'));
}

// THE GATE. Marking a `pr-respond` finding done means telling the reviewer their point is handled.
// When the agreed response is a code change, "handled" is only true if that change is actually on
// the branch — so stamping it REQUIRES the sha of the pushed commit that carries it.
//
// This exists because nothing used to tie a finding to the commit that fixed it, so a delivered fix
// and a missing one looked identical in the ledger. An audit found 11 findings across 5 workspaces
// closed as handled with no commit on file, and answering "did this actually ship?" took a
// commit-by-commit read of the repo — which is exactly the kind of question that gets answered
// confidently and wrongly. Prose in the skill ("apply, verify, commit, push, then reply") can be
// skipped while the reply still succeeds; a required sha cannot. No sha, no stamp, hard error, and
// the finding stays in the queue where the user can see it.
//
// A finding with an existing fixCommit passes (idempotent re-stamp). Comment/reply-only findings
// (no agreed code change) are unaffected — a reply IS the whole deliverable there.
// Only PR workspaces owe a git commit. A `spec` workspace's drafts are Confluence/ADO edits whose
// proof of delivery is `appliedAt` (markApplied), so demanding a sha there would be nonsense.
// Unknown/unreadable kind fails CLOSED (gate on) — the cost of an extra required flag is a moment's
// friction; the cost of a missed gate is a reviewer told a lie.
function owesGitCommit(featureId) {
  try {
    return (getFeature(featureId).kind || 'spec') !== 'spec';
  } catch {
    return true;
  }
}

function assertFixCommit(featureId, finding, sha) {
  if (!isAgreedCodeFix(finding)) return;
  if (!owesGitCommit(featureId)) return;
  if (finding.fixCommit && finding.fixCommit.sha) return;
  if (typeof sha === 'string' && sha.trim()) return;
  throw euser(
    `finding "${finding.fp}" is an agreed code fix (${finding.draft.target || finding.locus}) — `
    + 'it cannot be marked posted without the commit that carries it. Apply the change, commit and '
    + 'push it, then pass --sha <pushed commit sha>. If the fix was NOT made, run '
    + `\`finding cancel ${featureId} --fps ${finding.fp}\` instead — never reply claiming a fix that isn't on the branch.`);
}

// Record the pushed commit a fix landed in. Kept separate from the posted stamp so the trail shows
// the code went out before (or without) any comment about it.
function setFindingFixCommit(featureId, fp, { sha, repo = null, branch = null, by = 'apply' } = {}) {
  if (typeof sha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(sha.trim())) {
    throw euser(`invalid commit sha "${sha}": expected a 7–40 character hex git sha`);
  }
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
  const at = now();
  finding.fixCommit = { sha: sha.trim(), repo, branch, at };
  finding.history.push({ at, from: finding.status, to: finding.status, by, note: `fix pushed in ${sha.trim().slice(0, 10)}` });
  finding.updatedAt = at;
  saveLedger(ledger);
  return finding;
}

// Findings whose agreed code fix is claimed done but points at no commit — i.e. someone said
// "handled" without the change being on the branch. The cockpit badges these and /flowlever:watch
// reports them; ideally always empty.
function unbackedFixes(featureId) {
  if (!owesGitCommit(featureId)) return [];   // spec workspaces prove delivery with appliedAt
  return (loadLedger(featureId).findings || []).filter((f) =>
    isAgreedCodeFix(f) && (f.postedAt || f.status === 'resolved')
    && !(f.fixCommit && f.fixCommit.sha) && !f.appliedAt);
}

// Mark findings as posted back to the PR (their inline comment / reply has been sent).
// A posted finding stays `reworking` — so a later re-review reconciliation auto-resolves it
// once the author addresses it — but gains a `postedAt` stamp that moves it into the
// "Posted — awaiting author" lane and excludes it from the readiness penalty and the
// "to review" count. Idempotent: re-posting refreshes the stamp without duplicating history.
// `fps` may be a single fp or an array. Returns the updated findings.
// `sha` (+ optional repo/branch) is the pushed commit carrying the code fix. It is REQUIRED for any
// finding whose agreed response is a code change (see assertFixCommit) and ignored for reply-only
// ones. Validated for the whole batch BEFORE anything is written, so a mixed batch can't half-apply.
function markPosted(featureId, fps, { by = 'post', sha, repo = null, branch = null } = {}) {
  const list = Array.isArray(fps) ? fps : [fps];
  const ledger = loadLedger(featureId);
  const at = now();
  const uniq = [...new Set(list)];
  // Gate first, write second: all-or-nothing.
  for (const fp of uniq) {
    const finding = ledger.findings.find((f) => f.fp === fp);
    if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
    assertFixCommit(featureId, finding, sha);
  }
  const updated = [];
  for (const fp of uniq) {
    const finding = ledger.findings.find((f) => f.fp === fp);
    // Record the commit on the findings that represent a code fix, so the trail (and the cockpit)
    // can point at the change itself rather than just at a comment about it.
    if (typeof sha === 'string' && sha.trim() && isAgreedCodeFix(finding) && !(finding.fixCommit && finding.fixCommit.sha)) {
      finding.fixCommit = { sha: sha.trim(), repo, branch, at };
      finding.history.push({ at, from: finding.status, to: finding.status, by, note: `fix pushed in ${sha.trim().slice(0, 10)}` });
    }
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
    delete finding.pending;    // the in-flight "Posting…" marker is now resolved
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

// Spec mirror of markPosted: the runner has actually written the accepted change back to
// Confluence/ADO. Stamp `appliedAt` (→ "Applied — awaiting re-audit" lane), keep it `reworking`
// so the next /flowlever:audit reconciles it (auto-resolves if the spec now reflects the fix,
// keeps it open if not). Clears the in-flight "Applying…" marker. Idempotent.
function markApplied(featureId, fps, { by = 'apply' } = {}) {
  const list = Array.isArray(fps) ? fps : [fps];
  const ledger = loadLedger(featureId);
  const at = now();
  const updated = [];
  for (const fp of [...new Set(list)]) {
    const finding = ledger.findings.find((f) => f.fp === fp);
    if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
    if (finding.status === 'waived' || finding.status === 'resolved') continue; // not awaiting anything
    if (finding.status === 'open') {
      finding.history.push({ at, from: 'open', to: 'reworking', by, note: 'applied to spec' });
      finding.status = 'reworking';
      finding.resolvedInRound = null;
    } else if (!finding.appliedAt) {
      finding.history.push({ at, from: finding.status, to: finding.status, by, note: 'applied to spec' });
    }
    finding.appliedAt = at;
    delete finding.decision;
    delete finding.pending;
    finding.updatedAt = at;
    updated.push(finding);
  }
  saveLedger(ledger);
  return updated;
}

// Set the transient in-flight marker when the user confirms Post/Apply: the finding leaves the
// reviewer's queue and shows in the "Posting…/Applying…" lane until the runner stamps it done
// (markPosted/markApplied) or it's reopened. An open finding moves to `reworking` so it's no
// longer counted as untriaged. `kind` is 'post' | 'apply'. `fps` may be a single fp or array.
const PENDING_KINDS = ['post', 'apply'];
function setFindingPending(featureId, fps, kind, { by = 'user' } = {}) {
  if (!PENDING_KINDS.includes(kind)) {
    throw euser(`invalid pending kind "${kind}": must be one of ${PENDING_KINDS.join(', ')}`);
  }
  const list = Array.isArray(fps) ? fps : [fps];
  const ledger = loadLedger(featureId);
  const at = now();
  const updated = [];
  for (const fp of [...new Set(list)]) {
    const finding = ledger.findings.find((f) => f.fp === fp);
    if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
    if (finding.status === 'waived' || finding.status === 'resolved') continue;
    if (finding.status === 'open') {
      finding.history.push({ at, from: 'open', to: 'reworking', by, note: `queued for ${kind}` });
      finding.status = 'reworking';
      finding.resolvedInRound = null;
    }
    finding.pending = kind;
    finding.updatedAt = at;
    updated.push(finding);
  }
  saveLedger(ledger);
  return updated;
}

// Undo setFindingPending: drop the transient "Posting…/Applying…" marker WITHOUT claiming the
// write happened. Needed because a pending marker is otherwise a dead end — if the runner never
// picks the job up, dies mid-flight, or fails, the finding is stranded in the in-flight lane
// forever (excluded from the review queue AND never stamped posted/applied).
// Two callers: the cockpit's "Cancel post" on a stuck job, and the runner's error path.
// The finding returns to `reworking` with its triage intact, so it lands back in the post queue.
// Findings already stamped postedAt/appliedAt are left alone — that write really did happen.
// `fps` may be a single fp or an array; unknown fps throw. Returns the findings it changed.
function clearFindingPending(featureId, fps, { by = 'user', reason = '' } = {}) {
  const list = Array.isArray(fps) ? fps : [fps];
  const ledger = loadLedger(featureId);
  const at = now();
  const updated = [];
  for (const fp of [...new Set(list)]) {
    const finding = ledger.findings.find((f) => f.fp === fp);
    if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
    if (!finding.pending) continue;                     // nothing in flight — no-op
    if (finding.postedAt || finding.appliedAt) { delete finding.pending; updated.push(finding); continue; }
    const kind = finding.pending;
    delete finding.pending;
    finding.history.push({ at, from: finding.status, to: finding.status, by, note: reason || `cancelled queued ${kind}` });
    finding.updatedAt = at;
    updated.push(finding);
  }
  if (updated.length) saveLedger(ledger);
  return updated;
}

// Every finding of a workspace currently sitting in the in-flight lane — what a "cancel the
// stuck post/apply" action operates on when the caller doesn't name specific fps.
function pendingFindings(featureId) {
  return (loadLedger(featureId).findings || []).filter(isPending);
}

// The reviewer's triage decision on a PR comment that hasn't been posted yet:
// `approve` / `edit` mean "will post on the next Post" (the finding stays open/reworking);
// a dismiss is modelled by the `waived` status instead, not here. Persisting the decision
// (rather than holding it only in the browser's review flow) is what keeps the board, the
// stepper and the Post screen in sync and makes a decision survive a page refresh.
//
// `fix-only` (pr-respond) = **apply the code fix and post NO reply.** The runner commits and
// pushes the fix, then resolves the reviewer's thread by setting its ADO status to `Fixed`
// rather than writing a comment. Resolving matters: a thread left Active whose newest comment
// is still the reviewer's would be re-detected as "awaiting your reply" on every later sweep,
// so the item would come back forever. It's a distinct decision, not a flavour of `edit`,
// because the runner must know NOT to reply.
// Pass null to clear the decision (undo). Returns the finding.
const FINDING_DECISIONS = ['approve', 'edit', 'fix-only'];
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

// The reviewer's free-text NOTE on a finding (distinct from the audit `suggestion` and from a
// draft's counter-note): what they object to, their answer to a clarifying question, or context for
// whoever actions it. Lives on the finding so suggestion-only items (no code-diff draft) can still
// carry a reviewer response. Pass '' to clear. Surfaced in the card + the exported work order.
function setFindingNote(featureId, fp, note, { by = 'user' } = {}) {
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);
  const next = typeof note === 'string' ? note : '';
  if ((finding.note || '') === next) return finding;
  const at = now();
  if (next.trim()) finding.note = next; else delete finding.note;
  finding.history.push({ at, from: finding.status, to: finding.status, by, note: next.trim() ? 'reviewer note' : 'cleared note' });
  finding.updatedAt = at;
  saveLedger(ledger);
  return finding;
}

// Refine a finding's descriptive text without touching its identity. title, locus and
// dimension feed the fingerprint, so they are intentionally NOT editable here — changing
// them would create a different finding. detail/suggestion/severity can be corrected as
// understanding improves during refinement; a history entry records the refinement.
function setFindingDetails(featureId, fp, { detail, suggestion, severity, duplicateOf, by = 'user', note = '' } = {}) {
  const ledger = loadLedger(featureId);
  const finding = ledger.findings.find((f) => f.fp === fp);
  if (!finding) throw euser(`finding "${fp}" not found in ledger for "${featureId}"`);

  if (severity !== undefined && !SEVERITIES.includes(severity)) {
    throw euser(`invalid severity "${severity}": must be one of ${SEVERITIES.join(', ')}`);
  }
  if (duplicateOf !== undefined && duplicateOf !== null) validateDuplicateOf(duplicateOf);
  if (detail === undefined && suggestion === undefined && severity === undefined && duplicateOf === undefined) {
    throw euser('nothing to refine: provide detail, suggestion, severity or duplicateOf');
  }

  const at = now();
  const changed = [];
  if (detail !== undefined && detail !== finding.detail) { finding.detail = String(detail); changed.push('detail'); }
  if (suggestion !== undefined && suggestion !== finding.suggestion) { finding.suggestion = String(suggestion); changed.push('suggestion'); }
  if (duplicateOf !== undefined) { finding.duplicateOf = duplicateOf; changed.push(duplicateOf ? `marked duplicate of ${duplicateOf.label}` : 'duplicate mark cleared'); }
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
// A targetRef is the machine-addressable write target for a draft's surgical apply
// (distinct from `target`, the human-readable label). The spec proposer sets it so
// /flowlever:apply-spec knows exactly where to write — an ADO work-item field, or a
// Confluence page (optionally a section anchor + the version it was drafted against,
// so the writer can do optimistic-concurrency and patch one node instead of rewriting
// the whole page). Shape:
//   { system: 'ado',        adoId, field? }
//   { system: 'confluence', pageId, anchor?, version? }
// plus an optional `label`. Unknown/extra keys are dropped.
function normalizeTargetRef(ref) {
  if (typeof ref !== 'object' || ref === null) throw euser('targetRef must be an object');
  if (!TARGET_SYSTEMS.includes(ref.system)) {
    throw euser(`targetRef.system must be one of ${TARGET_SYSTEMS.join(', ')}`);
  }
  const out = { system: ref.system };
  if (ref.system === 'ado') {
    if (ref.adoId === undefined || ref.adoId === null || String(ref.adoId).trim() === '') {
      throw euser('targetRef for ado requires "adoId"');
    }
    out.adoId = typeof ref.adoId === 'number' ? ref.adoId : String(ref.adoId).trim();
    if (ref.field !== undefined && ref.field !== null) out.field = String(ref.field);
  } else {
    if (ref.pageId === undefined || ref.pageId === null || String(ref.pageId).trim() === '') {
      throw euser('targetRef for confluence requires "pageId"');
    }
    out.pageId = String(ref.pageId).trim();
    if (ref.anchor !== undefined && ref.anchor !== null) out.anchor = String(ref.anchor);
    if (ref.version !== undefined && ref.version !== null) {
      const v = Number(ref.version);
      if (!Number.isFinite(v)) throw euser('targetRef.version must be a number');
      out.version = v;
    }
  }
  if (ref.label !== undefined && ref.label !== null) out.label = String(ref.label);
  return out;
}

function setFindingDraft(featureId, fp, { target, targetRef, before, after, format = 'text', by = 'user' } = {}) {
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
  const draft = {
    target: typeof target === 'string' && target.trim() ? target : finding.locus,
    format,
    before,
    after,
    updatedAt: at,
  };
  if (targetRef !== undefined && targetRef !== null) {
    draft.targetRef = normalizeTargetRef(targetRef);
  } else if (finding.draft && finding.draft.targetRef) {
    // Re-drafting the text only (e.g. an edited proposal) keeps the machine write target.
    draft.targetRef = finding.draft.targetRef;
  }
  finding.draft = draft;
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
// `kind` narrows a `poll` (manual refresh) to one section; ignored for other actions.
function addRequest({ action, prId, wsId, title, instructions, kind } = {}) {
  if (!REQUEST_ACTIONS.includes(action)) {
    throw euser(`invalid action "${action}": must be one of ${REQUEST_ACTIONS.join(', ')}`);
  }
  if (kind !== undefined && kind !== null && String(kind).trim() !== '' && !REQUEST_KINDS.includes(kind)) {
    throw euser(`invalid kind "${kind}": must be one of ${REQUEST_KINDS.join(', ')}`);
  }
  if ((action === 'pr-review' || action === 'pr-respond') && (prId === undefined || prId === null || String(prId).trim() === '')) {
    throw euser(`${action} requires "prId"`);
  }
  if ((action === 'apply' || action === 're-audit' || action === 'propose') && (wsId === undefined || wsId === null || String(wsId).trim() === '')) {
    throw euser(`${action} requires "wsId"`);
  }
  // `audit` is either a NEW analysis (needs `instructions` = the spec/work-item/Figma URLs) or a
  // RE-AUDIT of an existing workspace (needs `wsId`; sources are already registered on it).
  if (action === 'audit'
    && (wsId === undefined || wsId === null || String(wsId).trim() === '')
    && (instructions === undefined || instructions === null || String(instructions).trim() === '')) {
    throw euser('audit requires "instructions" (URLs for a new analysis) or "wsId" (to re-audit an existing workspace)');
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
    // Section scope for a manual-refresh (`poll`) job; null = every PR kind.
    kind: kind === undefined || kind === null || String(kind).trim() === '' ? null : String(kind).trim(),
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
  REQUEST_KINDS,
  initDataDir,
  loadConfig,
  createFeature,
  getFeature,
  listFeatures,
  saveFeature,
  addSource,
  setFeatureStatus,
  setFeatureReview,
  reviewStamps,
  loadLedger,
  loadRounds,
  fingerprint,
  ingestRound,
  setFindingStatus,
  markPosted,
  markApplied,
  setFindingPending,
  clearFindingPending,
  pendingFindings,
  isAgreedCodeFix,
  setFindingFixCommit,
  unbackedFixes,
  isPosted,
  isApplied,
  isPending,
  setFindingDecision,
  setFindingNote,
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
