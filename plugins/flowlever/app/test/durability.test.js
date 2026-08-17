'use strict';

// Durability, concurrency and integrity — the axes the suite had no coverage on at all, which is
// how five blockers lived underneath a green run. Each test here reproduces a specific failure
// that was measured against the pre-fix code; the comment on each says what it used to do.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlever-dura-'));
process.env.FLOWLEVER_DATA = tmpDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/ledger');

const LEDGER_MODULE = require.resolve('../src/ledger');

function mkFinding(over = {}) {
  return {
    dimension: 'consistency',
    severity: 'major',
    title: 'A finding',
    detail: '',
    locus: 'l:1',
    suggestion: '',
    ...over,
  };
}

// Run `body` in N real child processes against the same data dir, in parallel.
function fanOut(count, body, args = []) {
  const script = path.join(tmpDir, `fan-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(script, `'use strict';\nconst L = require(${JSON.stringify(LEDGER_MODULE)});\n${body}\n`);
  const kids = [];
  for (let i = 0; i < count; i += 1) {
    kids.push(require('node:child_process').spawn(process.execPath, [script, String(i), ...args], {
      env: { ...process.env, FLOWLEVER_DATA: tmpDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    }));
  }
  return Promise.all(kids.map((k) => new Promise((resolve) => {
    let out = ''; let err = '';
    k.stdout.on('data', (d) => { out += d; });
    k.stderr.on('data', (d) => { err += d; });
    k.on('close', (code) => resolve({ code, out, err }));
  })));
}

before(() => { ledger.initDataDir(); });
after(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

// ---------- concurrency ----------

test('concurrent enqueues from separate processes do not lose writes', async () => {
  // Was: 6 processes x 40 addRequest() persisted 47 of 240 — every mutation was an unguarded
  // read-modify-write, so overlapping writers discarded each other's changes.
  const PROCS = 6; const PER = 25;
  const res = await fanOut(PROCS, `for (let i = 0; i < ${PER}; i++) L.addRequest({ action: 'pr-review', prId: String(i) });`);
  for (const r of res) assert.equal(r.code, 0, `child failed: ${r.err}`);

  const doc = ledger.loadRequests();
  assert.equal(doc.requests.length, PROCS * PER, 'every enqueue must persist');
  const ids = doc.requests.map((r) => r.id);
  assert.equal(new Set(ids).size, ids.length, 'no duplicate request ids');
});

test('claimNextRequest is exclusive: racing runners never claim the same job twice', async () => {
  // Was: list-then-set with no compare-and-swap, so 47 of 47 jobs were claimed by more than one
  // runner — i.e. every PR comment posted twice.
  const queued = ledger.listRequests({ status: 'queued' });
  assert.ok(queued.length > 0, 'previous test must leave a queue to drain');

  const res = await fanOut(4, `
    const got = [];
    for (;;) { const r = L.claimNextRequest({ by: process.pid }); if (!r) break; got.push(r.id); }
    process.stdout.write(JSON.stringify(got));
  `);
  for (const r of res) assert.equal(r.code, 0, `child failed: ${r.err}`);

  const claimed = res.flatMap((r) => JSON.parse(r.out || '[]'));
  assert.equal(new Set(claimed).size, claimed.length, 'a job may be claimed by exactly one runner');
  assert.equal(claimed.length, queued.length, 'the whole queue must drain');
  assert.equal(ledger.listRequests({ status: 'queued' }).length, 0);
});

test('claimRequest refuses a job that is no longer queued', () => {
  const r = ledger.addRequest({ action: 'pr-review', prId: '1' });
  const claimed = ledger.claimRequest(r.id, { by: 'runner-a' });
  assert.equal(claimed.status, 'running');
  assert.equal(claimed.claimedBy, 'runner-a');
  assert.throws(() => ledger.claimRequest(r.id, { by: 'runner-b' }),
    (e) => e.code === 'EUSER' && /another runner claimed it/.test(e.message));
});

test('concurrent decisions on disjoint findings all persist', async () => {
  // Was: 2 processes writing 60 disjoint findings persisted 32 — 28 lost.
  const id = 'race-dec';
  ledger.createFeature({ id, title: 'Race' });
  const N = 40;
  ledger.ingestRound(id, [...Array(N)].map((_, i) => mkFinding({ title: `F${i}`, locus: `l:${i}` })));
  const fps = ledger.loadLedger(id).findings.map((f) => f.fp);
  fs.writeFileSync(path.join(tmpDir, 'race-fps.json'), JSON.stringify(fps));

  const res = await fanOut(2, `
    const fps = JSON.parse(require('node:fs').readFileSync(process.env.FLOWLEVER_DATA + '/race-fps.json', 'utf8'));
    const half = Number(process.argv[2]);
    for (const fp of fps.filter((_, i) => i % 2 === half)) L.setFindingDecision('race-dec', fp, 'approve');
  `);
  for (const r of res) assert.equal(r.code, 0, `child failed: ${r.err}`);

  const decided = ledger.loadLedger(id).findings.filter((f) => f.decision === 'approve').length;
  assert.equal(decided, N, 'no decision may be lost to a concurrent writer');
});

// ---------- round-number integrity ----------

test('a round number is never reused when the rounds write is lost', () => {
  // Was: n came from rounds.length alone, so a failed rounds write let the next ingest reuse n and
  // point firstSeenRound/resolvedInRound at a round whose stats describe a different pass.
  const id = 'reuse';
  ledger.createFeature({ id, title: 'Reuse' });
  ledger.ingestRound(id, [mkFinding({ title: 'a', locus: 'a' })]);

  // Simulate the torn write: the ledger advanced to round 7, the rounds file never recorded it.
  const lp = path.join(tmpDir, 'ledger', `${id}.json`);
  const doc = JSON.parse(fs.readFileSync(lp, 'utf8'));
  doc.lastRound = 7;
  fs.writeFileSync(lp, JSON.stringify(doc));

  const { round } = ledger.ingestRound(id, [mkFinding({ title: 'b', locus: 'b' })]);
  assert.equal(round.n, 8, 'the next round must clear the highest number either store knows');
  const ns = ledger.loadRounds(id).rounds.map((r) => r.n);
  assert.equal(new Set(ns).size, ns.length, 'round numbers must stay unique');
});

// ---------- scope ----------

test('a scoped re-ingest leaves out-of-scope findings alone', () => {
  // Was: ingest had no notion of scope, so a re-review of one area auto-resolved every finding
  // outside it (as by:'reconcile') and flipped the gate to green.
  const id = 'scoped';
  ledger.createFeature({ id, title: 'Scoped' });
  ledger.ingestRound(id, [
    mkFinding({ severity: 'blocker', title: 'BE one', locus: 'be:1', dimension: 'feasibility' }),
    mkFinding({ severity: 'blocker', title: 'BE two', locus: 'be:2', dimension: 'feasibility' }),
    mkFinding({ title: 'FE one', locus: 'fe:1', dimension: 'design-match' }),
  ]);

  const { stats } = ledger.ingestRound(id, [mkFinding({ title: 'FE one', locus: 'fe:1', dimension: 'design-match' })],
    { scope: { dimensions: ['design-match'] } });

  assert.equal(stats.autoResolved, 0, 'nothing outside the scope may be closed');
  assert.equal(stats.outOfScopeSkipped, 2, 'and the skip is reported, not silent');
  assert.equal(ledger.readiness(id).gate, 'not-ready', 'the blockers still hold the gate');

  // A full sweep still reconciles exactly as before — the default is unchanged.
  const full = ledger.ingestRound(id, [mkFinding({ title: 'FE one', locus: 'fe:1', dimension: 'design-match' })]);
  assert.equal(full.stats.autoResolved, 2);
});

test('scope by fps, and a malformed scope is rejected', () => {
  const id = 'scoped-fps';
  ledger.createFeature({ id, title: 'ScopedFps' });
  ledger.ingestRound(id, [
    mkFinding({ title: 'keep', locus: 'k:1' }),
    mkFinding({ title: 'recheck', locus: 'r:1' }),
  ]);
  const recheckFp = ledger.fingerprint(id, 'consistency', 'recheck', 'r:1');

  const { stats } = ledger.ingestRound(id, [], { scope: { fps: [recheckFp] } });
  assert.equal(stats.autoResolved, 1, 'the in-scope finding is gone from the batch, so it resolves');
  assert.equal(stats.outOfScopeSkipped, 1, 'the other one was never looked at');

  assert.throws(() => ledger.ingestRound(id, [], { scope: 'front-end only' }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.ingestRound(id, [], { scope: {} }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.ingestRound(id, [], { scope: { fps: [''] } }), (e) => e.code === 'EUSER');
});

// ---------- the fix gate ----------

function seedAgreedFix(id, title = 'Fix it', locus = 'pr:1:a.cs:9') {
  ledger.createFeature({ id, title: `WS ${id}`, kind: 'pr-respond' });
  ledger.ingestRound(id, [mkFinding({ title, locus })]);
  const fp = ledger.fingerprint(id, 'consistency', title, locus);
  ledger.setFindingDraft(id, fp, { before: 'old', after: 'new' });
  ledger.setFindingDecision(id, fp, 'fix-only');   // finding-level sign-off, no per-hunk accepts
  return fp;
}

test('the fix gate survives a status change (a status change no longer disarms it)', () => {
  // Was: setFindingStatus deleted `decision`, which isAgreedCodeFix keyed off — so ANY status
  // change (including the cockpit's own "mark in-flight") silently un-gated the finding.
  const id = 'gate-status';
  const fp = seedAgreedFix(id);
  assert.ok(ledger.isAgreedCodeFix(ledger.loadLedger(id).findings[0]));

  ledger.setFindingStatus(id, fp, { status: 'reworking' });
  const after = ledger.loadLedger(id).findings[0];
  assert.equal(after.decision, undefined, 'the transient triage decision is still superseded');
  assert.equal(after.agreedCodeFix, 'fix-only', 'but the durable agreement remains');
  assert.ok(ledger.isAgreedCodeFix(after), 'so the finding is still an agreed code fix');

  assert.throws(() => ledger.markPosted(id, [fp]),
    (e) => e.code === 'EUSER' && /cannot be marked posted without the commit/.test(e.message));
});

test('the gate rejects a non-sha (the HTTP path used to accept any non-empty string)', () => {
  const id = 'gate-sha';
  const fp = seedAgreedFix(id);
  for (const bad of ['lol-no-commit', 'zzzz', '123', 'not a sha at all']) {
    assert.throws(() => ledger.markPosted(id, [fp], { sha: bad }),
      (e) => e.code === 'EUSER' && /invalid commit sha/.test(e.message), `accepted "${bad}"`);
  }
  const [f] = ledger.markPosted(id, [fp], { sha: 'a1b2c3d4e5f6' });
  assert.equal(f.fixCommit.sha, 'a1b2c3d4e5f6');
});

test('unbackedFixes catches a decision-only agreement closed with no commit', () => {
  // Was: the same delete-decision wiped the evidence, so the audit built to catch exactly this
  // reported "No unbacked fixes" for a resolved code fix with nothing on the branch.
  const id = 'gate-audit';
  const fp = seedAgreedFix(id, 'Unbacked', 'pr:2:b.cs:3');
  ledger.setFindingStatus(id, fp, { status: 'resolved' });   // the ungated, documented path
  const unbacked = ledger.unbackedFixes(id);
  assert.equal(unbacked.length, 1, 'the unbacked fix must be visible to the audit');
  assert.equal(unbacked[0].fp, fp);
});

test('explicitly undoing the decision DOES retract the agreement', () => {
  const id = 'gate-undo';
  const fp = seedAgreedFix(id, 'Undo me', 'pr:3:c.cs:1');
  ledger.setFindingDecision(id, fp, null);
  const f = ledger.loadLedger(id).findings[0];
  assert.equal(f.agreedCodeFix, undefined);
  assert.equal(ledger.isAgreedCodeFix(f), false, 'an undone decision is not an agreement');
  assert.doesNotThrow(() => ledger.markPosted(id, [fp]));
});

test('keepDecision preserves triage for a workflow transition', () => {
  // The finish screen's "mark these in-flight" is not a re-triage: clearing the decision there
  // sent suggestion-only findings back to Undecided and left the export empty.
  const id = 'keep-dec';
  ledger.createFeature({ id, title: 'Keep' });
  ledger.ingestRound(id, [mkFinding({ title: 'K1', locus: 'k:1' })]);
  const fp = ledger.fingerprint(id, 'consistency', 'K1', 'k:1');
  ledger.setFindingDecision(id, fp, 'approve');

  ledger.setFindingStatus(id, fp, { status: 'reworking', keepDecision: true });
  assert.equal(ledger.loadLedger(id).findings[0].decision, 'approve');

  ledger.setFindingStatus(id, fp, { status: 'open' });   // a real re-triage still clears it
  assert.equal(ledger.loadLedger(id).findings[0].decision, undefined);
});

// ---------- malformed persisted state ----------

test('a legacy array-shaped ledger reads instead of throwing', () => {
  // Was: report.js tolerated the array shape while computeReadiness did not, so the same file both
  // worked and 500'd depending on the route.
  const id = 'legacy-arr';
  ledger.createFeature({ id, title: 'Legacy' });
  fs.writeFileSync(path.join(tmpDir, 'ledger', `${id}.json`), JSON.stringify([
    { fp: 'aaaaaaaaaa', dimension: 'dor', severity: 'blocker', title: 'row', locus: 'x', status: 'open' },
  ]));
  const r = ledger.readiness(id);
  assert.equal(r.openBySeverity.blocker, 1);
  assert.equal(r.gate, 'not-ready');
});

test('a ledger missing findings, or holding junk entries, degrades safely', () => {
  const id = 'legacy-junk';
  ledger.createFeature({ id, title: 'Junk' });
  fs.writeFileSync(path.join(tmpDir, 'ledger', `${id}.json`), JSON.stringify({ featureId: id }));
  assert.equal(ledger.readiness(id).openCount, 0);

  fs.writeFileSync(path.join(tmpDir, 'ledger', `${id}.json`), JSON.stringify({
    featureId: id, findings: [null, 'nope', { fp: 'x', severity: 'major', status: 'open' }],
  }));
  assert.equal(ledger.loadLedger(id).findings.length, 1, 'junk entries are dropped, not crashed on');
  assert.ok(Array.isArray(ledger.loadLedger(id).findings[0].history), 'history is normalized for pushes');
});

test('a corrupt JSON file surfaces as EUSER naming the file, not a raw SyntaxError', () => {
  const id = 'corrupt';
  ledger.createFeature({ id, title: 'Corrupt' });
  fs.writeFileSync(path.join(tmpDir, 'ledger', `${id}.json`), '{ this is not json');
  assert.throws(() => ledger.readiness(id),
    (e) => e.code === 'EUSER' && /is not valid JSON/.test(e.message) && e.message.includes(`${id}.json`));
});

test('a feature file written before `sources` existed still accepts a source', () => {
  // Was: normalizeFeature back-filled only `kind`, so feature.sources[type].push threw TypeError
  // and surfaced as a 500 rather than a user error.
  const id = 'old-schema';
  fs.writeFileSync(path.join(tmpDir, 'features', `${id}.json`), JSON.stringify({
    id, title: 'Old', status: 'draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  }));
  assert.doesNotThrow(() => ledger.addSource(id, { type: 'confluence', id: '123', title: 'Spec' }));
  assert.equal(ledger.getFeature(id).sources.confluence.length, 1);
  assert.deepEqual(ledger.getFeature(id).coverage, []);
});

test('a partial config.json does not brick readiness or ingest', () => {
  // Was: loadConfig returned the raw file, so dropping `gates` while tuning weights made every
  // readiness call and every ingest throw TypeError behind "Internal server error".
  const cfg = path.join(tmpDir, 'config.json');
  const original = fs.readFileSync(cfg, 'utf8');
  try {
    fs.writeFileSync(cfg, JSON.stringify({ severityWeights: { blocker: 10 } }));
    const c = ledger.loadConfig();
    assert.equal(c.gates.readyThreshold, 85, 'missing gates fall back to defaults');
    assert.equal(c.severityWeights.major, 5, 'a missing weight is never free');
    assert.ok(Array.isArray(c.dimensions) && c.dimensions.length > 0);

    const id = 'partial-cfg';
    ledger.createFeature({ id, title: 'Partial' });
    assert.doesNotThrow(() => ledger.ingestRound(id, [mkFinding({ title: 'p', locus: 'p' })]));
    assert.equal(typeof ledger.readiness(id).score, 'number');

    fs.writeFileSync(cfg, JSON.stringify({ gates: null, dimensions: [], severityWeights: 'nope' }));
    assert.deepEqual(ledger.loadConfig(), ledger.mergeConfig(null), 'junk collapses to defaults');
  } finally {
    fs.writeFileSync(cfg, original);
  }
});

test('scaling severityWeights with scoreZeroAtPenalty keeps scores comparable', () => {
  // Was: the normalizing constant was hardcoded at 40, so scaling the documented weights collapsed
  // every score to 0 and silently redefined what readyThreshold meant.
  const cfg = path.join(tmpDir, 'config.json');
  const original = fs.readFileSync(cfg, 'utf8');
  try {
    const id = 'weights';
    ledger.createFeature({ id, title: 'Weights' });
    ledger.ingestRound(id, [mkFinding({ title: 'm1', locus: '1' }), mkFinding({ title: 'm2', locus: '2' })]);
    const base = ledger.readiness(id).score;

    fs.writeFileSync(cfg, JSON.stringify({
      severityWeights: { blocker: 100, major: 50, minor: 20, info: 5 },
      gates: { blockerOpenMeansNotReady: true, readyThreshold: 85, scoreZeroAtPenalty: 400 },
    }));
    assert.equal(ledger.readiness(id).score, base, 'x10 weights with x10 scale is the same score');
  } finally {
    fs.writeFileSync(cfg, original);
  }
});

// ---------- id validation (the traversal guard) ----------

test('every id-to-path helper refuses an id that escapes the data dir', () => {
  // Was: only createFeature validated, while every read/write/delete built a path from the raw id —
  // and the HTTP layer percent-decodes, so ..%2f..%2fsecret reached the filesystem.
  const bad = ['../../etc/passwd', '../secret', 'a/b', 'UPPER', 'has space', '', '.', '..',
    'x'.repeat(65), 'semi;colon'];
  for (const id of bad) {
    assert.throws(() => ledger.loadLedger(id), (e) => e.code === 'EUSER', `loadLedger accepted "${id}"`);
    assert.throws(() => ledger.getFeature(id), (e) => e.code === 'EUSER', `getFeature accepted "${id}"`);
    assert.throws(() => ledger.deleteFeature(id), (e) => e.code === 'EUSER', `deleteFeature accepted "${id}"`);
    assert.throws(() => ledger.readiness(id), (e) => e.code === 'EUSER', `readiness accepted "${id}"`);
    assert.equal(ledger.isValidFeatureId(id), false);
  }
  assert.ok(ledger.isValidFeatureId('pr-482-checkout-api'));
});

test('deleteFeature does not delete anything outside the data dir', () => {
  const outside = path.join(tmpDir, '..', `fl-must-survive-${process.pid}.json`);
  fs.writeFileSync(outside, '{"keep":true}');
  try {
    assert.throws(() => ledger.deleteFeature(`..${path.sep}fl-must-survive-${process.pid}`),
      (e) => e.code === 'EUSER');
    assert.ok(fs.existsSync(outside), 'the file outside the data dir must still exist');
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

// ---------- bookkeeping honesty ----------

test('addSource is idempotent per key field instead of appending duplicates', () => {
  const id = 'dedupe-src';
  ledger.createFeature({ id, title: 'Dedupe' });
  ledger.addSource(id, { type: 'confluence', id: '555', title: 'Spec' });
  ledger.addSource(id, { type: 'confluence', id: '555', title: 'Spec (renamed)' });
  const list = ledger.getFeature(id).sources.confluence;
  assert.equal(list.length, 1, 'the same page must not be registered twice');
  assert.equal(list[0].title, 'Spec (renamed)', 're-adding updates the entry');

  ledger.addSource(id, { type: 'figma', fileKey: 'aBc', nodeId: '1:23' });
  ledger.addSource(id, { type: 'figma', fileKey: 'aBc', nodeId: '9:99' });
  assert.equal(ledger.getFeature(id).sources.figma.length, 1);
  assert.equal(ledger.getFeature(id).sources.figma[0].nodeId, '9:99');
});

test('the request counter never reissues an id after a deletion', () => {
  // Was: the fallback was requests.length, and deleteRequest splices without touching the counter,
  // so after a deletion the next enqueue minted an id that already existed — and find/findIndex
  // then operated on the wrong request.
  const a = ledger.addRequest({ action: 'pr-review', prId: 'a' });
  const b = ledger.addRequest({ action: 'pr-review', prId: 'b' });
  ledger.deleteRequest(a.id);
  ledger.deleteRequest(b.id);

  const doc = ledger.loadRequests();
  const raw = { counter: undefined, requests: doc.requests };
  fs.writeFileSync(path.join(tmpDir, 'requests.json'), JSON.stringify(raw));   // drop the counter

  const c = ledger.addRequest({ action: 'pr-review', prId: 'c' });
  const all = ledger.loadRequests().requests.map((r) => r.id);
  assert.equal(new Set(all).size, all.length, 'no id may be reused');
  assert.ok(!all.filter((x) => x === c.id).slice(1).length);
});

test('deleteFeature fails the queued jobs that pointed at the deleted workspace', () => {
  // Was: they stayed `queued`, so the runner would pick one up and fail against a workspace that
  // no longer exists, and the cockpit showed a job stalled forever.
  const id = 'del-with-jobs';
  ledger.createFeature({ id, title: 'Has jobs' });
  const q = ledger.addRequest({ action: 'apply', wsId: id });
  const other = ledger.addRequest({ action: 'apply', wsId: 'some-other-ws' });

  const res = ledger.deleteFeature(id);
  assert.deepEqual(res.cancelledRequests, [q.id]);
  const after = ledger.loadRequests().requests;
  assert.equal(after.find((r) => r.id === q.id).status, 'error');
  assert.match(after.find((r) => r.id === q.id).note, /was deleted before this job ran/);
  assert.equal(after.find((r) => r.id === other.id).status, 'queued', 'unrelated jobs are untouched');
});

test('bulk apply/pending report WHICH findings they passed over', () => {
  // Was: waived/resolved fps were skipped silently and the caller only saw a smaller count.
  const id = 'skip-report';
  ledger.createFeature({ id, title: 'Skips' });
  ledger.ingestRound(id, [
    mkFinding({ title: 'live', locus: 's:1' }),
    mkFinding({ title: 'gone', locus: 's:2' }),
  ]);
  const live = ledger.fingerprint(id, 'consistency', 'live', 's:1');
  const gone = ledger.fingerprint(id, 'consistency', 'gone', 's:2');
  ledger.setFindingStatus(id, gone, { status: 'waived', reason: 'out of scope' });

  const applied = ledger.markApplied(id, [live, gone], { detailed: true });
  assert.equal(applied.updated.length, 1);
  assert.deepEqual(applied.skipped, [{ fp: gone, reason: 'waived' }]);

  const pending = ledger.setFindingPending(id, [live, gone], 'apply', { detailed: true });
  assert.equal(pending.updated.length, 1);
  assert.deepEqual(pending.skipped, [{ fp: gone, reason: 'waived' }]);

  // The bare-array return is unchanged for existing callers.
  assert.ok(Array.isArray(ledger.markApplied(id, [live])));
});

test('ingest counts real in-batch duplicates instead of dropping them silently', () => {
  const id = 'dupe-count';
  ledger.createFeature({ id, title: 'Dupes' });
  const f = mkFinding({ title: 'Same thing', locus: 'd:1' });
  const { stats } = ledger.ingestRound(id, [f, { ...f }, { ...f }]);
  assert.equal(stats.new, 1);
  assert.equal(stats.duplicatesInBatch, 2, 'the drops are reported');
});
