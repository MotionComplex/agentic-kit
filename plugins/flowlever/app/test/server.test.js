'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Must be set BEFORE requiring the modules under test. PORT=0 → ephemeral port.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlever-server-'));
process.env.FLOWLEVER_DATA = tmpDir;
process.env.PORT = '0';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../src/ledger');
const { server } = require('../src/server');

let base;

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

before(async () => {
  ledger.initDataDir();
  ledger.createFeature({ id: 'flow-feat', title: 'Flow Feature' });
  ledger.ingestRound('flow-feat', [
    mkFinding({ title: 'Finding A' }),
    mkFinding({ title: 'Finding B', dimension: 'completeness' }),
    mkFinding({ title: 'Finding C', dimension: 'testability', severity: 'minor' }),
  ], { note: 'seed' });
  await new Promise((res) => (server.listening ? res() : server.once('listening', res)));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

function fps() {
  return ledger.loadLedger('flow-feat').findings.map((f) => f.fp);
}

test('POST /review/apply sets the listed findings to reworking', async () => {
  const all = fps();
  const target = all.slice(0, 2);
  const res = await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: target, status: 'reworking' }),
  });
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.updated, 2);
  assert.equal(json.status, 'reworking');

  const byFp = new Map(ledger.loadLedger('flow-feat').findings.map((f) => [f.fp, f]));
  assert.equal(byFp.get(target[0]).status, 'reworking');
  assert.equal(byFp.get(target[1]).status, 'reworking');
  assert.equal(byFp.get(all[2]).status, 'open'); // untouched
});

test('POST /review/apply defaults status to reworking when omitted', async () => {
  const target = [fps()[2]];
  const res = await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: target }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'reworking');
});

test('POST /review/apply rejects empty / bad fps and unknown findings (atomic)', async () => {
  const empty = await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fps: [] }),
  });
  assert.equal(empty.status, 400);

  const unknown = await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: ['nope-nope-xx'] }),
  });
  assert.equal(unknown.status, 400);
});

test('POST /review/apply rejects a status outside the allowlist', async () => {
  const res = await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [fps()[0]], status: 'waived' }),
  });
  assert.equal(res.status, 400);
});

test('POST /review/apply accepts resolved (pr-review approve → will-post)', async () => {
  const target = [fps()[0]];
  const res = await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: target, status: 'resolved' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'resolved');
  const byFp = new Map(ledger.loadLedger('flow-feat').findings.map((f) => [f.fp, f]));
  assert.equal(byFp.get(target[0]).status, 'resolved');
});

test('POST /review/apply accepts posted (PR comment sent → reworking + postedAt stamp)', async () => {
  const target = [fps()[2]];
  const res = await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: target, status: 'posted' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).status, 'posted');
  const f = ledger.loadLedger('flow-feat').findings.find((x) => x.fp === target[0]);
  assert.equal(f.status, 'reworking', 'posted stays open for the re-review reconcile');
  assert.ok(f.postedAt, 'carries a postedAt stamp');
});

test('GET /api/home counts posted findings separately, not as reworking/toReview', async () => {
  const home = await (await fetch(`${base}/api/home`)).json();
  const row = home.find((r) => r.id === 'flow-feat');
  assert.ok(row, 'flow-feat is in the inbox');
  assert.ok(row.counts.posted >= 1, 'posted findings are counted under posted');
});

test('POST /features/:id/activity flips authorResponded; summaries carry it', async () => {
  // post a comment first so the workspace is "awaiting author"
  await fetch(`${base}/api/features/flow-feat/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [fps()[0]], status: 'posted' }),
  });
  const resp = await fetch(`${base}/api/features/flow-feat/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorResponded: true, note: '2 new replies' }),
  });
  assert.equal(resp.status, 200);
  const feat = await resp.json();
  assert.ok(feat.review.authorRespondedAt, 'authorRespondedAt is set');
  assert.equal(feat.review.note, '2 new replies');

  const all = await (await fetch(`${base}/api/features`)).json();
  const row = all.find((r) => r.id === 'flow-feat');
  assert.equal(row.authorResponded, true);
  assert.equal(row.awaitingAuthor, true);

  // clearing returns to waiting
  const cleared = await fetch(`${base}/api/features/flow-feat/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorResponded: false }),
  });
  assert.equal((await cleared.json()).review.authorRespondedAt, null);
});

test('POST /features/:id/activity records the real PR-update time; summaries expose both clocks', async () => {
  // A future-dated activity stamp is guaranteed to be newer than the seeded round, which is
  // exactly the "the PR moved since we reviewed it" case the cockpit flags.
  const at = new Date(Date.now() + 60_000).toISOString();
  const resp = await fetch(`${base}/api/features/flow-feat/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastActivityAt: at, lastActivityBy: 'Oriol Puig' }),
  });
  assert.equal(resp.status, 200);
  const feat = await resp.json();
  assert.equal(feat.review.lastActivityAt, at);
  assert.equal(feat.review.lastActivityBy, 'Oriol Puig');

  const row = (await (await fetch(`${base}/api/features`)).json()).find((r) => r.id === 'flow-feat');
  assert.ok(row.stamps, 'feature summaries carry the stamps block');
  assert.equal(row.stamps.lastActivityAt, at);
  assert.equal(row.stamps.lastActivityBy, 'Oriol Puig');
  assert.equal(row.stamps.lastReviewedAt, row.lastRoundAt, 'lastReviewedAt is the last round');
  assert.equal(row.stamps.newSinceReview, true, 'their update is newer than our last round');

  const hrow = (await (await fetch(`${base}/api/home`)).json()).find((r) => r.id === 'flow-feat');
  assert.equal(hrow.stamps.newSinceReview, true, 'home rows carry the stamps too');

  // an unparseable timestamp is a client error, not a silently stored string
  const bad = await fetch(`${base}/api/features/flow-feat/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lastActivityAt: 'yesterday-ish' }),
  });
  assert.equal(bad.status, 400);
});

test('POST /review/cancel releases stranded in-flight findings and drops the dead job', async () => {
  ledger.createFeature({ id: 'srv-stuck', title: 'Stuck', kind: 'pr-review' });
  ledger.ingestRound('srv-stuck', [
    mkFinding({ title: 'SS1', locus: 'pr:7:a.ts:L1' }),
    mkFinding({ title: 'SS2', locus: 'pr:7:b.ts:L2' }),
  ]);
  const fps = ledger.loadLedger('srv-stuck').findings.map((f) => f.fp);
  const job = ledger.addRequest({ action: 'apply', wsId: 'srv-stuck' });

  // The UI's Post: mark in flight, then the runner never shows up.
  await fetch(`${base}/api/features/srv-stuck/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps, status: 'pending-post' }),
  });
  assert.equal(ledger.pendingFindings('srv-stuck').length, 2);

  const res = await fetch(`${base}/api/features/srv-stuck/review/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: job.id, reason: 'never ran' }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.cancelled, 2, 'both pending findings released');
  assert.equal(body.requestDeleted, true, 'the dead job is gone');
  assert.equal(ledger.pendingFindings('srv-stuck').length, 0);
  // Crucially: released, NOT posted.
  for (const f of ledger.loadLedger('srv-stuck').findings) {
    assert.equal(f.postedAt, undefined, 'cancelling must never stamp postedAt');
  }
  assert.ok(!ledger.listRequests().some((r) => r.id === job.id));

  // Idempotent, and tolerant of an already-deleted request.
  const again = await fetch(`${base}/api/features/srv-stuck/review/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId: job.id }),
  });
  assert.equal(again.status, 200);
  const body2 = await again.json();
  assert.equal(body2.cancelled, 0);
  assert.equal(body2.requestDeleted, false);
});

test('POST /review/cancel rejects unknown fps and 404s an unknown workspace', async () => {
  const bad = await fetch(`${base}/api/features/srv-stuck/review/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: ['nope'] }),
  });
  assert.equal(bad.status, 400);

  const missing = await fetch(`${base}/api/features/no-such-ws/review/cancel`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: ['abc'] }),
  });
  assert.equal(missing.status, 400, 'unknown workspace has no such finding');
});

test('GET /api/version lets the UI detect a server older than the page it serves', async () => {
  const res = await fetch(`${base}/api/version`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.apiVersion, require('../src/version').API_VERSION);
  assert.ok(body.startedAt, 'exposes when this process started, so "restart it" is verifiable');
  // The web UI compiles the expected version in; drift between the two is the bug this catches.
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const m = ui.match(/EXPECTED_API_VERSION\s*=\s*'([^']+)'/);
  assert.ok(m, 'web/app.js must declare EXPECTED_API_VERSION');
  assert.equal(m[1], body.apiVersion,
    'web/app.js EXPECTED_API_VERSION and src/version.js API_VERSION must be bumped together');
});

test('GET /api/runner reports whether the queue is being drained', async () => {
  const res = await fetch(`${base}/api/runner`);
  assert.equal(res.status, 200);
  const s = await res.json();
  assert.equal(s.running, false, 'no runner in a fresh test server');
  assert.deepEqual(Object.keys(s.actions).sort(), ['poll', 'watch'], 'only the two fixed prompts');
  assert.ok('available' in s && 'logPath' in s);
});

test('POST /api/runner refuses anything outside the fixed prompt allowlist', async () => {
  // The whole point: no request body can ever become part of the spawned command.
  for (const action of ['rm -rf /', 'watch; curl evil.example', '', 'audit']) {
    const res = await fetch(`${base}/api/runner`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    assert.equal(res.status, 400, `action ${JSON.stringify(action)} must be rejected`);
  }
  const nonString = await fetch(`${base}/api/runner`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: { toString: 'nope' } }),
  });
  assert.equal(nonString.status, 400);
});

test('DELETE /api/runner is a 409 when nothing is running', async () => {
  const res = await fetch(`${base}/api/runner`, { method: 'DELETE' });
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /no runner/i);
});

test('POST /api/requests creates a poll (refresh) job and dedupes it', async () => {
  const first = await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'poll', kind: 'pr-review', title: 'Refresh PR Review' }),
  });
  assert.equal(first.status, 201);
  const job = await first.json();
  assert.equal(job.action, 'poll');
  assert.equal(job.kind, 'pr-review');

  // same scope while it's still queued → the existing job, not a second one
  const again = await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'poll', kind: 'pr-review', dedupe: true }),
  });
  assert.equal(again.status, 200);
  const dup = await again.json();
  assert.equal(dup.id, job.id);
  assert.equal(dup.deduped, true);

  // a different scope is a different job
  const other = await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'poll', kind: 'pr-respond', dedupe: true }),
  });
  assert.equal(other.status, 201);
  assert.notEqual((await other.json()).id, job.id);

  const bad = await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'poll', kind: 'spec' }),
  });
  assert.equal(bad.status, 400);
});

test('POST /features/:id/status marks done / reopens; home carries status', async () => {
  const done = await fetch(`${base}/api/features/flow-feat/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).status, 'done');

  const home = await (await fetch(`${base}/api/home`)).json();
  assert.equal(home.find((r) => r.id === 'flow-feat').status, 'done', 'home payload carries status');

  const bad = await fetch(`${base}/api/features/flow-feat/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'nonsense' }),
  });
  assert.equal(bad.status, 400, 'invalid status rejected');

  // reopen so later assertions see a live workspace
  await fetch(`${base}/api/features/flow-feat/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'reworking' }),
  });
});

test('POST /findings/:fp persists a triage decision (approve/edit) and clears on null', async () => {
  const fp = fps()[1];
  const approved = await fetch(`${base}/api/features/flow-feat/findings/${fp}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' }),
  });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).decision, 'approve');

  // edit body + decision together
  await fetch(`${base}/api/features/flow-feat/findings/${fp}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestion: 'Edited.', decision: 'edit' }),
  });
  assert.equal(ledger.loadLedger('flow-feat').findings.find((f) => f.fp === fp).decision, 'edit');

  // null clears it
  const cleared = await fetch(`${base}/api/features/flow-feat/findings/${fp}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: null }),
  });
  assert.equal((await cleared.json()).decision, undefined);
});

test('POST /findings/:fp with suggestion edits the proposed comment body', async () => {
  const target = fps()[1];
  const res = await fetch(`${base}/api/features/flow-feat/findings/${target}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suggestion: 'Edited comment body.' }),
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).suggestion, 'Edited comment body.');
  const byFp = new Map(ledger.loadLedger('flow-feat').findings.map((f) => [f.fp, f]));
  assert.equal(byFp.get(target).suggestion, 'Edited comment body.');
});

test('POST /findings/:fp with nothing actionable is a 400', async () => {
  const res = await fetch(`${base}/api/features/flow-feat/findings/${fps()[2]}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
  });
  assert.equal(res.status, 400);
});

// ---------- requests (UI-triggered job queue) ----------

test('POST /findings/:fp/draft accepts a targetRef; /counter records redirect + enqueues a re-audit', async () => {
  const fp = fps()[0];
  // attach a proposal with a machine write target
  const draftRes = await fetch(`${base}/api/features/flow-feat/findings/${fp}/draft`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      before: 'card, PayPal', after: 'card, PayPal, Twint',
      targetRef: { system: 'confluence', pageId: '1', anchor: 'flow', version: 14 },
    }),
  });
  assert.equal(draftRes.status, 200);
  const drafted = await draftRes.json();
  assert.deepEqual(drafted.draft.targetRef, { system: 'confluence', pageId: '1', anchor: 'flow', version: 14 });

  // Reject + counter: records verdict=redirect + note AND enqueues a scoped re-audit
  const res = await fetch(`${base}/api/features/flow-feat/findings/${fp}/counter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'Change the ADO story instead of the spec.' }),
  });
  assert.equal(res.status, 200);
  const { finding, request } = await res.json();
  assert.equal(finding.draft.review.verdict, 'redirect');
  assert.equal(finding.draft.review.note, 'Change the ADO story instead of the spec.');
  assert.equal(request.action, 're-audit');
  assert.equal(request.wsId, 'flow-feat');
  assert.equal(request.status, 'queued');

  // the re-audit is actually on the queue
  const queue = await (await fetch(`${base}/api/requests?status=queued`)).json();
  assert.ok(queue.some((r) => r.id === request.id && r.action === 're-audit'));

  // empty note → 400 (handler guards before touching the ledger)
  const noNote = await fetch(`${base}/api/features/flow-feat/findings/${fp}/counter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: '   ' }),
  });
  assert.equal(noNote.status, 400);

  // countering a finding with no draft → 400 (setDraftReview: "no draft to review")
  const noDraft = await fetch(`${base}/api/features/flow-feat/findings/${fps()[1]}/counter`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: 'x' }),
  });
  assert.equal(noDraft.status, 400);
});

test('POST /api/requests creates a request; GET lists + filters by status', async () => {
  const res = await fetch(`${base}/api/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pr-review', prId: '1481', title: 'Checkout PR' }),
  });
  assert.equal(res.status, 201);
  const created = await res.json();
  assert.equal(created.action, 'pr-review');
  assert.equal(created.prId, '1481');
  assert.equal(created.status, 'queued');
  assert.match(created.id, /^req-\d+$/);

  const listRes = await fetch(`${base}/api/requests`);
  assert.equal(listRes.status, 200);
  const list = await listRes.json();
  assert.ok(list.some((r) => r.id === created.id));

  const queuedRes = await fetch(`${base}/api/requests?status=queued`);
  const queued = await queuedRes.json();
  assert.ok(queued.every((r) => r.status === 'queued'));
  assert.ok(queued.some((r) => r.id === created.id));
});

test('POST /api/requests rejects bad/missing fields with 400', async () => {
  const bad = await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'nope' }),
  });
  assert.equal(bad.status, 400);

  const noPr = await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pr-review' }),
  });
  assert.equal(noPr.status, 400);

  const noWs = await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'apply' }),
  });
  assert.equal(noWs.status, 400);
});

test('POST /api/requests/:id updates status/note/wsId; unknown id is 404', async () => {
  const created = await (await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pr-respond', prId: '777' }),
  })).json();

  const upd = await fetch(`${base}/api/requests/${created.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done', wsId: 'pr-777-respond' }),
  });
  assert.equal(upd.status, 200);
  const updated = await upd.json();
  assert.equal(updated.status, 'done');
  assert.equal(updated.wsId, 'pr-777-respond');

  const empty = await fetch(`${base}/api/requests/${created.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  assert.equal(empty.status, 400);

  const missing = await fetch(`${base}/api/requests/req-nope`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(missing.status, 404);
});

test('POST /api/requests/:id passes phase + needsInput through', async () => {
  const created = await (await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pr-review', prId: '888' }),
  })).json();
  assert.equal(created.phase, null);
  assert.equal(created.needsInput, false);

  const upd = await fetch(`${base}/api/requests/${created.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'running', phase: 'fetching PR #888 diff', needsInput: true, note: 'Approve the auth prompt' }),
  });
  assert.equal(upd.status, 200);
  const updated = await upd.json();
  assert.equal(updated.phase, 'fetching PR #888 diff');
  assert.equal(updated.needsInput, true);
  assert.equal(updated.note, 'Approve the auth prompt');

  // phase-only update is accepted (not "nothing to change") and clears needsInput on done
  const done = await (await fetch(`${base}/api/requests/${created.id}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done', phase: 'review ready' }),
  })).json();
  assert.equal(done.needsInput, false);
  assert.equal(done.phase, 'review ready');
});

// ---------- DELETE routes ----------

test('DELETE /api/features/:id returns 200 { id, deleted:true } and removes the workspace', async () => {
  ledger.createFeature({ id: 'del-via-api', title: 'Delete via API' });

  const res = await fetch(`${base}/api/features/del-via-api`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { id: 'del-via-api', deleted: true, cancelledRequests: [] });

  const get = await fetch(`${base}/api/features/del-via-api`);
  assert.equal(get.status, 404);
});

test('DELETE /api/features/:id returns 404 for an unknown feature', async () => {
  const res = await fetch(`${base}/api/features/no-such-feature-xyz`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});

test('DELETE /api/requests/:id returns 200 and removes the request', async () => {
  const created = await (await fetch(`${base}/api/requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'pr-review', prId: '4242' }),
  })).json();

  const res = await fetch(`${base}/api/requests/${created.id}`, { method: 'DELETE' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { id: created.id, deleted: true });

  const list = await (await fetch(`${base}/api/requests`)).json();
  assert.ok(!list.some((r) => r.id === created.id), 'request must be gone from the list');
});

test('DELETE /api/requests/:id returns 404 for an unknown request', async () => {
  const res = await fetch(`${base}/api/requests/req-nope-server`, { method: 'DELETE' });
  assert.equal(res.status, 404);
});

// ---------- security: the traversal hole (C-1) ----------
//
// `featureId` was validated only in createFeature while every read/write/delete built a path from
// the raw URL segment — and route() percent-decodes segments, so `..%2f..%2fsecret` reached the
// filesystem. A reachable client could DELETE any .json file the server user could write, and read
// one back through the status route.

const TRAVERSAL_IDS = [
  '..%2f..%2foutside%2fsecret',
  '..%2fsecret',
  '%2e%2e%2f%2e%2e%2foutside%2fsecret',
  '..%5c..%5csecret',
  'UPPERCASE',
  'has%20space',
];

test('DELETE with a traversing id is refused and deletes nothing outside the data dir', async () => {
  const outside = path.join(tmpDir, '..', `flowlever-must-survive-${process.pid}.json`);
  fs.writeFileSync(outside, JSON.stringify({ apiToken: 'sk-DO-NOT-LEAK' }));
  try {
    for (const id of TRAVERSAL_IDS) {
      const res = await fetch(`${base}/api/features/${id}`, { method: 'DELETE' });
      assert.ok(res.status === 400 || res.status === 404, `${id} → ${res.status}`);
      const body = await res.json();
      assert.ok(!body.deleted, `${id} must not report a deletion`);
    }
    // the exact path the reviewer used, aimed at the real file
    const rel = path.basename(outside, '.json');
    const res = await fetch(`${base}/api/features/${encodeURIComponent(`../${rel}`)}`, { method: 'DELETE' });
    assert.equal(res.status, 400);
    assert.ok(fs.existsSync(outside), 'a file outside the data dir must survive');
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('a traversing id cannot read a file back through the status route', async () => {
  const outside = path.join(tmpDir, '..', `flowlever-leak-${process.pid}.json`);
  fs.writeFileSync(outside, JSON.stringify({ apiToken: 'sk-DO-NOT-LEAK' }));
  try {
    const rel = path.basename(outside, '.json');
    const res = await fetch(`${base}/api/features/${encodeURIComponent(`../${rel}`)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'done' }),
    });
    assert.equal(res.status, 400);
    const text = await res.text();
    assert.ok(!text.includes('sk-DO-NOT-LEAK'), 'the file contents must not come back in the response');
  } finally {
    fs.rmSync(outside, { force: true });
  }
});

test('every id-taking route rejects a traversing id', async () => {
  const id = '..%2f..%2foutside%2fsecret';
  const cases = [
    ['GET', `/api/features/${id}`],
    ['GET', `/api/report/${id}`],
    ['POST', `/api/ingest/${id}`, { findings: [] }],
    ['POST', `/api/features/${id}/review/apply`, { fps: ['x'] }],
    ['POST', `/api/features/${id}/review/cancel`, {}],
    ['POST', `/api/features/${id}/activity`, { lastActivityAt: '2026-01-01T00:00:00.000Z' }],
  ];
  for (const [method, url, body] of cases) {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.ok(res.status === 400 || res.status === 404, `${method} ${url} → ${res.status}`);
    const text = await res.text();
    assert.ok(!/"deleted":\s*true/.test(text), `${method} ${url} must not report success`);
  }
});

// ---------- status-code honesty (C-14) ----------

test('a validation error on a GET is 400, not 404', async () => {
  const bad = await fetch(`${base}/api/requests?status=bogus`);
  assert.equal(bad.status, 400, 'bad input is not a missing resource');
  assert.match((await bad.json()).error, /invalid status/);

  const missing = await fetch(`${base}/api/features/no-such-workspace`);
  assert.equal(missing.status, 404, 'a genuinely absent resource is still 404');
});

// ---------- decisions survive the finish screen (C-8) ----------

test('review/apply reworking keeps the reviewer\'s decision; resolved supersedes it', async () => {
  ledger.createFeature({ id: 'keep-dec-api', title: 'Keep decisions' });
  ledger.ingestRound('keep-dec-api', [
    mkFinding({ title: 'K1', locus: 'k:1' }),
    mkFinding({ title: 'K2', locus: 'k:2' }),
  ]);
  const [a, b] = ledger.loadLedger('keep-dec-api').findings.map((f) => f.fp);
  ledger.setFindingDecision('keep-dec-api', a, 'approve');
  ledger.setFindingDecision('keep-dec-api', b, 'approve');

  const res = await fetch(`${base}/api/features/keep-dec-api/review/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [a], status: 'reworking' }),
  });
  assert.equal(res.status, 200);
  const after = ledger.loadLedger('keep-dec-api').findings.find((f) => f.fp === a);
  assert.equal(after.status, 'reworking');
  assert.equal(after.decision, 'approve', 'marking in-flight is not a re-triage');

  await fetch(`${base}/api/features/keep-dec-api/review/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [b], status: 'resolved' }),
  });
  const resolved = ledger.loadLedger('keep-dec-api').findings.find((f) => f.fp === b);
  assert.equal(resolved.decision, undefined, 'a real completion still supersedes the decision');
});

test('review/apply reports which findings it skipped', async () => {
  ledger.createFeature({ id: 'skip-api', title: 'Skips' });
  ledger.ingestRound('skip-api', [
    mkFinding({ title: 'S1', locus: 's:1' }),
    mkFinding({ title: 'S2', locus: 's:2' }),
  ]);
  const [live, gone] = ledger.loadLedger('skip-api').findings.map((f) => f.fp);
  ledger.setFindingStatus('skip-api', gone, { status: 'waived', reason: 'not doing it' });

  const res = await fetch(`${base}/api/features/skip-api/review/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [live, gone], status: 'pending-apply' }),
  });
  const body = await res.json();
  assert.equal(body.updated, 1);
  assert.deepEqual(body.skipped, [{ fp: gone, reason: 'waived' }], 'the caller learns WHICH was dropped');
});

// ---------- the fix gate over HTTP (C-4) ----------

test('posting an agreed code fix over HTTP refuses a missing or malformed sha', async () => {
  ledger.createFeature({ id: 'gate-api', title: 'Gate', kind: 'pr-respond' });
  ledger.ingestRound('gate-api', [mkFinding({ title: 'G1', locus: 'pr:1:a.cs:1' })]);
  const fp = ledger.loadLedger('gate-api').findings[0].fp;
  ledger.setFindingDraft('gate-api', fp, { before: 'old', after: 'new' });
  ledger.setFindingDecision('gate-api', fp, 'fix-only');

  const post = (payload) => fetch(`${base}/api/features/gate-api/review/apply`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [fp], status: 'posted', ...payload }),
  });

  const noSha = await post({});
  assert.equal(noSha.status, 400);
  assert.match((await noSha.json()).error, /cannot be marked posted without the commit/);

  const junk = await post({ sha: 'lol-no-commit' });
  assert.equal(junk.status, 400, 'the API used to accept any non-empty string');
  assert.match((await junk.json()).error, /invalid commit sha/);

  const ok = await post({ sha: 'a1b2c3d4e5f6' });
  assert.equal(ok.status, 200);
  assert.equal(ledger.loadLedger('gate-api').findings[0].fixCommit.sha, 'a1b2c3d4e5f6');
});

// ---------- config + scope + HEAD ----------

test('GET /api/config serves the real merged config', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const cfg = await res.json();
  assert.deepEqual(cfg, ledger.loadConfig());
  assert.equal(typeof cfg.gates.readyThreshold, 'number');
  assert.equal(typeof cfg.gates.scoreZeroAtPenalty, 'number');
});

test('POST /api/ingest honours scope and rejects a malformed one', async () => {
  ledger.createFeature({ id: 'scope-api', title: 'Scoped' });
  ledger.ingestRound('scope-api', [
    mkFinding({ severity: 'blocker', title: 'BE', locus: 'be:1', dimension: 'feasibility' }),
    mkFinding({ title: 'FE', locus: 'fe:1', dimension: 'design-match' }),
  ]);

  const res = await fetch(`${base}/api/ingest/scope-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      findings: [mkFinding({ title: 'FE', locus: 'fe:1', dimension: 'design-match' })],
      scope: { dimensions: ['design-match'] },
    }),
  });
  assert.equal(res.status, 200);
  const { stats } = await res.json();
  assert.equal(stats.autoResolved, 0, 'the out-of-scope blocker must not be closed');
  assert.equal(stats.outOfScopeSkipped, 1);
  assert.equal(ledger.readiness('scope-api').gate, 'not-ready');

  const bad = await fetch(`${base}/api/ingest/scope-api`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ findings: [], scope: 'front-end only' }),
  });
  assert.equal(bad.status, 400);
});

test('HEAD on a static file returns headers, not 405', async () => {
  const res = await fetch(`${base}/app.js`, { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.ok(Number(res.headers.get('content-length')) > 0);
  assert.equal((await res.text()).length, 0, 'HEAD carries no body');

  const post = await fetch(`${base}/app.js`, { method: 'POST' });
  assert.equal(post.status, 405, 'other methods are still refused');
});

test('the static handler still refuses traversal out of web/', async () => {
  for (const p of ['/../src/ledger.js', '/..%2fsrc%2fledger.js', '/../../etc/passwd']) {
    const res = await fetch(`${base}${p}`);
    assert.equal(res.status, 404, `${p} → ${res.status}`);
  }
});

test('X-2: an unreadable workspace file is reported, not silently dropped from the board', async () => {
  // The first fix stopped one bad file from 400ing the whole board, but then omitted it with only a
  // stderr warning — so the workspace simply vanished from the UI and the inbox stopped nagging.
  const bad = path.join(tmpDir, 'features', 'x2-truncated.json');
  fs.writeFileSync(bad, '{ "title": "truncated');
  try {
    const res = await fetch(`${base}/api/features`);
    assert.equal(res.status, 200, 'healthy workspaces still list');
    assert.equal(res.headers.get('x-flowlever-skipped'), '1', 'the count rides on a header');
    const body = await res.json();
    assert.ok(Array.isArray(body), 'the array shape is preserved for existing clients');
    assert.ok(body.some((f) => f.id === 'flow-feat'), 'the healthy workspace is present');

    const home = await fetch(`${base}/api/home`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('x-flowlever-skipped'), '1', 'the inbox flags it too');

    // ...and the detail is retrievable from inside the product, not only from the server's stdout.
    const diag = await fetch(`${base}/api/diagnostics`);
    assert.equal(diag.status, 200);
    const d = await diag.json();
    assert.equal(d.skippedWorkspaces.length, 1);
    assert.equal(d.skippedWorkspaces[0].file, 'x2-truncated.json');
    assert.match(d.skippedWorkspaces[0].reason, /not valid JSON/);
    assert.equal(typeof d.lockWaitMs, 'number');
    assert.equal(d.loopback, true);
  } finally {
    fs.rmSync(bad, { force: true });
  }
});

test('a lock timeout answers 503 with Retry-After, not 400', async () => {
  // A contended lock is transient: "try again", not "your request was wrong". The server also runs a
  // much shorter lock ceiling than the CLI, because waiting blocks its event loop.
  const lock = path.join(tmpDir, 'requests.json.lock');
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), `999999\n${Date.now()}\n`);   // fresh, so not stale
  try {
    const started = Date.now();
    const res = await fetch(`${base}/api/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'pr-review', prId: '4242' }),
    });
    const waited = Date.now() - started;
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('retry-after'), '1');
    assert.match((await res.json()).error, /timed out waiting for a lock/);
    assert.ok(waited < 6000, `the server must fail fast, waited ${waited}ms`);
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
});

test('Z-1: every write route answers 503 on a lock timeout, not 400', async () => {
  // handleFeatureStatus and handleFeatureActivity caught EUSER themselves and reported 400, so the
  // central lockTimeout->503 mapping never saw them: a write that merely collided with the CLI was
  // reported as a bad request. Genuine bad input must still be 400.
  ledger.createFeature({ id: 'z1-ws', title: 'Z1' });
  const lock = path.join(tmpDir, 'features', 'z1-ws.json.lock');
  fs.mkdirSync(lock, { recursive: true });
  fs.writeFileSync(path.join(lock, 'owner'), `999999\n${Date.now()}\n`);
  try {
    for (const [route, body] of [
      ['status', { status: 'done' }],
      ['activity', { lastActivityBy: 'someone' }],
    ]) {
      const res = await fetch(`${base}/api/features/z1-ws/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(res.status, 503, `${route} must report a lock timeout as transient`);
      assert.equal(res.headers.get('retry-after'), '1', `${route} must say when to retry`);
    }
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }

  const ok = await fetch(`${base}/api/features/z1-ws/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'done' }),
  });
  assert.equal(ok.status, 200, 'and it works once the lock clears');
  const bad = await fetch(`${base}/api/features/z1-ws/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'bogus' }),
  });
  assert.equal(bad.status, 400, 'a real validation error is still a bad request');
});
