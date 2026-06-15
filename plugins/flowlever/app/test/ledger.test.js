'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Must be set BEFORE requiring the module under test.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlever-test-'));
process.env.FLOWLEVER_DATA = tmpDir;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/ledger');

function mkFinding(over = {}) {
  return {
    dimension: 'consistency',
    severity: 'major',
    title: 'Spec and ADO disagree on payment methods',
    detail: 'Spec lists 3, AC lists 4.',
    locus: 'confluence:1#flow vs ado:42695',
    suggestion: 'Align them.',
    ...over,
  };
}

before(() => {
  ledger.initDataDir();
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('DATA_DIR honours FLOWLEVER_DATA and initDataDir scaffolds the layout', () => {
  assert.equal(ledger.DATA_DIR, tmpDir);
  for (const sub of ['features', 'ledger', 'rounds']) {
    assert.ok(fs.existsSync(path.join(tmpDir, sub)), `missing data/${sub}`);
  }
  const config = ledger.loadConfig();
  assert.equal(config.severityWeights.blocker, 10);
  assert.equal(config.gates.readyThreshold, 85);
  assert.equal(config.dimensions.length, 7);
});

test('feature CRUD: create, get, list, duplicate and bad id rejection', () => {
  const f = ledger.createFeature({ id: 'checkout-redesign', title: 'Checkout Redesign' });
  assert.equal(f.status, 'draft');
  assert.deepEqual(f.sources, { confluence: [], ado: [], figma: [] });

  const loaded = ledger.getFeature('checkout-redesign');
  assert.equal(loaded.title, 'Checkout Redesign');
  assert.ok(ledger.listFeatures().some((x) => x.id === 'checkout-redesign'));

  assert.throws(() => ledger.createFeature({ id: 'checkout-redesign', title: 'Dup' }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.createFeature({ id: 'Bad_ID!', title: 'x' }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.getFeature('nope'), (e) => e.code === 'EUSER');
});

test('kind: defaults to spec, validates the enum, accepts the three kinds', () => {
  // Default when omitted.
  const def = ledger.createFeature({ id: 'kind-default', title: 'No kind given' });
  assert.equal(def.kind, 'spec');
  assert.equal(ledger.getFeature('kind-default').kind, 'spec');

  // Each valid kind is stored verbatim.
  for (const kind of ledger.KINDS) {
    const id = `kind-${kind}`;
    const f = ledger.createFeature({ id, title: `A ${kind} workspace`, kind });
    assert.equal(f.kind, kind);
    assert.equal(ledger.getFeature(id).kind, kind);
  }

  // Bad kind is rejected as a user error.
  assert.throws(() => ledger.createFeature({ id: 'kind-bad', title: 'x', kind: 'nope' }), (e) => e.code === 'EUSER');
});

test('kind: a feature on disk with no kind field is treated as spec (back-compat)', () => {
  const id = 'legacy-no-kind';
  ledger.createFeature({ id, title: 'Legacy workspace' });
  // Simulate pre-`kind` data by stripping the field on disk.
  const file = path.join(tmpDir, 'features', `${id}.json`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  delete raw.kind;
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));

  assert.equal(ledger.getFeature(id).kind, 'spec');
  assert.equal(ledger.listFeatures().find((x) => x.id === id).kind, 'spec');
});

test('addSource validates type and stores entries with lastFetched=null', () => {
  ledger.addSource('checkout-redesign', { type: 'confluence', id: '123456', title: 'Spec', url: 'https://c' });
  ledger.addSource('checkout-redesign', { type: 'ado', id: 42695, itemType: 'User Story', title: 'Story', url: 'https://a', state: 'New' });
  const f = ledger.getFeature('checkout-redesign');
  assert.equal(f.sources.confluence[0].lastFetched, null);
  assert.equal(f.sources.ado[0].type, 'User Story');
  assert.throws(() => ledger.addSource('checkout-redesign', { type: 'jira', id: '1' }), (e) => e.code === 'EUSER');
});

test('fingerprint: 10-char sha1 slice, normalization-stable, locus-sensitive', () => {
  const a = ledger.fingerprint('feat', 'consistency', 'Hello,   World!', 'loc:1');
  const b = ledger.fingerprint('feat', 'consistency', 'hello world', 'loc:1');
  const c = ledger.fingerprint('feat', 'consistency', '  HELLO -- world??  ', 'loc:1');
  assert.match(a, /^[0-9a-f]{10}$/);
  assert.equal(a, b, 'case/punctuation/whitespace variants must share a fingerprint');
  assert.equal(a, c);
  assert.notEqual(a, ledger.fingerprint('feat', 'consistency', 'hello world', 'loc:2'), 'different locus');
  assert.notEqual(a, ledger.fingerprint('feat', 'completeness', 'hello world', 'loc:1'), 'different dimension');
  // truncation to 80 chars: divergence after char 80 is invisible
  const long = 'x'.repeat(80);
  assert.equal(
    ledger.fingerprint('feat', 'dor', long + 'aaa', 'l'),
    ledger.fingerprint('feat', 'dor', long + 'bbb', 'l')
  );
});

test('validateIngestFinding rejects bad dimension/severity/missing fields', () => {
  assert.throws(() => ledger.validateIngestFinding(mkFinding({ dimension: 'vibes' })), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.validateIngestFinding(mkFinding({ severity: 'huge' })), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.validateIngestFinding(mkFinding({ title: '' })), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.validateIngestFinding(mkFinding({ locus: '  ' })), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.validateIngestFinding(mkFinding({ detail: 42 })), (e) => e.code === 'EUSER');
  assert.equal(ledger.validateIngestFinding(mkFinding()).severity, 'major');
});

test('ingest round 1 inserts findings as open with firstSeenRound=1', () => {
  ledger.createFeature({ id: 'ing', title: 'Ingest' });
  const { round, stats } = ledger.ingestRound('ing', [
    mkFinding({ title: 'Finding A', locus: 'a' }),
    mkFinding({ title: 'Finding B', locus: 'b', severity: 'minor' }),
  ], { note: 'first audit' });

  assert.equal(stats.new, 2);
  assert.equal(stats.totalOpen, 2);
  assert.equal(round.n, 1);
  assert.equal(round.note, 'first audit');
  assert.equal(round.trigger, 'audit');

  const led = ledger.loadLedger('ing');
  assert.equal(led.findings.length, 2);
  const a = led.findings.find((f) => f.title === 'Finding A');
  assert.equal(a.status, 'open');
  assert.equal(a.firstSeenRound, 1);
  assert.equal(a.lastSeenRound, 1);
  assert.equal(a.pinned, false);
  assert.equal(a.resolvedInRound, null);
});

test('ingest round 2: same finding refreshes lastSeenRound without duplicating', () => {
  const { stats } = ledger.ingestRound('ing', [
    mkFinding({ title: 'Finding A', locus: 'a', detail: 'updated detail' }),
    mkFinding({ title: 'Finding B', locus: 'b', severity: 'minor' }),
  ]);
  assert.equal(stats.new, 0);
  assert.equal(stats.stillOpen, 2);

  const led = ledger.loadLedger('ing');
  assert.equal(led.findings.length, 2, 'no duplicate rows');
  const a = led.findings.find((f) => f.title === 'Finding A');
  assert.equal(a.lastSeenRound, 2);
  assert.equal(a.firstSeenRound, 1);
  assert.equal(a.detail, 'updated detail');
});

test('ingest: finding absent from the round auto-resolves via reconcile', () => {
  const { stats } = ledger.ingestRound('ing', [mkFinding({ title: 'Finding A', locus: 'a' })]);
  assert.equal(stats.autoResolved, 1);

  const b = ledger.loadLedger('ing').findings.find((f) => f.title === 'Finding B');
  assert.equal(b.status, 'resolved');
  assert.equal(b.resolvedInRound, 3);
  const h = b.history.at(-1);
  assert.equal(h.by, 'reconcile');
  assert.equal(h.from, 'open');
  assert.equal(h.to, 'resolved');
});

test('pinned findings are never auto-resolved', () => {
  ledger.createFeature({ id: 'pin', title: 'Pin' });
  ledger.ingestRound('pin', [mkFinding({ title: 'Pinned one', locus: 'p' })]);
  const fp = ledger.loadLedger('pin').findings[0].fp;
  ledger.setFindingStatus('pin', fp, { pinned: true });

  const { stats } = ledger.ingestRound('pin', []);
  assert.equal(stats.autoResolved, 0);
  const f = ledger.loadLedger('pin').findings[0];
  assert.equal(f.status, 'open');
  assert.equal(f.pinned, true);
});

test('regression: closed finding re-flagged without reopenResolved stays resolved but is counted', () => {
  const finding = mkFinding({ title: 'Finding B', locus: 'b', severity: 'minor' });
  const { stats } = ledger.ingestRound('ing', [mkFinding({ title: 'Finding A', locus: 'a' }), finding]);
  assert.equal(stats.regressions, 1);
  assert.equal(stats.new, 0);

  const b = ledger.loadLedger('ing').findings.find((f) => f.title === 'Finding B');
  assert.equal(b.status, 'resolved', 'stays resolved without reopenResolved');
});

test('regression with reopenResolved:true reopens and clears resolvedInRound', () => {
  const finding = mkFinding({ title: 'Finding B', locus: 'b', severity: 'minor' });
  const { stats } = ledger.ingestRound('ing', [mkFinding({ title: 'Finding A', locus: 'a' }), finding], { reopenResolved: true });
  assert.equal(stats.regressions, 1);

  const b = ledger.loadLedger('ing').findings.find((f) => f.title === 'Finding B');
  assert.equal(b.status, 'open');
  assert.equal(b.resolvedInRound, null);
  const h = b.history.at(-1);
  assert.equal(h.from, 'resolved');
  assert.equal(h.to, 'open');
  assert.equal(h.by, 'reconcile');
});

test('setFindingStatus: waive requires reason; transitions append history', () => {
  const fp = ledger.loadLedger('ing').findings.find((f) => f.title === 'Finding A').fp;
  assert.throws(() => ledger.setFindingStatus('ing', fp, { status: 'waived' }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.setFindingStatus('ing', 'ffffffffff', { status: 'open' }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.setFindingStatus('ing', fp, { status: 'banished' }), (e) => e.code === 'EUSER');

  const before = ledger.loadLedger('ing').findings.find((f) => f.fp === fp).history.length;
  const waived = ledger.setFindingStatus('ing', fp, { status: 'waived', reason: 'accepted risk' });
  assert.equal(waived.status, 'waived');
  assert.equal(waived.statusReason, 'accepted risk');
  assert.equal(waived.history.length, before + 1);
  assert.equal(waived.history.at(-1).by, 'user');

  const reopened = ledger.setFindingStatus('ing', fp, { status: 'open' });
  assert.equal(reopened.status, 'open');
  assert.equal(reopened.resolvedInRound, null);
  assert.equal(reopened.history.length, before + 2);
});

test('readiness math: 2 blockers + 1 major → 25 penalty → score 38, not-ready', () => {
  ledger.createFeature({ id: 'score', title: 'Score' });
  ledger.ingestRound('score', [
    mkFinding({ title: 'B1', locus: '1', severity: 'blocker' }),
    mkFinding({ title: 'B2', locus: '2', severity: 'blocker' }),
    mkFinding({ title: 'M1', locus: '3', severity: 'major' }),
  ]);
  const r = ledger.readiness('score');
  assert.equal(r.score, 38);
  assert.equal(r.gate, 'not-ready');
  assert.deepEqual(r.openBySeverity, { blocker: 2, major: 1, minor: 0, info: 0 });
  assert.equal(r.openCount, 3);
  assert.equal(r.blockers.length, 2);
});

test('readiness gates: zero open → 100/ready; minors straddle the threshold', () => {
  ledger.createFeature({ id: 'clean', title: 'Clean' });
  ledger.ingestRound('clean', []);
  const clean = ledger.readiness('clean');
  assert.equal(clean.score, 100);
  assert.equal(clean.gate, 'ready');

  // 3 minors → penalty 6 → score 85 → ready (>= threshold, no blockers)
  ledger.createFeature({ id: 'minors', title: 'Minors' });
  ledger.ingestRound('minors', [1, 2, 3].map((i) => mkFinding({ title: `m${i}`, locus: `${i}`, severity: 'minor' })));
  assert.deepEqual(
    [ledger.readiness('minors').score, ledger.readiness('minors').gate],
    [85, 'ready']
  );

  // 4th minor → penalty 8 → score 80 → in-progress
  ledger.ingestRound('minors', [1, 2, 3, 4].map((i) => mkFinding({ title: `m${i}`, locus: `${i}`, severity: 'minor' })));
  assert.deepEqual(
    [ledger.readiness('minors').score, ledger.readiness('minors').gate],
    [80, 'in-progress']
  );
});

test('rounds file records stats and readiness snapshot per round', () => {
  const rounds = ledger.loadRounds('ing');
  assert.ok(rounds.rounds.length >= 5);
  const r1 = rounds.rounds[0];
  assert.equal(r1.n, 1);
  assert.equal(r1.stats.new, 2);
  assert.ok(r1.readiness && typeof r1.readiness.score === 'number');
  assert.ok(r1.readiness.openBySeverity);
  assert.ok(rounds.rounds.every((r, i) => r.n === i + 1), 'round numbers are sequential');
  // empty-shape contract for unknown features
  assert.deepEqual(ledger.loadLedger('ghost'), { featureId: 'ghost', findings: [] });
  assert.deepEqual(ledger.loadRounds('ghost'), { featureId: 'ghost', rounds: [] });
});

test('setCoverage validates statuses and persists into the feature', () => {
  assert.throws(
    () => ledger.setCoverage('checkout-redesign', [{ sectionKey: 'x', status: 'maybe' }]),
    (e) => e.code === 'EUSER'
  );
  const cov = [
    { sectionKey: 'flow-payment', adoIds: [42695], figmaNodeIds: ['1:23'], status: 'covered' },
    { sectionKey: null, adoIds: [99], figmaNodeIds: [], status: 'orphan' },
  ];
  const f = ledger.setCoverage('checkout-redesign', cov);
  assert.deepEqual(f.coverage, cov);
  assert.deepEqual(ledger.getFeature('checkout-redesign').coverage, cov);
});

test('setFindingDetails refines text + severity, keeps fingerprint stable, logs history', () => {
  ledger.createFeature({ id: 'refine-me', title: 'Refine' });
  ledger.ingestRound('refine-me', [mkFinding()], {});
  const fp = ledger.fingerprint('refine-me', 'consistency', 'Spec and ADO disagree on payment methods', 'confluence:1#flow vs ado:42695');

  const updated = ledger.setFindingDetails('refine-me', fp, {
    detail: 'Refined detail.', suggestion: 'Refined suggestion.', severity: 'blocker', note: 'sharpened',
  });
  assert.equal(updated.fp, fp, 'fingerprint must not change');
  assert.equal(updated.title, 'Spec and ADO disagree on payment methods', 'title (identity) untouched');
  assert.equal(updated.detail, 'Refined detail.');
  assert.equal(updated.suggestion, 'Refined suggestion.');
  assert.equal(updated.severity, 'blocker');
  const last = updated.history[updated.history.length - 1];
  assert.equal(last.note, 'sharpened');
  assert.equal(last.from, last.to, 'refinement is not a status transition');

  // re-audit with the ORIGINAL finding still reconciles to the same record (identity held)
  const before = ledger.loadLedger('refine-me').findings.length;
  ledger.ingestRound('refine-me', [mkFinding()], {});
  assert.equal(ledger.loadLedger('refine-me').findings.length, before, 'no duplicate created');

  assert.throws(() => ledger.setFindingDetails('refine-me', fp, { severity: 'huge' }), /invalid severity/);
  assert.throws(() => ledger.setFindingDetails('refine-me', fp, {}), /nothing to refine/);
});

test('setFindingDraft sets a draft, logs history, keeps fingerprint stable', () => {
  ledger.createFeature({ id: 'draft-me', title: 'Draft' });
  ledger.ingestRound('draft-me', [mkFinding()], {});
  const fp = ledger.fingerprint('draft-me', 'consistency', 'Spec and ADO disagree on payment methods', 'confluence:1#flow vs ado:42695');

  const before = ledger.loadLedger('draft-me').findings.find((f) => f.fp === fp);
  const histLen = before.history.length;

  const updated = ledger.setFindingDraft('draft-me', fp, {
    target: 'Spec › Payment methods', format: 'markdown',
    before: 'card\nPayPal', after: 'card\nPayPal\nTwint',
  });
  assert.equal(updated.fp, fp, 'fingerprint must not change');
  assert.ok(updated.draft, 'draft is set');
  assert.equal(updated.draft.target, 'Spec › Payment methods');
  assert.equal(updated.draft.format, 'markdown');
  assert.equal(updated.draft.before, 'card\nPayPal');
  assert.equal(updated.draft.after, 'card\nPayPal\nTwint');
  assert.ok(updated.draft.updatedAt, 'draft carries updatedAt');
  assert.equal(updated.history.length, histLen + 1, 'history entry appended');
  assert.equal(updated.history.at(-1).note, 'drafted change');
  assert.equal(updated.history.at(-1).from, updated.history.at(-1).to, 'drafting is not a status transition');

  // persisted to disk
  const reread = ledger.loadLedger('draft-me').findings.find((f) => f.fp === fp);
  assert.equal(reread.draft.after, 'card\nPayPal\nTwint');

  // re-audit with the ORIGINAL finding still reconciles to the same record (identity held)
  const count = ledger.loadLedger('draft-me').findings.length;
  ledger.ingestRound('draft-me', [mkFinding()], {});
  assert.equal(ledger.loadLedger('draft-me').findings.length, count, 'no duplicate created');
});

test('setFindingDraft validates before/after and format; clearFindingDraft removes it', () => {
  const fp = ledger.fingerprint('draft-me', 'consistency', 'Spec and ADO disagree on payment methods', 'confluence:1#flow vs ado:42695');
  assert.throws(() => ledger.setFindingDraft('draft-me', fp, { before: 'x' }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.setFindingDraft('draft-me', fp, { before: 'x', after: 'y', format: 'rtf' }), /invalid draft format/);
  assert.throws(() => ledger.setFindingDraft('draft-me', 'ffffffffff', { before: 'x', after: 'y' }), (e) => e.code === 'EUSER');

  // target defaults to the finding's locus when omitted
  const noTarget = ledger.setFindingDraft('draft-me', fp, { before: 'a', after: 'b' });
  assert.equal(noTarget.draft.target, 'confluence:1#flow vs ado:42695');
  assert.equal(noTarget.draft.format, 'text', 'format defaults to text');

  const histLen = ledger.loadLedger('draft-me').findings.find((f) => f.fp === fp).history.length;
  const cleared = ledger.clearFindingDraft('draft-me', fp);
  assert.equal(cleared.draft, undefined, 'draft removed');
  assert.equal(cleared.history.length, histLen + 1, 'clear logs history');
  assert.equal(cleared.history.at(-1).note, 'cleared draft');

  // clearing again is a no-op (no extra history)
  const again = ledger.clearFindingDraft('draft-me', fp);
  assert.equal(again.history.length, histLen + 1, 'no-op clear adds no history');
  assert.throws(() => ledger.clearFindingDraft('draft-me', 'ffffffffff'), (e) => e.code === 'EUSER');
});

test('setDraftReview records hunk decisions, merges, clears, stays identity-stable', () => {
  const fp = ledger.fingerprint('draft-me', 'consistency', 'Spec and ADO disagree on payment methods', 'confluence:1#flow vs ado:42695');
  ledger.setFindingDraft('draft-me', fp, { before: 'a\nb\nc', after: 'a\nB\nc\nd' });
  const before = ledger.loadLedger('draft-me').findings.find((f) => f.fp === fp);
  const histLen = before.history.length;

  // single-hunk patch
  const r1 = ledger.setDraftReview('draft-me', fp, { hunk: 0, status: 'accepted' });
  assert.equal(r1.fp, fp, 'fingerprint must not change');
  assert.equal(r1.draft.review.hunks['0'].status, 'accepted');
  assert.ok(r1.draft.review.hunks['0'].at, 'hunk decision carries a timestamp');
  assert.ok(r1.draft.review.updatedAt, 'review carries updatedAt');
  assert.equal(r1.history.length, histLen + 1, 'history entry appended');
  assert.equal(r1.history.at(-1).note, 'reviewed draft');
  assert.equal(r1.history.at(-1).from, r1.history.at(-1).to, 'reviewing is not a status transition');

  // merge: a second hunk decision keeps the first
  const r2 = ledger.setDraftReview('draft-me', fp, { hunk: 1, status: 'edited', editedText: 'X' });
  assert.equal(r2.draft.review.hunks['0'].status, 'accepted', 'prior hunk preserved on merge');
  assert.equal(r2.draft.review.hunks['1'].status, 'edited');
  assert.equal(r2.draft.review.hunks['1'].editedText, 'X');

  // full review object also merges
  const r3 = ledger.setDraftReview('draft-me', fp, { hunks: { 2: { status: 'rejected' } } });
  assert.equal(r3.draft.review.hunks['0'].status, 'accepted');
  assert.equal(r3.draft.review.hunks['2'].status, 'rejected');

  // 'undecided' clears that hunk's decision, others remain
  const r4 = ledger.setDraftReview('draft-me', fp, { hunk: 0, status: 'undecided' });
  assert.equal(r4.draft.review.hunks['0'], undefined, 'undecided removes the hunk decision');
  assert.equal(r4.draft.review.hunks['1'].status, 'edited', 'other decisions remain');

  // accepting drops any prior editedText (decisions are mutually exclusive)
  const r5 = ledger.setDraftReview('draft-me', fp, { hunk: 1, status: 'accepted' });
  assert.equal(r5.draft.review.hunks['1'].status, 'accepted');
  assert.equal(r5.draft.review.hunks['1'].editedText, undefined, 'accept clears editedText');

  // persisted to disk
  const reread = ledger.loadLedger('draft-me').findings.find((f) => f.fp === fp);
  assert.equal(reread.draft.review.hunks['2'].status, 'rejected');

  // identity held across a re-audit with the original finding
  const count = ledger.loadLedger('draft-me').findings.length;
  ledger.ingestRound('draft-me', [mkFinding()], {});
  assert.equal(ledger.loadLedger('draft-me').findings.length, count, 'no duplicate created');
});

test('setDraftReview validation: enum, edited text, shape, missing draft/finding', () => {
  const fp = ledger.fingerprint('draft-me', 'consistency', 'Spec and ADO disagree on payment methods', 'confluence:1#flow vs ado:42695');
  assert.throws(() => ledger.setDraftReview('draft-me', fp, { hunk: 0, status: 'bogus' }), /invalid hunk status/);
  assert.throws(() => ledger.setDraftReview('draft-me', fp, { hunk: 0, status: 'edited', editedText: 123 }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.setDraftReview('draft-me', fp, { hunk: 0, status: 'edited' }), /edited hunk requires editedText/);
  assert.throws(() => ledger.setDraftReview('draft-me', fp, {}), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.setDraftReview('draft-me', 'ffffffffff', { hunk: 0, status: 'accepted' }), (e) => e.code === 'EUSER');

  // empty-string editedText is allowed (means "delete the shown lines")
  const ok = ledger.setDraftReview('draft-me', fp, { hunk: 5, status: 'edited', editedText: '' });
  assert.equal(ok.draft.review.hunks['5'].editedText, '');

  // a finding with no draft cannot be reviewed
  const noDraft = mkFinding({ title: 'No draft on this one', locus: 'x:99' });
  ledger.ingestRound('draft-me', [mkFinding(), noDraft], {});
  const ofp = ledger.fingerprint('draft-me', 'consistency', 'No draft on this one', 'x:99');
  assert.throws(() => ledger.setDraftReview('draft-me', ofp, { hunk: 0, status: 'accepted' }), /no draft/);
});

test('setDraftReview persists finding-level note + verdict, merges with hunks, defaults', () => {
  ledger.createFeature({ id: 'note-me', title: 'Note' });
  ledger.ingestRound('note-me', [mkFinding()], {});
  const fp = ledger.fingerprint('note-me', 'consistency', 'Spec and ADO disagree on payment methods', 'confluence:1#flow vs ado:42695');
  ledger.setFindingDraft('note-me', fp, { before: 'a\nb\nc', after: 'a\nB\nc\nd' });
  const histLen = ledger.loadLedger('note-me').findings.find((f) => f.fp === fp).history.length;

  // a pure note/verdict counter-proposal (no hunk patch) persists both fields
  const r1 = ledger.setDraftReview('note-me', fp, { note: 'put these in systemProperties', verdict: 'redirect' });
  assert.equal(r1.fp, fp, 'fingerprint must not change');
  assert.equal(r1.draft.review.note, 'put these in systemProperties');
  assert.equal(r1.draft.review.verdict, 'redirect');
  assert.deepEqual(r1.draft.review.hunks, {}, 'hunks default to empty without a patch');
  assert.equal(r1.history.at(-1).note, 'reviewer note', 'pure note/verdict logs "reviewer note"');
  assert.equal(r1.history.length, histLen + 1, 'one history entry appended');
  assert.equal(r1.history.at(-1).from, r1.history.at(-1).to, 'a note is not a status transition');

  // a later hunk patch MERGES — it keeps the note + verdict
  const r2 = ledger.setDraftReview('note-me', fp, { hunk: 0, status: 'accepted' });
  assert.equal(r2.draft.review.hunks['0'].status, 'accepted');
  assert.equal(r2.draft.review.note, 'put these in systemProperties', 'note preserved across a hunk patch');
  assert.equal(r2.draft.review.verdict, 'redirect', 'verdict preserved across a hunk patch');
  assert.equal(r2.history.at(-1).note, 'reviewed draft', 'a hunk patch logs "reviewed draft"');

  // changing only the verdict keeps the note and the hunk decisions
  const r3 = ledger.setDraftReview('note-me', fp, { verdict: 'reject' });
  assert.equal(r3.draft.review.verdict, 'reject');
  assert.equal(r3.draft.review.note, 'put these in systemProperties', 'note preserved when only verdict changes');
  assert.equal(r3.draft.review.hunks['0'].status, 'accepted', 'hunk decision preserved');

  // null/empty clears: note '' and verdict back to 'proposed'
  const r4 = ledger.setDraftReview('note-me', fp, { note: '', verdict: null });
  assert.equal(r4.draft.review.note, '');
  assert.equal(r4.draft.review.verdict, 'proposed', 'null verdict resets to the default');

  // persisted to disk
  const reread = ledger.loadLedger('note-me').findings.find((f) => f.fp === fp);
  assert.equal(reread.draft.review.verdict, 'proposed');
  assert.equal(reread.draft.review.hunks['0'].status, 'accepted');

  // identity held across a re-audit
  const count = ledger.loadLedger('note-me').findings.length;
  ledger.ingestRound('note-me', [mkFinding()], {});
  assert.equal(ledger.loadLedger('note-me').findings.length, count, 'no duplicate created');
});

test('setDraftReview validates the verdict enum and note type', () => {
  const fp = ledger.fingerprint('note-me', 'consistency', 'Spec and ADO disagree on payment methods', 'confluence:1#flow vs ado:42695');
  assert.throws(() => ledger.setDraftReview('note-me', fp, { verdict: 'bogus' }), /invalid verdict/);
  assert.throws(() => ledger.setDraftReview('note-me', fp, { note: 123 }), /note must be a string/);
  // an empty review object (no hunks, no note, no verdict) is still rejected
  assert.throws(() => ledger.setDraftReview('note-me', fp, {}), (e) => e.code === 'EUSER');
});

// ---------- requests (UI-triggered job queue) ----------

test('addRequest: validates action enum and action-specific required fields', () => {
  // bad action
  assert.throws(() => ledger.addRequest({ action: 'nope', prId: '1' }), (e) => e.code === 'EUSER');
  // pr-review / pr-respond require prId
  assert.throws(() => ledger.addRequest({ action: 'pr-review' }), /requires "prId"/);
  assert.throws(() => ledger.addRequest({ action: 'pr-respond', prId: '' }), /requires "prId"/);
  // apply requires wsId
  assert.throws(() => ledger.addRequest({ action: 'apply' }), /requires "wsId"/);

  const r = ledger.addRequest({ action: 'pr-review', prId: '1481', title: 'Checkout PR' });
  assert.equal(r.action, 'pr-review');
  assert.equal(r.prId, '1481');
  assert.equal(r.wsId, null);
  assert.equal(r.title, 'Checkout PR');
  assert.equal(r.status, 'queued');
  assert.equal(r.note, null);
  assert.ok(r.createdAt && r.updatedAt);
});

test('addRequest: ids increment monotonically from a stored counter (no clock)', () => {
  // continues from the request created in the previous test → req-2, req-3, …
  const a = ledger.addRequest({ action: 'pr-respond', prId: '99' });
  const b = ledger.addRequest({ action: 'apply', wsId: 'pr-99-respond' });
  assert.match(a.id, /^req-\d+$/);
  assert.match(b.id, /^req-\d+$/);
  const an = Number(a.id.slice(4));
  const bn = Number(b.id.slice(4));
  assert.equal(bn, an + 1, 'ids increment by one');

  // counter survives a reload and is not reused after entries are present
  const doc = ledger.loadRequests();
  assert.equal(doc.counter, bn);
  const c = ledger.addRequest({ action: 'apply', wsId: 'x' });
  assert.equal(Number(c.id.slice(4)), bn + 1);
});

test('listRequests: returns all, filters by status, validates the status enum', () => {
  const all = ledger.listRequests();
  assert.ok(all.length >= 4);
  const queued = ledger.listRequests({ status: 'queued' });
  assert.ok(queued.every((r) => r.status === 'queued'));
  assert.equal(queued.length, all.length, 'everything starts queued');
  assert.equal(ledger.listRequests({ status: 'done' }).length, 0);
  assert.throws(() => ledger.listRequests({ status: 'bogus' }), (e) => e.code === 'EUSER');
});

test('setRequestStatus: transitions, merges note/wsId, bumps updatedAt, validates', () => {
  const r = ledger.addRequest({ action: 'pr-review', prId: '2025' });
  const before = r.updatedAt;

  const running = ledger.setRequestStatus(r.id, { status: 'running' });
  assert.equal(running.status, 'running');
  assert.ok(running.updatedAt >= before);

  // runner attaches the workspace it created + marks done
  const done = ledger.setRequestStatus(r.id, { status: 'done', wsId: 'pr-2025-review' });
  assert.equal(done.status, 'done');
  assert.equal(done.wsId, 'pr-2025-review');

  // error carries a note
  const errored = ledger.setRequestStatus(r.id, { status: 'error', note: 'PR not found' });
  assert.equal(errored.status, 'error');
  assert.equal(errored.note, 'PR not found');

  // bad status + unknown id
  assert.throws(() => ledger.setRequestStatus(r.id, { status: 'bogus' }), (e) => e.code === 'EUSER');
  assert.throws(() => ledger.setRequestStatus('req-does-not-exist', { status: 'done' }), /not found/);

  // persisted to disk
  const reread = ledger.loadRequests().requests.find((x) => x.id === r.id);
  assert.equal(reread.status, 'error');
  assert.equal(reread.wsId, 'pr-2025-review');
});
