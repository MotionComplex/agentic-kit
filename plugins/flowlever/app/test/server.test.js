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
  // Not a duplicate-detection test: assert up front that this PR carries no comments,
  // which is what the ingest gate requires a PR workspace to have established.
  ledger.setPriorThreads('srv-stuck', []);
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

// Read the body of a top-level `function name(` / `async function name(` declaration in a source
// file by matching braces, so these assertions don't depend on how the body is indented.
function fnBody(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at > -1, `web/app.js must declare ${decl}`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open + 1, i);
  }
  throw new Error(`unbalanced braces reading ${decl}`);
}

test('U1: the heartbeat timer belongs to the app, not to the per-view poller', () => {
  // Regression guard for the bug that made the first cut of this heartbeat useless: it rode the
  // interval owned by startPolling(), which route() tears down before every render and each view
  // re-arms only at the END of its async render — after an `await api(...)` that throws while the
  // server is down. So the heartbeat died exactly during an outage: a cold load with the server
  // down never got a timer at all, and navigating mid-outage froze the failure count so the banner
  // could neither trip nor clear. Assert the ownership that makes that impossible.
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

  // Exactly one interval in the app, and it must be created at module scope (column 0 — this file
  // indents everything inside a function), i.e. at boot, where navigation cannot reach it.
  const intervals = ui.match(/setInterval\s*\(/g) || [];
  assert.equal(intervals.length, 1, 'the app must have exactly one setInterval');
  assert.match(ui, /^setInterval\(appTick, 4000\);$/m,
    'the sole interval must be armed at module scope at boot and run appTick on the 4s cadence');

  // startPolling/stopPolling may only register/unregister the view callback. If either one grows a
  // timer again the heartbeat is back on a view's lifetime, which is the whole bug.
  const startBody = fnBody(ui, 'function startPolling(');
  const stopBody = fnBody(ui, 'function stopPolling(');
  assert.ok(!/setInterval|setTimeout/.test(startBody),
    'startPolling must not create a timer — the app-level ticker owns the cadence');
  assert.ok(!/clearInterval|clearTimeout/.test(stopBody),
    'stopPolling() must not be able to stop the heartbeat');
  assert.ok(!/\.timer\b/.test(startBody + stopBody),
    'neither startPolling nor stopPolling may hold a timer handle');
  assert.ok(/checkHeartbeat/.test(fnBody(ui, 'async function appTick(')),
    'the app-level ticker must be the thing that runs the heartbeat');

  // And within that ticker the heartbeat must be reached unconditionally: nothing — not a failed
  // /api/requests, not a missing view callback — may return before it.
  const tick = fnBody(ui, 'async function appTick(');
  const heartbeatIdx = tick.indexOf('checkHeartbeat()');
  assert.ok(heartbeatIdx > -1, 'appTick must call checkHeartbeat()');
  assert.ok(!/\breturn\b/.test(tick.slice(0, heartbeatIdx)),
    'appTick must not be able to return before the heartbeat runs');
  assert.ok(tick.indexOf('pollRequestsTick') > heartbeatIdx,
    'the heartbeat must run before the per-view requests poll, not after it');

  // A 404 on /api/version means the server predates the check — reachable, so not a heartbeat
  // failure, but still conclusively the stale side. It must reach the version-mismatch path.
  const heartbeatBody = fnBody(ui, 'async function checkHeartbeat(');
  assert.equal((heartbeatBody.match(/checkVersionMismatch\(/g) || []).length, 2,
    'checkHeartbeat must call checkVersionMismatch on both the ok and the 404 path');
  assert.match(heartbeatBody, /checkVersionMismatch\(null\)/,
    'a 404 must reach checkVersionMismatch with a null version, not be treated as healthy');

  // The debounce: the banner must require more than a single missed heartbeat.
  const thresholdMatch = ui.match(/HEARTBEAT_FAIL_THRESHOLD\s*=\s*(\d+)/);
  assert.ok(thresholdMatch, 'web/app.js must declare HEARTBEAT_FAIL_THRESHOLD');
  assert.ok(Number(thresholdMatch[1]) >= 2, 'a single blip must not be enough to show the unreachable banner');

  // And the banner itself must not be re-created on every failed tick: a fresh role="alert" is
  // re-announced by screen readers, and this fires every 4s for the length of the outage.
  const bannerBody = fnBody(ui, 'function showUnreachableBanner(');
  assert.ok(/textContent\s*=/.test(bannerBody),
    'showUnreachableBanner must update the existing banner\'s text in place');
  // Guard the BEHAVIOUR, not one spelling of it. An earlier version of this assertion only
  // rejected the literal `existing.remove()`, and a re-review proved it: reintroducing the very
  // same bug as `existing.parentNode.removeChild(existing)` left the test passing. Match any way
  // the found node can be detached, and require the early return that keeps it in place.
  const detaches = /\bexisting\b[\s\S]*?\.(remove|removeChild|replaceWith|replaceChildren)\s*\(|\bremoveChild\s*\(\s*existing\s*\)/;
  assert.ok(!detaches.test(bannerBody),
    'showUnreachableBanner must not detach and rebuild the role="alert" node every tick '
    + '(any of .remove/.removeChild/.replaceWith on the existing node)');
  assert.ok(/if\s*\(existing\)\s*\{[\s\S]*?\breturn\b/.test(bannerBody),
    'showUnreachableBanner must return early when the banner already exists, so the node survives');

  // The heartbeat fetch needs a deadline. A dead process refuses instantly, but the outage this
  // whole unit exists for was a WEDGED server: socket accepting, event loop stopped, so a fetch
  // with no timeout never settles and `fails` never leaves 0 — verified with SIGSTOP.
  const hbBody = fnBody(ui, 'async function checkHeartbeat(');
  assert.ok(/AbortSignal\.timeout\(|signal:/.test(hbBody),
    'checkHeartbeat must bound its fetch, or a wedged server is never detected');
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
  // Not a duplicate-detection test: assert up front that this PR carries no comments,
  // which is what the ingest gate requires a PR workspace to have established.
  ledger.setPriorThreads('gate-api', []);
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

test('GET /api/config serves the real merged config, plus this server\'s read-only mode', async () => {
  const res = await fetch(`${base}/api/config`);
  assert.equal(res.status, 200);
  const cfg = await res.json();
  // The original point of this test stands: every documented config key must come from
  // loadConfig() rather than a hardcoded copy in the server, which is what silently drifted the
  // moment anyone edited config.json. Assert that key-by-key rather than by deep-equality on the
  // whole body, so the response can also carry server state without loosening the guarantee.
  const real = ledger.loadConfig();
  for (const [k, v] of Object.entries(real)) {
    assert.deepEqual(cfg[k], v, `${k} must be served from the real config, not a copy`);
  }
  assert.equal(typeof cfg.gates.readyThreshold, 'number');
  assert.equal(typeof cfg.gates.scoreZeroAtPenalty, 'number');
  // `readOnly` rides along because the page needs the mode at boot and already fetches this once.
  // It must be present and false here: read-only is opt-in, never the default.
  assert.equal(cfg.readOnly, false);
  assert.ok(!('readOnly' in real), 'readOnly is server state, not a config.json key');
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

test('the whole of 127.0.0.0/8 counts as loopback, not just 127.0.0.1', () => {
  // The documented friendly-hostname recipe binds an lo0 alias (FLOWLEVER_HOST=127.94.41.73). An
  // exact-string loopback check called that "remote", which would have made the API read-only and
  // refused the runner for a setup this project tells you to use. (Binding a 127.x alias needs
  // `ifconfig lo0 alias` root privileges, so the predicate is asserted directly.)
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  const start = src.indexOf('function isLoopbackHost');
  const end = src.indexOf('const IS_LOOPBACK');
  assert.ok(start > -1 && end > start, 'isLoopbackHost must exist ahead of IS_LOOPBACK');
  // eslint-disable-next-line no-new-func
  const isLoopbackHost = new Function(`${src.slice(start, end)}; return isLoopbackHost;`)();

  for (const host of ['127.0.0.1', '127.94.41.73', '127.1.2.3', '127.255.255.254', 'localhost', '::1']) {
    assert.equal(isLoopbackHost(host), true, `${host} is loopback`);
  }
  for (const host of ['0.0.0.0', '192.168.1.5', '10.0.0.1', '128.0.0.1', '27.0.0.1', '127.0.0.999', 'evil.com', '']) {
    assert.equal(isLoopbackHost(host), false, `${host} is NOT loopback`);
  }
});

test('U2: approveAllRemaining only ever touches currently-undecided findings', () => {
  // No bulk-decision endpoint exists server-side (only /review/apply, which bulk-sets finding
  // *status* for the post/apply hand-off — not the `decision` field a single Approve writes), so
  // this whole unit lives client-side. Assert the source-level guarantee that matters most: a
  // reviewer's considered Dismiss/Edit/Redirect/Waive/Skip can never be silently overturned by the
  // bulk action, and it never posts.
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const undecidedBody = fnBody(ui, 'function undecidedFlowFps(');
  // Must read the decisions map directly, not go through flowDecisionKind() — that helper falls
  // back to 'skip' both for "never decided" AND for an explicit Skip (pr-respond/spec have a real
  // Skip button), so using it here would let a bulk approve overturn a considered Skip.
  assert.ok(/!state\.flow\.decisions\[/.test(undecidedBody),
    'undecidedFlowFps must test the decisions map directly, not flowDecisionKind()');
  assert.ok(!/flowDecisionKind/.test(undecidedBody),
    'undecidedFlowFps must not go through flowDecisionKind() — it collapses "never decided" and "explicit Skip" into one bucket');

  const bulkBody = fnBody(ui, 'async function approveAllRemaining(');
  assert.ok(/undecidedFlowFps\(\)/.test(bulkBody),
    'approveAllRemaining must source its target fps from undecidedFlowFps(), not from every flow item');
  // The previous version of this guard only blacklisted `.map`/`.forEach`/`.filter` called on
  // `state.flow.items`, so a `for..of state.flow.items`, a classic indexed `for` loop, a
  // `for..in`, `state.flow.items[i]`, `...state.flow.items`, or `Object.keys(state.flow.items)`
  // all sailed straight through it untouched. A reviewer proved this concretely with a `for..of`
  // mutation that iterated every item and flipped an already-Dismissed finding to Approved —
  // the suite stayed green at 208/208. There is no syntax-form denylist that reliably covers
  // every one of those (and whatever's invented next); the only real invariant is that this
  // function has no legitimate reason to reference `state.flow.items` AT ALL — undecidedFlowFps()
  // is the sole approved way in. So assert the literal string is simply absent from the body.
  assert.ok(!/state\.flow\.items/.test(bulkBody),
    'approveAllRemaining must never reference state.flow.items directly (by .map/.forEach/.filter, '
    + 'for..of, a classic for(;;), for..in, indexing, spread, Object.keys, or any other traversal) '
    + '— undecidedFlowFps() must be the only way it reads the undecided set');
  assert.ok(!/enqueueApply|postBack\(|\/review\/apply/.test(bulkBody),
    'approveAllRemaining must never post or enqueue a post — Post stays a separate, explicit click');
});

/* Guarding the one path in the UI that causes a write to somebody else's pull request.
 *
 * `reject` became a decision kind so the bulk approve-all could not silently overturn a
 * considered rejection. That promotion had a consequence nothing caught: flowDecisionKind() now
 * returns 'reject' instead of falling back to 'skip', so in persistTriage the finding stopped
 * hitting the `continue` and fell through to the `else` that pushes items into the post set and
 * marks them pending-post for the runner. A finding the reviewer explicitly rejected would have
 * been posted as a comment — while the Post button, which counts only accept/edit, said nothing
 * about it. The whole suite stayed green through that, so the invariant gets its own test. */
test('U2: persistTriage never carries a rejected or undecided finding into the post set', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const body = fnBody(ui, 'async function persistTriage(');

  // Both non-decisions must bail BEFORE the branch that fills postFps.
  const elseIdx = body.indexOf('postFps.push');
  assert.ok(elseIdx > 0, 'persistTriage still builds a postFps set');
  const beforePush = body.slice(0, elseIdx);
  for (const kind of ['skip', 'reject']) {
    const guard = new RegExp(`k === '${kind}'\\s*\\)\\s*continue;`);
    assert.ok(guard.test(beforePush),
      `persistTriage must skip '${kind}' before anything reaches postFps.push — `
      + `a '${kind}' finding must never be handed to the runner to post`);
  }

  // And a rejected finding must not be quietly re-labelled as a dismissal either: Dismiss waives
  // the finding, Reject only refuses the proposed change. Conflating them loses the distinction
  // the reviewer drew.
  assert.ok(!/waiveItems\.push[^;]*'reject'/.test(body),
    'a reject must not be recorded as a waive — they are different reviewer intents');
});

test('U2: the approve-all control requires an inline confirm before it can act', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const body = fnBody(ui, 'function approveAllControl(');
  assert.ok(!/window\.confirm|window\.alert/.test(body),
    'must not use window.confirm/alert — this app builds confirms with h()');
  assert.ok(/confirmApproveAll/.test(body),
    'the write must be gated behind a two-step confirm flag, like stepWaiveForm');
  assert.ok(/approveAllRemaining\(/.test(body),
    'the confirmed branch must be able to actually call approveAllRemaining');
  // Renders nothing when nothing is undecided, so it can never invite approving an already-clear
  // batch. The previous version of this check just tested that SOME `return null` existed
  // ANYWHERE in the body — which the function also does for the unrelated `kind !== 'pr-review'`
  // early return, so a reviewer could delete the actual "nothing undecided → render nothing"
  // guard entirely and this test kept passing. Anchor on the specific guard, not the substring.
  assert.ok(/const fps = undecidedFlowFps\(\);/.test(body),
    'approveAllControl must derive its fps from undecidedFlowFps()');
  assert.ok(/if\s*\(\s*!fps\.length\s*\)\s*return null;/.test(body),
    'approveAllControl must return null specifically when the undecided-fps set is empty — not '
    + 'merely contain the text "return null" somewhere else in the function (e.g. the kind guard)');
});

test('U2: the zero-post label names the remaining work instead of dead-ending', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const body = fnBody(ui, 'function postActionEl(');
  assert.ok(/still undecided/.test(body),
    'postActionEl must name the undecided count instead of just restating "Post 0 …"');
  // The already-correct disabled gate on the Post button must survive intact — the U2 unit was
  // only allowed to change the label above it. Read-only mode later added a term IN FRONT of this
  // condition (a cockpit that cannot write must not offer to post), which is an addition rather
  // than a rewrite, so the original clause is still asserted verbatim here.
  assert.ok(/\(postN === 0 && !posted && !errored && !stalled && !unconfirmed\)/.test(body),
    'the original Post-button disabled condition must survive intact');
  assert.ok(/disabled: readOnlyMode\(\) \|\| active/.test(body),
    'read-only must also disable Post — it is the control that reaches a real pull request');
});

/* Regression guard for NEW-3: route()'s two confirm resets have no test coverage of their own
 * today — a reviewer deleted the `confirmApproveAll` reset line entirely and the whole 209-test
 * suite stayed green, because nothing ever asserted route() clears either flag. Both resets exist
 * for the identical reason (a confirm armed on the finish screen must not survive navigating away
 * and back to the SAME feature, since that path skips initFlow's fresh-state reset) and both guard
 * a real write — confirmApproveAll gates approveAllRemaining, confirmApply gates a live write to
 * ADO/Confluence — so losing either silently re-arms a "one click from a real write" state. */
/* U3: editing a proposed comment/note used to strand the keyboard — Escape cancelled, but
 * committing meant reaching for the mouse to click "Save & approve" / "Save note". The fix must
 * (a) let Cmd/Ctrl+Enter submit through the SAME function the button calls, in both the spec and
 * PR branches, so button and shortcut can never diverge; (b) leave bare Enter alone, since these
 * are multi-line bodies; and (c) advertise the shortcut next to the buttons it duplicates. */
test('U3: Cmd/Ctrl+Enter submits the comment editor via the same path as the Save button', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

  // The submit chord lives in exactly one place — both textareas wire onkeydown through it — so a
  // future edit to one branch cannot silently leave the other without a keyboard submit.
  const keydownBody = fnBody(ui, 'function commentEditTaKeydown(');
  assert.match(keydownBody, /e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)/,
    'commentEditTaKeydown must require Cmd OR Ctrl with Enter — accepting either is what makes '
    + 'this work on macOS and elsewhere without platform sniffing');
  assert.match(keydownBody, /e\.preventDefault\(\)/,
    'the chord must preventDefault, or the newline is inserted in addition to submitting');
  assert.match(keydownBody, /e\.key === 'Escape'/,
    'Escape must still be handled by the shared handler, so cancel behaviour cannot regress');

  // Bare Enter must never reach a submit call on its own — only the guarded chord above may. If a
  // regression added an unconditional `if (e.key === 'Enter')` branch, this would catch it.
  assert.ok(!/e\.key === 'Enter'\)/.test(keydownBody.replace(/e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)/, '')),
    'bare Enter (no modifier) must not be wired to submit — these are multi-line bodies');

  // commentEditTaKeydown must be the ONLY place in the app that binds this chord: if a second,
  // divergent binding shows up (e.g. someone hand-rolls the condition again on a new textarea)
  // this count moves, which is the drift this unit exists to prevent.
  const chordSites = (ui.match(/e\.key === 'Enter' && \(e\.metaKey \|\| e\.ctrlKey\)/g) || []).length;
  assert.equal(chordSites, 1, 'the Cmd/Ctrl+Enter condition must be defined once and reused');

  const formBody = fnBody(ui, 'function commentEditForm(');
  // Spec branch (note textarea): the button's onclick and the textarea's onkeydown must call the
  // exact same function reference, not two separate calls into saveSpecNote — otherwise a future
  // edit to one could change what gets saved without touching the other.
  assert.match(formBody, /onkeydown:\s*commentEditTaKeydown\(cancel,\s*submitNote\)/,
    'the spec-branch textarea must route Cmd/Ctrl+Enter through the same submitNote used by the button');
  assert.match(formBody, /onclick:\s*submitNote\s*\}/,
    'the "Save note" button must call submitNote, the same function the keyboard shortcut calls');

  // PR branch (proposed-comment textarea): same requirement, via submitComment.
  assert.match(formBody, /onkeydown:\s*commentEditTaKeydown\(cancel,\s*submitComment\)/,
    'the PR-branch textarea must route Cmd/Ctrl+Enter through the same submitComment used by the button');
  assert.match(formBody, /onclick:\s*submitComment\s*\}/,
    'the "Save & approve" button must call submitComment, the same function the keyboard shortcut calls');

  // Discoverability: the shortcut hint must actually be rendered next to both action rows, not
  // just exist in code with nothing pointing at it (the U-5 register this unit follows).
  const hintSites = (formBody.match(/saveKbdHint\(\)/g) || []).length;
  assert.equal(hintSites, 2, 'saveKbdHint() must be rendered in both the spec and PR action rows');

  // The global decide-loop handler must remain blind to this chord: it already refuses to fire
  // while any modifier is held, which is what stops Cmd/Ctrl+Enter from also being read as a
  // one-letter decide-loop key while the editor is open. If that guard is ever narrowed to only
  // cover a subset of modifiers, this chord would start leaking into the decide loop.
  const docKeydown = ui.slice(ui.indexOf("document.addEventListener('keydown'"));
  assert.match(docKeydown, /!e\.metaKey && !e\.ctrlKey && !e\.altKey/,
    'the decide-loop branch must still exclude all modifier keys, so Cmd/Ctrl+Enter can never '
    + 'be misread as a one-letter decision');
});

test('NEW-3: route() disarms both finish-screen confirms on every navigation', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');
  const body = fnBody(ui, 'function route(');
  assert.ok(/state\.flow\.confirmApproveAll\s*=\s*false;/.test(body),
    'route() must reset state.flow.confirmApproveAll = false on every navigation');
  assert.ok(/state\.flow\.confirmApply\s*=\s*false;/.test(body),
    'route() must reset state.flow.confirmApply = false on every navigation — it gates a real '
    + 'write to ADO/Confluence and is the higher-stakes sibling of confirmApproveAll');
});
