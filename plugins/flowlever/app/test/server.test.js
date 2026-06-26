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
  assert.deepEqual(body, { id: 'del-via-api', deleted: true });

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
