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

/* The inbox's Done list can be sorted by "last modified", which reads `updatedAt` off each row.
 * /api/features had always carried it and /api/home never did — the two summary shapes had drifted,
 * and the sort would have silently ranked every completed workspace as undated. */
test('GET /api/home carries the timestamps the Done list sorts on', async () => {
  const home = await (await fetch(`${base}/api/home`)).json();
  const row = home.find((r) => r.id === 'flow-feat');
  assert.ok(row, 'flow-feat is in the inbox');
  assert.ok(row.updatedAt, 'updatedAt must be present — "sort by last modified" reads it');
  assert.ok(!Number.isNaN(Date.parse(row.updatedAt)), 'and it must be a parseable timestamp');
  // The other sort key comes off the stamps block, which this endpoint already served.
  assert.ok(row.stamps, 'stamps must be present — "sort by last reviewed" reads lastReviewedAt');
  assert.ok('lastReviewedAt' in row.stamps);
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

/* Some assertions below forbid a pattern (`&& !r.wsId`, a bare `.wsId` read) that the code's own
 * comments QUOTE, because explaining why a rule was rejected means naming it. A regex over the raw
 * body would read the warning as the mistake and fail on a correct file — and, worse, would pass on
 * a broken one whose comment happened to be reworded. Strip the prose and assert on the code. */
function codeOnly(body) {
  return body.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
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

/* Sorting the Done list. The comparator lives in browser code the Node suite cannot import, so
 * these are source assertions — but they pin the two properties that would actually break it: the
 * menu must be generated from the same table the comparator reads (otherwise it can offer an order
 * nothing implements, the DECIDE_KEYS failure mode), and a workspace with no date must sink rather
 * than lead (an undated entry sorting first would put the least-known work at the top of a list
 * whose whole purpose is recency). The ordering itself is verified in a real browser. */
test('the Done sort menu and its comparator read one table, and undated rows sink', () => {
  const ui = fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8');

  const table = ui.match(/const DONE_SORTS = \{[\s\S]*?\n\};/);
  assert.ok(table, 'DONE_SORTS must exist as the single source of truth');
  for (const key of ['reviewed', 'modified', 'title']) {
    assert.ok(new RegExp(`\\b${key}:`).test(table[0]), `DONE_SORTS must define "${key}"`);
  }

  const disc = fnBody(ui, 'function doneDisclosure(');
  assert.ok(/Object\.entries\(DONE_SORTS\)/.test(disc),
    'the <select> options must be generated from DONE_SORTS, not hand-listed alongside it');
  assert.ok(/e\.stopPropagation\(\)/.test(disc),
    'the menu sits inside a <summary>, so its events must not bubble into the disclosure toggle');

  const cmp = fnBody(ui, 'function sortDonePairs(');
  assert.ok(/if \(!av\) return 1;/.test(cmp) && /if \(!bv\) return -1;/.test(cmp),
    'a row with no timestamp must sort LAST in sortDonePairs, never first');
  assert.ok(/localeCompare\(String\(av\)\)/.test(cmp),
    'timestamps are ISO strings and must be compared newest-first (b vs a)');

  // The two date labels the user picks between must be the same words the rows print, or the sort
  // is unverifiable by eye — this is what made the first cut of the feature unusable.
  const dates = fnBody(ui, 'function doneDatesRow(');
  assert.ok(/'Last reviewed'/.test(dates) && /'Last modified'/.test(dates),
    'doneDatesRow must label the dates exactly as the sort menu names them');
  assert.ok(/DONE_SORTS/.test(table[0]) && /'Last reviewed'/.test(table[0])
    && /'Last modified'/.test(table[0]),
    'and DONE_SORTS must use those same labels');
});

/* The canonical per-workspace `state`. It is computed in the ledger and served by BOTH list
 * endpoints, because the inbox and the section lists show the same workspaces and a card that
 * says "needs review" in one place and "awaiting author" in the other is worse than either. */
test('GET /api/home and /api/features agree on one canonical state per workspace', async () => {
  ledger.createFeature({ id: 'state-fresh', title: 'Fresh Review', kind: 'pr-review' });
  ledger.setPriorThreads('state-fresh', []);   // pr-review ingest is gated on the prior-thread record
  ledger.ingestRound('state-fresh', [mkFinding({ title: 'Untouched finding', locus: 'pr:1:a.cs:L1' })], { note: 'seed' });

  const home = await (await fetch(`${base}/api/home`)).json();
  const list = await (await fetch(`${base}/api/features?kind=pr-review`)).json();
  const hrow = home.find((r) => r.id === 'state-fresh');
  const lrow = list.find((r) => r.id === 'state-fresh');
  assert.ok(hrow && lrow, 'the workspace appears on both endpoints');
  assert.equal(hrow.state, 'needs-review', 'an undecided first-round finding needs a review');
  assert.equal(lrow.state, hrow.state, 'the two endpoints must never disagree');
  assert.ok(ledger.WORKSPACE_STATES.some((s) => s.state === hrow.state),
    'every served state must be one the WORKSPACE_STATES table knows how to band');
});

/* /api/features served no counts at all, so a section card could not show the bits an inbox row
 * shows. Both now read ONE count helper — asserting they agree is what stops a second copy of
 * the loop being reintroduced and quietly drifting. */
test('GET /api/features carries the same counts block as /api/home', async () => {
  const home = await (await fetch(`${base}/api/home`)).json();
  const list = await (await fetch(`${base}/api/features`)).json();
  for (const hrow of home) {
    const lrow = list.find((r) => r.id === hrow.id);
    if (!lrow) continue;   // /api/home drops nothing, but don't let a skipped workspace fail this
    assert.deepEqual(lrow.counts, hrow.counts, `counts differ for ${hrow.id}`);
  }
  const fresh = list.find((r) => r.id === 'state-fresh');
  assert.deepEqual(Object.keys(fresh.counts).sort(),
    ['open', 'posted', 'resolved', 'reworking', 'toReview', 'waived']);
  assert.equal(fresh.counts.open, 1);
});

test('GET /api/features reports the real states of posted / decided / done workspaces', async () => {
  // Posted, and the PR has NOT moved since our round → the user is waiting on the author.
  ledger.createFeature({ id: 'state-posted', title: 'Posted Review', kind: 'pr-review' });
  ledger.setPriorThreads('state-posted', []);   // pr-review ingest is gated on the prior-thread record
  ledger.ingestRound('state-posted', [mkFinding({ title: 'Posted finding', locus: 'pr:2:a.cs:L1' })], { note: 'seed' });
  const postedFp = ledger.loadLedger('state-posted').findings[0].fp;
  await fetch(`${base}/api/features/state-posted/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [postedFp], status: 'posted' }),
  });

  // Decided but nothing out yet → the next move is the Post button.
  ledger.createFeature({ id: 'state-ready', title: 'Ready Review', kind: 'pr-review' });
  ledger.setPriorThreads('state-ready', []);   // pr-review ingest is gated on the prior-thread record
  ledger.ingestRound('state-ready', [mkFinding({ title: 'Decided finding', locus: 'pr:3:a.cs:L1' })], { note: 'seed' });
  const readyFp = ledger.loadLedger('state-ready').findings[0].fp;
  await fetch(`${base}/api/features/state-ready/findings/${readyFp}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'approve' }),
  });

  const byId = new Map((await (await fetch(`${base}/api/features?kind=pr-review`)).json()).map((r) => [r.id, r]));
  assert.equal(byId.get('state-posted').state, 'awaiting-author');
  assert.equal(byId.get('state-ready').state, 'ready-to-post');

  // Closing the workspace overrides everything still on its findings.
  await fetch(`${base}/api/features/state-posted/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  const after = (await (await fetch(`${base}/api/features?kind=pr-review`)).json()).find((r) => r.id === 'state-posted');
  assert.equal(after.state, 'done');
  const hafter = (await (await fetch(`${base}/api/home`)).json()).find((r) => r.id === 'state-posted');
  assert.equal(hafter.state, 'done', 'and the inbox says the same');
});

/* The runner flipping "the author replied" must move the workspace out of the waiting band and
 * back into needs-you — that transition is the whole reason the state is recomputed per request
 * rather than stamped once. */
test('activity flagged as author-responded moves a waiting workspace to author-responded', async () => {
  ledger.createFeature({ id: 'state-responded', title: 'Responded Review', kind: 'pr-review' });
  ledger.setPriorThreads('state-responded', []);   // pr-review ingest is gated on the prior-thread record
  ledger.ingestRound('state-responded', [mkFinding({ title: 'Replied-to finding', locus: 'pr:4:a.cs:L1' })], { note: 'seed' });
  const fp = ledger.loadLedger('state-responded').findings[0].fp;
  await fetch(`${base}/api/features/state-responded/review/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fps: [fp], status: 'posted' }),
  });
  const before = (await (await fetch(`${base}/api/features?kind=pr-review`)).json()).find((r) => r.id === 'state-responded');
  assert.equal(before.state, 'awaiting-author');

  await fetch(`${base}/api/features/state-responded/activity`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ authorResponded: true, note: '1 new reply' }),
  });
  const after = (await (await fetch(`${base}/api/features?kind=pr-review`)).json()).find((r) => r.id === 'state-responded');
  assert.equal(after.state, 'author-responded');
});

/* U2: the kind sections draw four ordered bands. The renderer is browser code the Node suite
 * cannot import, so these are source assertions — but they pin the properties that would actually
 * break it: the order must be expressed once (the DECIDE_KEYS failure mode), the browser's
 * taxonomy must agree with the ledger's, an unknown state must fall back rather than crash, and an
 * empty band must not be drawn. The rendering itself is verified in a real browser. */
function readUi() { return fs.readFileSync(path.join(__dirname, '..', 'web', 'app.js'), 'utf8'); }

/* Parses WS_BANDS/WS_STATES out of web/app.js. Reading the real tables rather than restating them
 * here is the point: a test carrying its own copy of the order is the very duplication it exists
 * to forbid. */
function wsTables(ui) {
  const bandsSrc = ui.match(/const WS_BANDS = \[[\s\S]*?\n\];/);
  const statesSrc = ui.match(/const WS_STATES = \[[\s\S]*?\n\];/);
  assert.ok(bandsSrc, 'web/app.js must declare WS_BANDS as the single source of band order');
  assert.ok(statesSrc, 'web/app.js must declare WS_STATES as the single source of state rank');
  const bands = [...bandsSrc[0].matchAll(/\{\s*key:\s*'([^']+)',\s*label:\s*'([^']+)',\s*density:\s*'([^']+)'/g)]
    .map((m) => ({ key: m[1], label: m[2], density: m[3] }));
  const states = [...statesSrc[0].matchAll(/\{\s*key:\s*'([^']+)',\s*band:\s*'([^']+)',\s*label:\s*'([^']+)'/g)]
    .map((m) => ({ key: m[1], band: m[2], label: m[3] }));
  assert.equal(bands.length, 3, 'WS_BANDS must parse as three bands');
  assert.ok(states.length >= 9, 'WS_STATES must parse as the full state list');
  return { bands, states, bandsSrc: bandsSrc[0], statesSrc: statesSrc[0] };
}

test('U2: WS_BANDS/WS_STATES are the only place band order and rank are expressed', () => {
  const ui = readUi();
  const { bands, states, statesSrc } = wsTables(ui);

  // Rank is the index. A `rank:` field would be a second copy of the order to keep in step, which
  // is the exact drift the one-table rule exists to prevent.
  assert.ok(!/\brank\s*:/.test(statesSrc),
    'WS_STATES must not carry an explicit rank — position in the array IS the rank');
  const bandKeys = bands.map((b) => b.key);
  for (const s of states) {
    assert.ok(bandKeys.includes(s.band), `WS_STATES "${s.key}" names a band WS_BANDS doesn't define`);
  }
  // Bands must occupy contiguous runs, or "iterate bands, sort by rank" would draw a card above a
  // higher-ranked sibling in the same band.
  const runs = states.map((s) => s.band).filter((b, i, a) => b !== a[i - 1]);
  assert.deepEqual(runs, [...new Set(runs)], 'each band must be one contiguous run of WS_STATES');

  // The loop itself lives in ONE place, shared by every list view (see U3) — a second copy is how
  // the sections and the inbox would come to disagree about which band a workspace is in.
  const loop = fnBody(ui, 'function bandSections(');
  const grid = fnBody(ui, 'function sectionGrid(');
  assert.match(loop, /for \(const band of WS_BANDS\)/,
    'the band loop must walk WS_BANDS, not a hand-listed set of bands');
  assert.match(loop, /wsState\(a\.cat\)\.rank - wsState\(b\.cat\)\.rank/,
    'rank must come from the WS_STATES table, not a parallel comparator');
  assert.ok(!/for \(const band of WS_BANDS\)/.test(grid),
    'sectionGrid must reuse the shared loop rather than keep its own');
  for (const b of bands) {
    for (const [name, body] of [['bandSections', loop], ['sectionGrid', grid]]) {
      assert.ok(!body.includes(`'${b.key}'`),
        `${name} must not name the "${b.key}" band itself — that is a second copy of the order`);
      assert.ok(!body.includes(`'${b.label}'`), `${name} must not hand-write the "${b.label}" header`);
    }
  }
  // Density is the band's property, read from the table and handed to the renderer.
  assert.match(loop, /band\.density/, 'the card density must come from the band table');
  assert.match(fnBody(ui, 'function featureCard('), /density === 'compact'/,
    'featureCard must branch on the density the band gave it');

  // One index built from the table, and exactly one.
  const indexSites = (ui.match(/WS_STATES\.map\(/g) || []).length;
  assert.equal(indexSites, 1, 'WS_STATE_INDEX must be the single derivation of WS_STATES');
});

test('U2: the browser band table and the ledger WORKSPACE_STATES are one taxonomy', () => {
  const { states } = wsTables(readUi());
  const byKey = new Map(states.map((s) => [s.key, s]));
  const server = new Map(ledger.WORKSPACE_STATES.map((s) => [s.state, s]));

  // Every non-job state the browser knows must be a real server state, in the SAME band. A state
  // banded one way in the core and another in the UI is two taxonomies wearing one name.
  for (const s of states) {
    if (s.key.startsWith('job-')) continue;   // the live-runner states are the browser's own
    const srv = server.get(s.key);
    assert.ok(srv, `web/app.js WS_STATES has "${s.key}", which ledger.js does not serve`);
    assert.equal(s.band, srv.band, `"${s.key}" lands in a different band in the browser than in the ledger`);
  }
  // And every state the server can serve must have somewhere to go. `done` is the one exception:
  // it keeps the collapsed Done disclosure instead of a band.
  for (const srv of ledger.WORKSPACE_STATES) {
    if (srv.state === 'done') continue;
    assert.ok(byKey.has(srv.state),
      `ledger.js serves "${srv.state}" but web/app.js has no band for it — it would render unlabelled`);
  }
  assert.ok(!byKey.has('done'), 'done must NOT be a band — it keeps its collapsed disclosure');
});

test('U2: categoryOf falls back instead of crashing on a missing or unknown state', () => {
  const ui = readUi();
  const { states } = wsTables(ui);
  const body = fnBody(ui, 'function categoryOf(');

  // A summary from an older cockpit carries no `state` at all, and an unknown word must not
  // produce an unlabelled band — the lookup is guarded and the fallback is a real WS_STATES key.
  assert.match(body, /WS_STATE_INDEX\.has\(f && f\.state\) \? f\.state : WS_FALLBACK_STATE/,
    'categoryOf must check the state against the table before trusting it, and null-guard `f`');
  const fallback = ui.match(/const WS_FALLBACK_STATE = '([^']+)';/);
  assert.ok(fallback, 'WS_FALLBACK_STATE must be declared');
  assert.ok(states.some((s) => s.key === fallback[1]),
    `the fallback "${fallback[1]}" must itself be a WS_STATES key, or the fallback renders no band`);
  // wsState() is the other half of the same guard: an unknown key still yields a labelled entry.
  assert.match(fnBody(ui, 'function wsState('), /\|\| WS_STATE_INDEX\.get\(WS_FALLBACK_STATE\)/,
    'wsState must never return undefined — the renderer reads .band and .rank off it');

  // A live job outranks the workspace's own state, and the three "a human must unstick this"
  // job conditions must stay in one branch: an errored job banded as "in progress" is the lie.
  assert.match(body, /job\.status === 'error' \|\| isStaleJob\(job\)/,
    'errored and stalled jobs must share the attention branch');
  assert.ok(!/function isStaleJob/.test(body), 'categoryOf must reuse isStaleJob, not re-derive it');
});

test('U2: an empty band is not rendered', () => {
  const ui = readUi();
  const grid = fnBody(ui, 'function sectionGrid(');
  assert.match(fnBody(ui, 'function bandSections('), /if \(!rows\.length\) continue;/,
    'a band with no cards must be skipped entirely — never a header with zero under it');
  // The pre-band behaviour at the two edges must survive: nothing at all → the empty state,
  // nothing active but something done → the note above the disclosure.
  assert.match(grid, /if \(!bands\.length && !doneCards\.length\) return sectionEmpty\(kind\);/,
    'an utterly empty section must still return sectionEmpty(kind)');
  assert.match(grid, /No active workspaces — everything below is complete\./,
    'bands empty but Done non-empty must keep the all-done note');
  assert.match(grid, /doneDisclosure\(kind, doneCards, 'features-grid done-disc-body'\)/,
    'the Done disclosure and its date sort must be left exactly as they were');
});

/* U2 review fixes. Same shape as the tests above — source assertions over browser code the Node
 * suite cannot import, pinning the property that would actually break, with the rendering itself
 * verified in a real browser. */

test('U2: a job that already has a workspace card never gets a placeholder beside it', () => {
  const ui = readUi();
  const grid = codeOnly(fnBody(ui, 'function sectionGrid('));

  // The placeholder list is "every live job of this kind that has no card to be folded onto", and
  // that second clause is jobBindsTo asked of every card the page draws. Anything narrower has
  // shipped wrong twice: `used` alone holds the ONE job jobForFeature folded per workspace, so a PR
  // with two live jobs leaks its runner-up and is drawn twice; adding a wsId test on top still
  // misses a job that carries no wsId and binds by prId — which is what "+ New PR review" enqueues.
  assert.match(grid, /!features\.some\(\(f\) => jobBindsTo\(r, f\)\)/,
    'the placeholder filter must exclude any job that binds to ANY workspace on this page, through '
    + 'the same predicate that folds jobs onto cards');
  // The other half of the rule — a dangling wsId must KEEP its placeholder — has its own test
  // below, so this one is free to be about suppression alone.

  // And the placeholder is a card like any other, so it takes the band's density (finding 5).
  assert.match(grid, /pendingJobCard\(e\.job, density\)/,
    'a placeholder must be drawn at the band density, not always full — a full-height placeholder '
    + 'among one-line compact rows breaks the only promise a compact band makes');
});

test('U2: card-binding and placeholder-suppression are ONE predicate, stated once', () => {
  const ui = readUi();
  const binds = codeOnly(fnBody(ui, 'function jobBindsTo('));
  const forFeature = codeOnly(fnBody(ui, 'function jobForFeature('));
  const grid = codeOnly(fnBody(ui, 'function sectionGrid('));

  // A job may arrive with a wsId, a prId, or both — the "+ New PR review" dialog enqueues
  // { action, prId, title } with no wsId at all. Both arms live in the predicate, so a caller that
  // only ever thought about wsId cannot be wrong about the prId case separately.
  assert.match(binds, /job\.wsId && job\.wsId === f\.id/,
    'jobBindsTo must bind a job to the workspace its wsId names');
  assert.match(binds, /String\(job\.prId\) === String\(prNumber\(f\)\)|String\(job\.prId\) === String\(pr\)/,
    'jobBindsTo must ALSO bind a PR job by prId — a wsId-less job is the ordinary UI-enqueued case, '
    + 'and a rule that only reads wsId lets it bind a card and draw a placeholder beside it');
  assert.match(binds, /pr-review|pr-respond/,
    'and the prId arm stays limited to the PR actions, so an apply job never binds by PR number');

  // The whole point: neither call site may restate the matching. Two copies of this rule is how the
  // duplicate PR card shipped — one side learned about prId, the other never did.
  for (const [name, body] of [['jobForFeature', forFeature], ['sectionGrid', grid]]) {
    assert.match(body, /jobBindsTo\(/, `${name} must go through the shared predicate`);
    assert.ok(!/\.wsId\b/.test(body),
      `${name} must not read wsId at all — one rule, or the two call sites drift apart`);
    // A comparison is a restatement; a bare truthiness check is not. sectionGrid keeps exactly one
    // prId mention — "is this even a PR job", the reason a placeholder can exist at all — and it
    // must never compare that prId to a workspace, which is the predicate's whole job.
    assert.ok(!/String\([^)]*prId/.test(body) && !/prId\s*===/.test(body),
      `${name} must not compare prId to a workspace — that comparison lives in jobBindsTo`);
  }
  assert.ok(!/prId/.test(forFeature),
    'jobForFeature must not mention prId at all: it asks the predicate and sorts the answer');
});

test('U2: a wsId naming a workspace that is gone still gets its placeholder', () => {
  const ui = readUi();
  const grid = codeOnly(fnBody(ui, 'function sectionGrid('));

  // The rejected fix was `&& !r.wsId`, which reads "has a wsId ⇒ has a card". It does not: a
  // workspace can be deleted out from under a running review, and that review then vanishes from
  // the cockpit entirely — no card, no placeholder, no trace of the runner that is still going.
  // Membership in `features` is the only honest test, and it is exactly what .some() performs.
  assert.match(grid, /features\.some\(/,
    'placeholder suppression must be decided against the workspaces this page actually draws, so a '
    + 'dangling wsId matches nothing and keeps its placeholder');
  assert.ok(!/wsIds\.has\(/.test(grid),
    'and not against a bare set of ids, which can only answer the wsId half of the question');
  assert.ok(!/!r\.wsId\b/.test(grid),
    'the filter must test workspace EXISTENCE, never merely the presence of a wsId — `&& !r.wsId` '
    + 'is the rejected fix, and it makes a running review on a deleted workspace disappear');
});

test('U2: a full card names its state, so the band that demands action says the most', () => {
  const ui = readUi();
  const card = fnBody(ui, 'function featureCard(');

  // Without this, ready-to-post / needs-review / needs-rereview / author-responded render
  // pixel-identically: same lifecycle chip, same dial, same stamps. The compact cards parked
  // BELOW them were the only ones labelled.
  assert.match(card, /cat \? wsStatePill\(cat\) : null/,
    'a full card must render the state pill when it was given a category');
  // The lifecycle chip is kept, not deleted — "where is this workspace in its life" is a different
  // question from "what is it waiting on" — but it is drawn through the gate that suppresses the
  // one value it always held inside a band (`draft`). See the U5 test for what the gate lets past.
  assert.match(card, /statusChipIfMeaningful\(f\.status\)/,
    'and keep the lifecycle chip, gated so it draws only when it discriminates');

  // .chip.ws-pill-needs-you was unreachable dead CSS while only compact cards wore a pill and no
  // needs-you card was ever compact. Every band must have a reachable tint.
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'style.css'), 'utf8');
  for (const b of wsTables(ui).bands) {
    assert.ok(css.includes(`.chip.ws-pill-${b.key}`), `style.css must tint the "${b.key}" pill`);
  }
  assert.match(fnBody(ui, 'function wsStatePill('), /ws-pill-\$\{cssSafe\(meta\.band\)\}/,
    'the pill tint must come from the band the WS_STATES row names, not from the card');
});

test('U2: the category is decided once per render and handed to the card', () => {
  const ui = readUi();
  const grid = fnBody(ui, 'function sectionGrid(');
  const card = fnBody(ui, 'function featureCard(');

  assert.match(grid, /featureCard\(e\.f, e\.job, density, e\.cat\)/,
    'the band loop already decided the category — it must travel with the card');
  // categoryOf reads the clock through isStaleJob, so a second call inside the card can disagree
  // with the one that chose the header the card is sitting under: banded as one state, pilled as
  // another, on a single job crossing the 3-minute stale threshold mid-render.
  assert.ok(!/categoryOf\(/.test(card),
    'featureCard must not recompute categoryOf — one decision per render');
  assert.match(ui, /function featureCard\(f, job, density = 'full', cat = null\)/,
    'and the Done disclosure, which draws outside the bands, must be able to pass no category: '
    + '`done` is deliberately not a WS_STATES key, so there is no honest pill for it');
});

test('U2: band density is emitted from WS_BANDS, not restated in CSS', () => {
  const ui = readUi();
  const { bands } = wsTables(ui);
  const loop = fnBody(ui, 'function bandSections(');
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'style.css'), 'utf8');

  assert.match(loop, /band-density-\$\{cssSafe\(band\.density\)\}/,
    'the band must carry its density as a class, so the stylesheet can read the table too');
  // Hardcoding which bands are compact is the WS_BANDS/band-map drift spelled in CSS: flip a
  // `density` in the table and the spacing stays behind on a band that no longer holds one-liners.
  for (const b of bands) {
    assert.ok(!new RegExp(`\\.band-${b.key}\\s+\\.features-grid`).test(css),
      `style.css must not space the "${b.key}" band by name — key it off the density class`);
  }
  assert.ok(css.includes('.band-density-compact .features-grid'),
    'the compact spacing must hang off the density class');
});

/* U3 — the Home inbox, banded by the same tables as the kind sections. Source assertions again:
 * `node --test` cannot import browser code, so these pin the properties whose loss would actually
 * break the screen, and the rendering itself is verified in a real browser. */

test('U3: the inbox bands come from the shared loop, not a second one of its own', () => {
  const ui = readUi();
  const { bands } = wsTables(ui);
  const inbox = fnBody(ui, 'function renderHomeInbox(');

  // The whole point of extracting bandSections: an inbox with its own copy of the loop is free to
  // order, label or count a band differently from the sections showing the same workspaces.
  assert.match(inbox, /bandSections\(active, \(e, density\) => inboxRow\(e\.r, e\.job, density, e\.cat\), 'inbox'\)/,
    'renderHomeInbox must draw its bands through bandSections, handing each row the band density '
    + 'and the category the loop already decided');
  assert.ok(!/for \(const band of WS_BANDS\)/.test(inbox),
    'the inbox must not walk WS_BANDS itself — that is a second copy of the band order');
  for (const b of bands) {
    assert.ok(!inbox.includes(`'${b.label}'`),
      `the inbox must not hand-write the "${b.label}" header — it comes from WS_BANDS`);
  }
  // The band table is ordered by urgency, so the top band IS what needs you. Deriving the header
  // count from it rather than from needsYouBits is the fix for a subtitle that disagreed with the
  // rows underneath it: the bits read counts.toReview, which is 0 on a PR whose findings carry
  // suggestions rather than drafts — exactly the rows the count was about.
  assert.match(inbox, /wsState\(e\.cat\)\.band === WS_BANDS\[0\]\.key/,
    'the "needs you" count must come from the top band, the same answer the rows are grouped by');
  assert.ok(!/needsYouBits/.test(inbox),
    'no count on this screen may be derived from needsYouBits any more');
});

test('U3: Home folds each live job onto its row', () => {
  const ui = readUi();
  const inbox = fnBody(ui, 'function renderHomeInbox(');
  const row = fnBody(ui, 'function inboxRow(');

  // Without binding, the inbox cannot band truthfully: a PR being posted, or one whose runner has
  // stalled and needs a human, sits under whatever state it held before the job started.
  assert.match(inbox, /\.filter\(isLiveJob\)/,
    'Home must bind the same jobs a section binds — isLiveJob, not its own liveness test');
  assert.match(inbox, /jobForFeature\(r, live\)/,
    'and correlate them with jobForFeature, not a second matcher');
  assert.match(inbox, /categoryOf\(r, job\)/,
    'the job must reach categoryOf, which is what lets it outrank the served state');
  // And the row has to SAY so, in the words the cards use — a stalled job must be as actionable
  // from the inbox as it is from a section.
  assert.match(row, /cardJobRow\(job, hasFindingsOf\(r\)\)/,
    'a row with a live job must render the same job line the cards do');
});

test('U3: the requests strip drops the jobs already shown on a row', () => {
  const ui = readUi();
  const poll = fnBody(ui, 'function startHomeRequestsPoll(');

  // A job on a row AND in the strip states the same thing twice on one screen — the duplication
  // the sections removed when they folded jobs onto cards.
  assert.match(poll, /const used = renderHomeInbox\(reqs\)/,
    'the strip must learn which jobs the rows took from the render that took them');
  assert.match(poll, /active\.filter\(\(r\) => !used\.has\(r\.id\)\)/,
    'a job bound to a visible row must not be listed in the strip as well');
  // But the strip stays: it is the cross-section queue view, and a job with no row yet has nowhere
  // else to appear. Emptied by the dedupe it must say where its jobs went, not go silent — a blank
  // strip under a live queue reads as broken.
  assert.match(poll, /populateRequestsStrip\(\$\('#requests-strip'\), unbound, active\.length/,
    'the strip must still render the unbound jobs, with an honest empty state when there are none');
  assert.match(poll, /already shown on the rows below/,
    'and that empty state must explain the dedupe rather than leave a gap');
});

test('U3: a needs-you row names its state, and a parked row drops the decision material', () => {
  const ui = readUi();
  const row = fnBody(ui, 'function inboxRow(');

  // The inbox was the last surface where ready-to-post / needs-review / needs-rereview /
  // author-responded drew identically — the section cards gained the pill in 3d008a8.
  assert.match(row, /cat \? wsStatePill\(cat\) : null/,
    'a banded row must wear the state pill, whatever its density');
  assert.match(ui, /function inboxRow\(r, job = null, density = 'full', cat = null\)/,
    'and a row drawn outside the bands (the Done disclosure) must still be able to pass neither');
  // Compact rows: title, kind, pill, ONE stamp. The dial is a score you weigh before opening
  // something, and nothing parked on someone else is waiting on that decision.
  assert.match(row, /compact \? null : dialEl\(/, 'a compact row must not draw the readiness dial');
  assert.match(row, /const bits = done \|\| compact \? \[\] : needsYouBits\(r\.counts\)/,
    'nor the needs-you counts');
  assert.match(row, /compact \? compactStamp\(r, job, cat\) : null/,
    'it earns the one stamp that says why it is parked, chosen by the same rule a compact card uses');
  // Every density keeps the two things that make a row usable at all.
  assert.match(row, /href: `#\/feature\/\$\{encodeURIComponent\(r\.id\)\}`/,
    'every row keeps its link to the workspace');
  assert.match(row, /class: 'btn-icon ir-delete'/, 'and its delete-confirm flow');
});

test('U3: the inbox skips an empty band and keeps both edge cases', () => {
  const ui = readUi();
  const inbox = fnBody(ui, 'function renderHomeInbox(');

  // Shared with the sections, so the "never a header with zero under it" rule is pinned once — but
  // the inbox has to actually go through it, which is what this asserts.
  assert.match(fnBody(ui, 'function bandSections('), /if \(!rows\.length\) continue;/,
    'the shared loop must skip a band with nothing in it');
  assert.match(inbox, /bands\.length\s*\?\s*bands/,
    'the inbox draws whatever bands came back — it must not fill in the missing ones');
  assert.match(inbox, /No active workspaces — everything below is complete\./,
    'nothing active but something done must keep the all-done note');
  assert.match(inbox, /doneDisclosure\('home',\s*\n?\s*doneRows\.map\(\(r\) => \(\{ sortable: r, el: inboxRow\(r\) \}\)\), 'inbox done-disc-body'\)/,
    'and the Done disclosure and its date sort must be left exactly as they were');
  // The zero-workspace case never reaches here: renderHome answers it with the seeding empty state.
  assert.match(fnBody(ui, 'async function renderHome('), /if \(rows\.length === 0\)/,
    'an empty cockpit must still get the "Nothing in the cockpit yet" view');
});

/* U4 — the three findings an independent reviewer raised against ce22adf. Source assertions again
 * (`node --test` cannot import browser code), and deliberately NOT of the shape the reviewer showed
 * to be worthless: `/class: 'btn-icon ir-delete'/` was green for the whole time the delete-confirm
 * was being destroyed every four seconds, because it proved the button was CONSTRUCTED and never
 * that it SURVIVED. These pin ordering and control flow — which branch returns before which write —
 * so breaking the property breaks the test. The rendering itself is verified in a real browser. */

test('U4: a PR number may only bind a workspace of the job\'s OWN kind', () => {
  const ui = readUi();
  const bind = codeOnly(fnBody(ui, 'function jobBindsTo('));

  // prNumber() falls back to `id.match(/(\d+)/)` — ANY digit run in ANY workspace id. So a
  // pr-review of PR 7001 bound `spec-7001-checkout`: that spec row drew "Re-reviewing" and was
  // banded into "In progress" by a runner that had never heard of it. Requiring the job to be
  // PR-shaped was only half the rule; the workspace has to be too.
  //
  // And "a PR kind" is not narrow enough either. One PR can carry BOTH a pr-review workspace and a
  // pr-respond one; a membership test binds each job to both, which puts "Re-reviewing" on the row
  // where you are answering reviewer threads and lets one job claim two cards. The gate must be
  // EQUALITY — a job's action names the kind of workspace it acts on.
  const gate = bind.indexOf('job.action !== f.kind');
  const match = bind.indexOf('prNumber(f)');
  assert.ok(gate > -1,
    'the kind gate must compare the job action to the feature kind, not test membership of a set: '
    + "a `pr-respond` job binding a `pr-review` workspace of the same PR is the bug this closes");
  assert.ok(!/f\.kind !== 'pr-review'|f\.kind !== 'pr-respond'/.test(bind),
    'and the old "is it any PR kind" membership test must be gone, not merely joined — two gates '
    + 'means the looser one is still deciding something');
  assert.ok(match > gate, 'the kind gate must GUARD the prId match — after it, it guards nothing');

  // The wsId arm is an exact id match and stays kind-agnostic by design: an `apply` names its
  // workspace and nothing else can answer to it, spec or PR.
  const wsArm = bind.indexOf('job.wsId === f.id');
  assert.ok(wsArm > -1 && wsArm < gate,
    'the wsId arm must stay ahead of the kind gate — narrowing it would break apply on specs');

  // One predicate, one place. A caller that re-states the rule is the drift 80c4f76 removed, and
  // Home re-stating it would leave every OTHER call site still wrong.
  const inbox = codeOnly(fnBody(ui, 'function renderHomeInbox('));
  assert.ok(!/kind/.test(inbox),
    'renderHomeInbox must not filter by kind itself — jobBindsTo owns the binding rule');
});

test('U4: a poll tick that changes nothing touches nothing', () => {
  const ui = readUi();
  const inbox = codeOnly(fnBody(ui, 'function renderHomeInbox('));
  const sig = codeOnly(fnBody(ui, 'function homeInboxSig('));

  const sigAt = inbox.indexOf('homeInboxSig(active, doneRows)');
  const paintAt = inbox.indexOf('zone.replaceChildren(');
  assert.ok(sigAt > -1, 'the tick must derive a signature of what the inbox renders');
  assert.ok(paintAt > sigAt, 'and derive it BEFORE the repaint, or the comparison decides nothing');
  assert.match(inbox.slice(sigAt, paintAt), /if \(sig === homeInbox\.sig\) \{[^}]*return used;\s*\}/,
    'an unchanged signature must return without ever reaching replaceChildren');

  // The signature has to be the banded layout itself, or it goes stale in the direction that
  // matters: a band that moved and a screen that never repaints to say so.
  assert.match(sig, /e\.r\.id/, 'the signature must carry which rows are drawn');
  assert.match(sig, /e\.cat/, 'and the state each one landed in');
  assert.match(sig, /wsState\(e\.cat\)\.band/, 'and the band that state puts it in');
  assert.match(sig, /e\.job\.id/, 'and the identity of the job folded onto it');
  assert.match(sig, /e\.job\.status/, 'and that job\'s status — "queued → running" is a visible change');
  assert.match(sig, /doneRows\.map/, 'and the Done rows, whose count the disclosure prints');

  // Recorded only once the paint has landed. Stamped earlier, a tick that skipped would make its
  // own skip permanent — the deferred change becomes a dropped one.
  assert.ok(inbox.indexOf('homeInbox.sig = sig') > paintAt,
    'the signature must be recorded after the repaint, never before or instead of it');
  // A fresh zone is an empty zone: a stale signature matching would skip the first paint into it.
  assert.match(codeOnly(fnBody(ui, 'async function renderHome(')), /homeInbox\.sig = null/,
    'renderHome must clear the signature when it rebuilds the inbox zone');
  // Whether or not it painted, the strip still needs to know what is on screen.
  assert.equal((inbox.match(/return used;/g) || []).length, 4,
    'every exit from renderHomeInbox must still answer which jobs the rows hold');
});

test('U4: a repaint never lands on top of an interaction — and is never dropped either', () => {
  const ui = readUi();
  const inbox = codeOnly(fnBody(ui, 'function renderHomeInbox('));
  const busy = codeOnly(fnBody(ui, 'function zoneHold('));
  const flush = codeOnly(fnBody(ui, 'function flushHomeInboxSoon('));
  const release = codeOnly(fnBody(ui, 'function releaseHomeInbox('));
  const home = codeOnly(fnBody(ui, 'async function renderHome('));

  const guardAt = inbox.indexOf('zoneHold(zone)');
  const paintAt = inbox.indexOf('zone.replaceChildren(');
  assert.ok(guardAt > -1, 'a tick must ask whether the user is mid-interaction before repainting');
  assert.ok(guardAt < paintAt, 'and ask it before the write, not after');
  assert.match(inbox.slice(guardAt, paintAt), /homeInbox\.pending = true;[\s\S]*?return used;/,
    'a tick arriving mid-interaction must HOLD the repaint and return, not perform it');

  // The interactions a replaceChildren destroys without a trace.
  assert.match(busy, /querySelector\('\.delete-confirm'\)/,
    'an open delete-confirm must block the repaint — rebuilding it answers "no" for the user');
  assert.match(busy, /zone\.contains\(a\)/,
    'so must focus inside the zone — the swap drops a keyboard user to <body>');

  // Held, not dropped. Two independent releases, because either alone has a hole: the tick alone
  // leaves up to four seconds of stale bands after a Cancel, and the event alone loses the change
  // if the interaction ends some way that fires neither. The body moved into releaseHomeInbox when
  // the full-view reload joined the same guard; the properties are the ones that always held.
  assert.match(release, /homeInbox\.pending/, 'the release must only fire when something is actually held');
  assert.match(release, /renderHomeInbox\(homeInbox\.reqs\)/,
    'and must replay the held tick, not repaint from an empty queue');
  assert.match(flush, /setTimeout\(/,
    'deferred a turn: during focusout activeElement is transiently <body>, so asking now would '
    + 'answer "nobody is here" mid-Tab and destroy the element about to receive focus');
  assert.match(flush, /releaseHomeInbox/, 'and the deferred call must be the shared release');
  assert.match(home, /onclick: flushHomeInboxSoon/,
    'the zone must release the hold on the click that ends a confirm');
  assert.match(home, /onfocusout: flushHomeInboxSoon/, 'and on the blur that ends a keyboard visit');
  assert.match(inbox, /homeInbox\.reqs = requests/,
    'and the tick must keep its requests, or the flush has nothing to replay');
  // The tick-side release: a skipped tick must leave the signature stale so the NEXT tick still
  // sees a difference and paints it.
  assert.ok(!/homeInbox\.sig = sig/.test(inbox.slice(guardAt, paintAt)),
    'a held tick must not record the signature it never painted');
});

test('U4: the strip accounts for the jobs it is not listing', () => {
  const ui = readUi();
  const poll = codeOnly(fnBody(ui, 'function startHomeRequestsPoll('));
  const strip = codeOnly(fnBody(ui, 'function populateRequestsStrip('));
  const row = codeOnly(fnBody(ui, 'function requestRow('));

  // The dedupe only explained itself when it removed EVERYTHING. On partial binding the screen
  // read "2 JOBS" in the strip beside "▶ Run 3 jobs" in the toolbar, with nothing joining them.
  assert.match(poll, /const onRows = active\.length - unbound\.length/,
    'the strip must compute the remainder it is not listing');
  assert.match(poll, /note: onRows \?/, 'and hand it over only when there is one');
  assert.match(strip, /o\.note \?/,
    'and the strip must render it beside its own count, where the arithmetic closes');

  // A PR with two live jobs folds one onto its row and leaks the runner-up into the strip. Keeping
  // it visible is right — hiding live work is the worse lie — but unlabelled it reads as a second
  // PR rather than a second job on the one already below.
  assert.match(poll, /jobBindsTo\(r, row\)/,
    '"does this strip entry already have a row" is jobBindsTo asked again, not a second matcher');
  assert.match(poll, /onRow: alsoOnRow/, 'and the answer must reach the strip');
  assert.match(strip, /requestRow\(r, onRow\(r\)\)/, 'which must pass it down to the entry');
  assert.match(row, /also on a row below/, 'and the entry must say so');
  assert.match(ui, /function requestRow\(r, onRow = false\)/,
    'defaulted, so the strips that show the whole queue read exactly as they did');
  assert.ok(!/unbound = unbound\.filter|unbound\.filter\(/.test(poll),
    'the runner-up must be labelled, never suppressed');
});

/* U5 — the loose ends. Two shapes of test here, and the difference is deliberate.
 *
 * Where a rule is PURE it is lifted out of web/app.js and RUN (fnSource + liftUi below), because a
 * source assertion can only ever say the code looks right. Where a rule is inseparable from the DOM
 * or from module state it stays a source assertion — and then it pins ORDERING and CONTROL FLOW,
 * never the presence of a constructed string. That distinction is the lesson of
 * `/class: 'btn-icon ir-delete'/`, which was green throughout the period the delete-confirm was
 * being destroyed every four seconds: it proved the button was built, never that it survived.
 * What the source assertions cannot reach is verified in a real browser. */

/* Like fnBody, but keeps the signature, so the text can be evaluated as a function. */
function fnSource(src, decl) {
  const at = src.indexOf(decl);
  assert.ok(at > -1, `web/app.js must declare ${decl}`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error(`unbalanced braces reading ${decl}`);
}

/* Lifts top-level declarations out of web/app.js and evaluates them, so a pure rule can be tested
 * by running it on real inputs instead of by pattern-matching its text. `decls` entries are either
 * `function <name>(` (lifted whole from the file) or a literal line to include verbatim; anything
 * the lifted code closes over is named in `env`. The env is itself a guard: a rule that quietly
 * grows a dependency on the DOM or on `state` stops lifting here rather than drifting unnoticed. */
function liftUi(ui, decls, env = {}) {
  const src = decls.map((d) => (d.startsWith('function ') ? fnSource(ui, d) : d)).join('\n');
  const names = decls.filter((d) => d.startsWith('function '))
    .map((d) => d.slice('function '.length, d.indexOf('(')));
  const keys = Object.keys(env);
  // eslint-disable-next-line no-new-func
  return new Function(...keys, `${src}\nreturn { ${names.join(', ')} };`)(...keys.map((k) => env[k]));
}

test('U5: a PR job binds only the workspace of its own kind', () => {
  const ui = readUi();
  // jobBindsTo reads nothing but its two arguments and prNumber, so it can be run rather than read.
  const { jobBindsTo } = liftUi(ui, ['function prNumber(', 'function jobBindsTo(']);

  // The two workspaces one pull request can carry at the same time. They are different work on
  // different findings: on the first you are the reviewer, on the second you are the author.
  const review = { id: 'pr-7001-checkout', kind: 'pr-review', title: 'Checkout rewrite #7001' };
  const respond = { id: 'pr-7001-checkout-respond', kind: 'pr-respond', title: 'Checkout rewrite #7001' };

  // The regression: a pr-respond job used to bind the pr-review workspace (and the reverse), so the
  // runner's verb landed on the wrong row — "Re-reviewing" printed on the workspace where you are
  // answering reviewer threads — and one job claimed two cards, making a band count name more
  // workspaces than the band held.
  assert.equal(jobBindsTo({ id: 'j1', action: 'pr-respond', prId: 7001 }, review), false,
    'a pr-respond job must not bind the pr-review workspace for the same PR');
  assert.equal(jobBindsTo({ id: 'j2', action: 'pr-review', prId: 7001 }, respond), false,
    'nor a pr-review job the pr-respond workspace');
  // And each still binds its own — the narrowing must not cost the binding that was right.
  assert.equal(jobBindsTo({ id: 'j3', action: 'pr-respond', prId: 7001 }, respond), true);
  assert.equal(jobBindsTo({ id: 'j4', action: 'pr-review', prId: 7001 }, review), true);
  assert.equal(jobBindsTo({ id: 'j5', action: 'pr-review', prId: '7001' }, review), true,
    'and the ids compare as strings, because the queue and the title carry different types');

  // The earlier half of the same rule, still holding: prNumber() falls back to any digit run in any
  // id, so an ungated match let a PR job bind a spec workspace that merely contains the number.
  assert.equal(jobBindsTo({ id: 'j6', action: 'pr-review', prId: 7001 },
    { id: 'spec-7001-checkout', kind: 'spec' }), false,
  'a PR job must never bind a spec workspace whose id merely contains the number');

  // The wsId arm stays exact and kind-agnostic: it names one workspace outright, and an `apply` on
  // a spec has no other way to find its target. Narrowing this arm by kind would break Apply.
  assert.equal(jobBindsTo({ id: 'j7', action: 'apply', wsId: 'spec-7001-checkout' },
    { id: 'spec-7001-checkout', kind: 'spec' }), true);
  assert.equal(jobBindsTo({ id: 'j8', action: 'apply', wsId: 'pr-7001-checkout' }, review), true);
  assert.equal(jobBindsTo({ id: 'j9', action: 'apply', wsId: 'pr-7001-checkout' }, respond), false,
    'and it is an id match, not a PR match — an apply names one workspace');
  // A non-PR action with no wsId can never reach the number comparison at all.
  assert.equal(jobBindsTo({ id: 'j10', action: 'apply', prId: 7001 }, review), false);
  assert.equal(jobBindsTo({ id: 'j11', action: 'poll', prId: 7001 }, review), false);
  // Defensive edges the callers actually hand it: a missing side, and a PR-less workspace.
  assert.equal(jobBindsTo(null, review), false);
  assert.equal(jobBindsTo({ id: 'j12', action: 'pr-review', prId: 7001 }, null), false);
  assert.equal(jobBindsTo({ id: 'j13', action: 'pr-review' }, review), false,
    'a PR job with no prId and no wsId binds nothing — it must not fall through to a match');
});

test('U5: a deleted workspace is pruned from the cache the poller repaints from', () => {
  const ui = readUi();

  // Both list views cache their rows and repaint from that cache on every tick that sees a change,
  // and each cache is refilled only by a full re-render. Removing the element alone therefore
  // un-deletes the workspace on the next live job: the row comes back, linking to a 404. This is
  // DOM-and-module-state code, so it is pinned by ordering — the prune must sit on the success
  // path, after the server confirmed, and never in the catch.
  for (const [owner, host, cache, key] of [
    ['the Home inbox', 'function inboxRow(', 'state.home.rows =', 'r.id'],
    ['a section card', 'function featureCard(', 'state.section.features =', 'f.id'],
  ]) {
    const del = codeOnly(fnBody(fnBody(ui, host), 'async function doDelete()'));
    const sent = del.indexOf("method: 'DELETE'");
    const pruned = del.indexOf(cache);
    const caught = del.indexOf('} catch');
    assert.ok(sent > -1, `${owner} must still issue the DELETE`);
    assert.ok(pruned > -1, `${owner} must prune its cache when the delete succeeds`);
    assert.ok(pruned > sent,
      `${owner} must prune only AFTER the server confirmed — pruning first hides a workspace that `
      + 'is still there when the request fails');
    assert.ok(caught > -1 && pruned < caught,
      `${owner} must prune on the success path, not in the failure handler`);
    assert.ok(del.includes(`!== ${key}`),
      `${owner} must drop exactly the deleted id from the cache, not clear it`);
  }

  // And the prune is load-bearing only because these two still repaint from the caches. If either
  // stopped, the assertions above would be guarding nothing.
  assert.match(codeOnly(fnBody(ui, 'function renderHomeInbox(')), /state\.home && state\.home\.rows/,
    'the inbox must still draw from state.home.rows — that is what makes a stale entry visible');
  assert.match(codeOnly(fnBody(ui, 'function startSectionRequestsPoll(')),
    /sectionGrid\(kind, state\.section\.features, rel\)/,
    'and the section poll from state.section.features');
});

test('U5: the section poll asks the binding predicate instead of restating it', () => {
  const ui = readUi();
  const poll = codeOnly(fnBody(ui, 'function startSectionRequestsPoll('));

  // `r.action === 'apply' && r.wsId && wsIds.has(r.wsId)` was the wsId arm of jobBindsTo, copied
  // out one function beyond the guarded zone. It is the exact shape that shipped wrong twice: the
  // predicate learns an arm, the copy does not, and two surfaces disagree about which jobs exist.
  assert.ok(!/wsIds/.test(poll), 'the poll must not build its own set of workspace ids');
  assert.ok(!/\.wsId\b/.test(poll),
    'nor read wsId at all — which field decides a binding is jobBindsTo\'s business alone');
  assert.match(poll, /jobBindsTo\(/, 'it must go through the shared predicate');

  // Behaviour preserved exactly, which is the whole requirement: this is a RELEVANCE filter, not
  // the binding rule. Same-kind jobs reach the grid whether or not they bind a workspace — that is
  // what lets an in-flight review with no workspace yet draw its pending placeholder — and the
  // predicate guards only the `apply` arm, where the old copy sat.
  // The kind arm is KIND_ACTIONS now rather than `r.action === kind` (see U6), but its POSITION in
  // the filter is the property that mattered and still does.
  const kindArm = poll.indexOf('actsOnKind(r, kind)');
  const applyArm = poll.indexOf("r.action === 'apply'");
  const asked = poll.indexOf('jobBindsTo(');
  assert.ok(kindArm > -1, 'every job of this section\'s own kind must still be relevant to it');
  assert.ok(applyArm > -1 && asked > applyArm,
    'and the predicate must guard the apply arm — asking it of the kind arm would drop the '
    + 'workspace-less reviews that placeholders are made of');
  assert.ok(kindArm < applyArm, 'with the unconditional kind arm first, as it was');

  // The filter must be computed before the grid is drawn from it, or it decides nothing.
  const relAt = poll.indexOf('const rel =');
  const drawAt = poll.indexOf('sectionGrid(');
  assert.ok(relAt > -1 && drawAt > relAt, 'the grid must be drawn from the filter, not beside it');

  // No copy left anywhere. A caller may ask "is this even a PR job" (a bare truthiness read), but
  // comparing an id or a PR number to a workspace is the predicate's job and only its job.
  for (const fn of ['startSectionRequestsPoll', 'startHomeRequestsPoll', 'renderHomeInbox',
    'jobForFeature', 'sectionGrid']) {
    const body = codeOnly(fnBody(ui, `function ${fn}(`));
    assert.ok(!/\.wsId\b/.test(body), `${fn} must not read wsId — one rule, or the call sites drift`);
    assert.ok(!/prId\s*===|String\([^)]*prId/.test(body),
      `${fn} must not compare prId to a workspace — that comparison lives in jobBindsTo`);
  }
});

test('U5: the lifecycle chip is drawn only when it says something', () => {
  const ui = readUi();
  const card = codeOnly(fnBody(ui, 'function featureCard('));

  // One spelling of the default, shared by the chip's own fallback and by the gate. Two copies and
  // the gate starts hiding a value the chip would have rendered, or the reverse.
  const defaultDecl = ui.match(/^const DEFAULT_STATUS = '[^']+';$/m);
  assert.ok(defaultDecl, 'the default lifecycle value must be declared once, at module scope');
  assert.equal((ui.match(/const DEFAULT_STATUS\s*=/g) || []).length, 1,
    'and exactly once — the gate and the chip must read the same word');
  assert.match(codeOnly(fnBody(ui, 'function statusChip(')), /status \?\? DEFAULT_STATUS/,
    'statusChip must fall back to that same constant rather than its own literal');

  // The gate is pure, so run it. `draft` — what ingest writes and every active workspace carries —
  // is suppressed; every other value still reaches the real chip. This is a suppression, not a
  // deletion: auditing / reworking / ready / implementing arrive through
  // POST /api/features/:id/status, and `done` is what the Done disclosure shows.
  const drawn = [];
  const { statusChipIfMeaningful } = liftUi(ui,
    [defaultDecl[0], 'function statusChipIfMeaningful('],
    { statusChip: (s) => { drawn.push(s); return { chip: String(s) }; } });

  assert.equal(statusChipIfMeaningful('draft'), null, '`draft` must draw nothing');
  assert.equal(statusChipIfMeaningful(undefined), null,
    'and so must a missing status, which statusChip itself reads as `draft`');
  assert.equal(statusChipIfMeaningful(null), null);
  assert.deepEqual(drawn, [], 'none of those may reach the chip at all');
  for (const s of ['done', 'auditing', 'reworking', 'ready', 'implementing']) {
    assert.ok(statusChipIfMeaningful(s), `"${s}" discriminates and must still draw`);
  }
  assert.deepEqual(drawn, ['done', 'auditing', 'reworking', 'ready', 'implementing'],
    'and must be rendered by the real chip, unchanged — the gate decides whether, never what');

  // The card goes through the gate, and must not keep an unguarded call beside it.
  assert.match(card, /statusChipIfMeaningful\(f\.status\)/,
    'featureCard must draw the lifecycle chip through the gate');
  assert.ok(!/statusChip\(f\.status\)/.test(card),
    'and never past it — one unguarded call puts `draft` back on every active card');
  // The pill it sits next to is the thing that actually discriminates, and it stays.
  assert.match(card, /cat \? wsStatePill\(cat\) : null/,
    'the state pill must be untouched — it is what the chip was crowding');
});

test('U5: the Home subtitle agrees with its own count', () => {
  const ui = readUi();
  // Pure string assembly, so run it. plural() inflects the noun only; the verb was left at the
  // plural, so the landing screen read "1 workspace need you" — and one is the ordinary case.
  const { homeSubtitle } = liftUi(ui, ['function plural(', 'function homeSubtitle(']);

  assert.equal(homeSubtitle(1, 1), '1 workspace needs you · 1 workspace total');
  assert.equal(homeSubtitle(7, 1), '1 workspace needs you · 7 workspaces total');
  // The n>1 wording is the one that was already right, and it must be untouched.
  assert.equal(homeSubtitle(9, 3), '3 workspaces need you · 9 workspaces total');
  assert.equal(homeSubtitle(2, 2), '2 workspaces need you · 2 workspaces total');
  // Nothing needing you takes the other branch entirely, singular included.
  assert.equal(homeSubtitle(1, 0), 'All caught up · 1 workspace under watch');
  assert.equal(homeSubtitle(4, 0), 'All caught up · 4 workspaces under watch');
});

test('U5: a band names itself, and its name carries its size', () => {
  const ui = readUi();
  const loop = codeOnly(fnBody(ui, 'function bandSections('));

  // The <section> had no accessible name, so three bands appeared in a landmark list as three
  // anonymous regions; and the count sat in a span OUTSIDE the <h2>, so heading navigation
  // announced "Needs you" without the one number that decides whether you enter the band.
  assert.match(loop, /'aria-labelledby': headId/,
    'the band section must be named by its own heading');
  const mint = loop.indexOf('const headId');
  const use = loop.indexOf("'aria-labelledby': headId");
  const onHead = loop.indexOf('id: headId');
  assert.ok(mint > -1 && use > mint && onHead > mint,
    'the id must be minted before it is referenced and before it is placed');

  // The count must be a CHILD of the heading, not its sibling — that is the whole fix for heading
  // navigation, and reverting it would leave aria-labelledby resolving to a nameless label.
  const h2At = loop.indexOf("h('h2'");
  const countAt = loop.indexOf("h('span', { class: 'band-count' }");
  assert.ok(h2At > -1 && countAt > h2At, 'the count must come after the h2 opens');
  assert.ok(!/\}, band\.label\),/.test(loop),
    'the h2 must not close before the count — a sibling span is the arrangement being replaced');

  // A counter, not the band key: two banded lists on one page would mint the same key-derived id
  // twice, and a duplicate id makes aria-labelledby silently resolve to the wrong heading.
  assert.match(loop, /\+\+bandHeadSeq/, 'each band head must get an id of its own');
  assert.ok(!/band-head-\$\{cssSafe\(band\.key\)\}/.test(loop),
    'and it must not be derived from the band key, which repeats across lists');

  // Semantics only: the header must stay the quiet divider it is. Making it focusable or clickable
  // would put it in the tab order beside the Done disclosure, which IS a control.
  assert.ok(!/role:\s*'button'|tabindex|onclick/.test(loop),
    'the band header is structure, not a control — it must gain no interactive affordance');

  // The stylesheet has to hold the count's own metrics now that it inherits from the heading, or
  // this tree change becomes a visible one.
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'style.css'), 'utf8');
  const countRule = css.slice(css.indexOf('.band-count'), css.indexOf('.band-count') + 260);
  assert.match(countRule, /line-height:/,
    'the count must pin its line-height — inheriting the heading\'s 1.2 shortens the whole header');
  assert.match(countRule, /letter-spacing:/,
    'and restate its tracking, or it picks up the heading\'s uppercase .07em and pads "· N"');
  assert.ok(!/letter-spacing:\s*(inherit|\.07em|0\.07em)/.test(countRule),
    'and that restatement must not be the heading\'s own value');
  assert.match(css.slice(css.indexOf('.band-label {')), /^[^}]*display: flex/,
    'and the heading must become the flex row .band-head was, so the gap is unchanged');
});

/* U6 — the four findings left open against 316edb0's fix. Same two shapes as U5, for the same
 * reason: where a rule is pure it is LIFTED OUT AND RUN (rowAgeText, holdStands, actsOnKind), and
 * where it is inseparable from the DOM it is pinned by ORDERING and CONTROL FLOW — which branch
 * returns before which write — never by the presence of a constructed string. The rendering itself,
 * and everything about focus and live DOM these cannot reach, is verified in a real browser. */

test('U6: the full-view refetch goes through the same guard as the repaint', () => {
  const ui = readUi();
  const poll = codeOnly(fnBody(ui, 'function startHomeRequestsPoll('));
  const release = codeOnly(fnBody(ui, 'function releaseHomeInbox('));
  const home = codeOnly(fnBody(ui, 'async function renderHome('));

  // The narrow path that survived 316edb0: a second job completing while a confirm was open called
  // renderHome() outright, and renderHome() does app.replaceChildren() on the WHOLE view — outside
  // both the signature and the interaction guard. Measured: {"confirms":1,"active":"BUTTON.btn
  // btn-danger"} → {"confirms":0,"active":"BODY."}. The poller must no longer reach it directly.
  assert.ok(!/renderHome\(\)/.test(poll),
    'the poll must not call renderHome() itself — that is the unguarded write, whatever guards the '
    + 'repaint beside it');
  assert.match(poll, /homeInbox\.reload = true/,
    'a newly completed job must FLAG the refetch, so the guard decides when it happens');
  assert.match(poll, /releaseHomeInbox\(\)/,
    'and the tick must offer the flag to the release, or a completed job waits for an event that '
    + 'may never come');
  // Flagged, never dropped: the refetch exists because the server has new data.
  const flagAt = poll.indexOf('homeInbox.reload = true');
  const releaseAt = poll.indexOf('releaseHomeInbox()');
  assert.ok(flagAt > -1 && releaseAt > flagAt,
    'the release must come after the flag in the same tick, or the refetch is a tick late for no '
    + 'reason');

  // One guard, asked before the write — the same two functions the zone repaint asks.
  const askAt = release.indexOf('holdStands(hold, homeInbox)');
  const reloadAt = release.indexOf('renderHome()');
  const repaintAt = release.indexOf('renderHomeInbox(homeInbox.reqs)');
  assert.match(release, /const hold = zoneHold\(\$\('#home-inbox-zone'\)\)|zoneHold\(zone\)/,
    'the release must ask the SAME hold predicate, not invent a second one');
  assert.ok(askAt > -1 && reloadAt > askAt,
    'and ask it BEFORE renderHome() — after it, the view is already gone');
  assert.ok(repaintAt > askAt, 'and before the repaint, for the same reason');
  assert.match(release.slice(askAt, reloadAt), /return;/,
    'a standing hold must return without reaching either write');
  // A reload rebuilds the zone from fresh server data, so a repaint queued behind it is stale by
  // construction — drawing it first would paint the old rows and then throw them away.
  assert.ok(reloadAt < repaintAt, 'the reload must win over a repaint held beside it');

  // And the flag must not outlive the view it was raised against.
  assert.match(home, /homeInbox\.reload = false/,
    'renderHome must clear the pending reload it has just satisfied, or the next tick does it again');
});

test('U6: the hold on a confirm is absolute; the hold on a cursor has a ceiling', () => {
  const ui = readUi();
  const ceilingDecl = ui.match(/^const ZONE_BUSY_HOLD_MS = \d+;$/m);
  assert.ok(ceilingDecl, 'the ceiling must be declared once, at module scope, as a named constant');
  const CEILING = Number(ceilingDecl[0].match(/(\d+)/)[1]);
  // holdStands reads its two arguments and the clock, so it is run rather than read.
  const { holdStands } = liftUi(ui, [ceilingDecl[0], 'function holdStands(']);

  // Nothing held: no decision, and — critically — no clock started. Stamping heldAt on a quiet tick
  // would spend the ceiling before the first change that needed it ever arrived.
  const quiet = { heldAt: 0 };
  assert.equal(holdStands(null, quiet), false);
  assert.equal(quiet.heldAt, 0, 'an unheld tick must not start the hold clock');

  // A destructive confirm is an unanswered question. A repaint answers it "no" on the user's behalf
  // and there is nothing to restore, so no elapsed time makes that trade worth making.
  const confirming = { heldAt: Date.now() - CEILING * 100 };
  assert.equal(holdStands('confirm', confirming), true,
    'an open delete-confirm must hold however long it has been open — it has no ceiling');

  // A cursor is a place, not a decision. Holding is right while the user is moving through the
  // list; past the ceiling the list is lying about the world to protect a cursor position, which is
  // the worse of the two failures. Measured before the fix: frozen across 5+ ticks, data changing
  // on every one.
  const fresh = { heldAt: 0 };
  assert.equal(holdStands('busy', fresh), true, 'focus must still buy the user some time');
  assert.ok(fresh.heldAt > 0, 'and the first held decision must start the clock');
  const stale = { heldAt: Date.now() - (CEILING + 1000) };
  assert.equal(holdStands('busy', stale), false,
    'but past the ceiling the repaint must land — an indefinite freeze is the bug being closed');
  // Continuous time, not a count of calls: a user clicking around inside the zone is as entitled to
  // a truthful list as one sitting still, so repeated calls must not re-arm the budget.
  const armed = { heldAt: Date.now() - (CEILING - 500) };
  const at = armed.heldAt;
  holdStands('busy', armed); holdStands('busy', armed); holdStands('busy', armed);
  assert.equal(armed.heldAt, at, 'a second held decision must not restart the clock');
});

test('U6: a forced repaint puts the user back where it found them', () => {
  const ui = readUi();
  const inbox = codeOnly(fnBody(ui, 'function renderHomeInbox('));
  const grid = codeOnly(fnBody(ui, 'function startSectionRequestsPoll('));
  const mark = codeOnly(fnBody(ui, 'function zoneFocusMark('));
  const restore = codeOnly(fnBody(ui, 'function restoreZoneFocus('));

  // The ceiling would be a straight trade of one failure for another if it dropped the keyboard
  // user to <body> — that is exactly what the hold was added to prevent. A node reference cannot
  // survive replaceChildren, so the mark is a string looked up again in the rebuilt list.
  assert.match(mark, /\[data-fk\]/, 'the mark must be read off a stable key, not a node identity');
  assert.match(restore, /querySelector\(`\[data-fk="\$\{CSS\.escape\(fk\)\}"\]`\)/,
    'and redeemed by looking that key up in the NEW dom');
  assert.match(restore, /preventScroll: true/,
    'the user did not ask to move, so restoring focus must not scroll the page either');

  // Order is the whole property: taken while the old dom is still there, redeemed after the new one
  // exists. Either side of the write and it marks or restores nothing.
  for (const [name, body, write] of [
    ['the inbox', inbox, 'zone.replaceChildren('],
    ['the section grid', grid, 'zone.replaceChildren('],
  ]) {
    const took = body.indexOf('zoneFocusMark(zone)');
    const wrote = body.indexOf(write);
    const put = body.indexOf('restoreZoneFocus(zone, mark)');
    assert.ok(took > -1 && wrote > took, `${name} must take the focus mark before it repaints`);
    assert.ok(put > wrote, `${name} must restore focus after the repaint, not before it`);
  }

  // Every control a repaint can pull out from under the keyboard has to carry a key, or the mark is
  // null for it and the ceiling drops the user after all. These are all of them in both lists.
  for (const [what, decl, key] of [
    ['the inbox row link', 'function inboxRow(', 'fk: `row:${r.id}`'],
    ['its delete button', 'function inboxRow(', 'fk: `row-del:${r.id}`'],
    ['the full card', 'function featureCard(', 'fk: `card:${f.id}`'],
    ['its delete button', 'function featureCard(', 'fk: `card-del:${f.id}`'],
    ['the compact card', 'function compactCard(', 'fk: `card:${f.id}`'],
    ['the Done disclosure', 'function doneDisclosure(', 'fk: `done-sum:${key}`'],
    ['its sort menu', 'function doneDisclosure(', 'fk: `done-sort:${key}`'],
  ]) {
    assert.ok(codeOnly(fnBody(ui, decl)).includes(key),
      `${what} must carry a focus key (${key}) — without it a forced repaint loses the keyboard`);
  }
});

test('U6: a held list says so, and nothing already on screen moves when it does', () => {
  const ui = readUi();
  const note = codeOnly(fnBody(ui, 'function zoneHeldNote('));
  const poll = codeOnly(fnBody(ui, 'function startHomeRequestsPoll('));
  const inbox = codeOnly(fnBody(ui, 'function renderHomeInbox('));

  // While held the page stated two different things about one queue: the strip read "1 job in
  // flight — already shown on the rows below" while no row showed it. Both halves of the fix are
  // pinned here.
  //
  // Half one: the rows admit it. The note is raised on the SAME branch that holds, so it cannot be
  // forgotten on a path that holds silently.
  const holdAt = inbox.indexOf('holdStands(hold, homeInbox)');
  const paintAt = inbox.indexOf('zone.replaceChildren(');
  assert.ok(holdAt > -1 && holdAt < paintAt);
  assert.match(inbox.slice(holdAt, paintAt), /zoneHeldNote\(zone, HOME_HELD_NOTE\[hold\]\)/,
    'the branch that holds must be the branch that says it is holding');
  // And it must come down again when the list is no longer behind — a paused sign over a live list
  // is the same contradiction pointing the other way.
  assert.match(inbox, /clearZoneHeldNote\(zone\)/,
    'a tick that finds nothing outstanding must take the note down');
  const notes = ui.match(/const HOME_HELD_NOTE = \{[\s\S]*?\n\};/);
  assert.ok(notes, 'the wording must live in one table, not be built at the call site');
  assert.match(notes[0], /queue above has moved on/,
    'and it must say the queue above is AHEAD of these rows — "paused" alone leaves the strip\'s '
    + '"already shown on the rows below" standing, which is the contradiction being closed');

  // Half two: the strip and the toolbar deliberately DO NOT hold. Freezing the "▶ Run N jobs" count
  // means pressing a button that promises the wrong number, and freezing the strip hides live work
  // at the moment work is happening. They must stay ahead of the release, unguarded.
  const stripAt = poll.indexOf('populateRequestsStrip(');
  const runnerAt = poll.indexOf('renderRunnerZone(');
  const releaseAt = poll.indexOf('releaseHomeInbox()');
  assert.ok(stripAt > -1 && runnerAt > -1 && releaseAt > -1);
  assert.ok(stripAt < releaseAt && runnerAt < releaseAt,
    'the strip and the runner button must update before the hold is even consulted');
  assert.ok(!/holdStands|zoneHold/.test(poll.slice(0, Math.max(stripAt, runnerAt))),
    'and neither may be placed behind the hold — the fix is the rows admitting they are stale, '
    + 'not the rest of the screen going stale with them');

  // The note arrives while a confirm is open and the pointer is already over the red Delete button.
  // Anything that reflows the list above it turns a status line into a misclick on an irreversible
  // action, so it may only ever be appended.
  assert.match(note, /zone\.append\(note\)/, 'the note must be appended to the zone');
  assert.ok(!/prepend|insertBefore|replaceChildren/.test(note),
    'never prepended or inserted — that pushes an open confirm down under the pointer');
  assert.match(note, /if \(t\.textContent !== text\)/,
    'and written only on a real change, or role="status" re-announces the same sentence every '
    + 'four seconds for as long as the hold lasts');
  const css = fs.readFileSync(path.join(__dirname, '..', 'web', 'style.css'), 'utf8');
  const rule = css.slice(css.indexOf('.zone-held {'), css.indexOf('.zone-held {') + 400);
  assert.match(rule, /position: sticky/,
    'and pinned rather than placed, so a long held list still shows it');
  assert.match(css, /\.zone-held-text \{[^}]*min-width: 0/,
    'the sentence must wrap inside the note, or it forces the page wider than a 420px viewport');
  // Pinned means it floats over the bottom row. That row has to stay reachable, and the room has to
  // be made at the END — padding-bottom moves nothing already on screen, which is the same property
  // that makes appending safe. The reservation must be taken down by the paint, not only the note:
  // a zone left holding 90px of padding under a live list is a hole in the layout.
  assert.match(css, /\.zone-holding \{[^}]*padding-bottom: calc\(var\(--zone-held-h, [^)]*\)/,
    'the zone must reserve the note\'s measured height, with a fallback for the first frame');
  assert.match(note, /zone\.classList\.add\('zone-holding'\)/, 'raised with the note');
  assert.match(codeOnly(fnBody(ui, 'function clearZoneHeldNote(')), /classList\.remove\('zone-holding'\)/,
    'and taken down with it');
  for (const [where, decl] of [['the inbox', 'function renderHomeInbox('],
    ['the section grid', 'function startSectionRequestsPoll(']]) {
    const body = codeOnly(fnBody(ui, decl));
    const wrote = body.indexOf('zone.replaceChildren(');
    const cleared = body.indexOf('clearZoneHeldNote(zone)', wrote);
    assert.ok(cleared > wrote,
      `${where} must clear the reservation after it repaints — replaceChildren removes the note's `
      + 'element but leaves the padding its parent is carrying');
  }
});

test('U6: a rendered age is in the signature, and the clock is not', () => {
  const ui = readUi();
  // rowAgeText reads its arguments, the formatters and the clock — nothing else — so it is run.
  const staleDecl = ui.match(/^const JOB_STALE_MS = .*;$/m);
  assert.ok(staleDecl, 'JOB_STALE_MS must stay a module-scope constant');
  const { rowAgeText } = liftUi(ui, [
    'function fmtDate(', 'function fmtDateTime(', 'function fmtAgo(', 'function fmtAge(',
    'function reviewStampsOf(', staleDecl[0], 'function jobAgeMs(', 'function isStaleJob(',
    'function rowAgeText(',
  ], { runnerBusy: () => false });

  const ago = (mins, secs = 0) => new Date(Date.now() - (mins * 60 + secs) * 1000).toISOString();
  const row = (mins, secs) => ({ id: 'pr-1', stamps: { lastReviewedAt: ago(mins, secs) } });

  // The regression: "Reviewed 18m ago" is rendered text with nothing else in the signature standing
  // for it, so once a tick that changes nothing touched nothing, a card that read "queued 27m ago"
  // went on reading it at 40m. The text has to be IN the signature.
  assert.notEqual(rowAgeText(row(18), null), rowAgeText(row(19), null),
    'a minute that changes the words must change the signature, or the age freezes');
  assert.notEqual(rowAgeText(row(59), null), rowAgeText(row(61), null),
    'and so must the crossing into hours');

  // The other way to lose: Date.now() in the signature differs on EVERY tick, so every tick
  // repaints and the DOM-swap pressure this whole mechanism exists to remove is back in full. What
  // is folded in is the TEXT, which is the same string for a whole minute.
  assert.equal(rowAgeText(row(18, 0), null), rowAgeText(row(18, 30), null),
    'a quiet half-minute inside the same displayed minute must NOT repaint');
  assert.equal(rowAgeText(row(600), null), rowAgeText(row(605), null),
    'nor five minutes inside the same displayed hour');

  // The stale job's own clock ("Not running — queued 27m ago") is the third rendered age, and it is
  // only printed when the job is stale. `runnerBusy: false` above is what lets isStaleJob say so.
  const stale = { id: 'j1', status: 'queued', createdAt: ago(30), updatedAt: ago(30) };
  const staler = { id: 'j1', status: 'queued', createdAt: ago(31), updatedAt: ago(31) };
  const quiet = { id: 'j2', status: 'running', createdAt: ago(0, 10), updatedAt: ago(0, 10) };
  assert.notEqual(rowAgeText(row(1000), stale), rowAgeText(row(1000), staler),
    'the stale note\'s age must move the signature too');
  assert.equal(rowAgeText(row(1000), quiet), rowAgeText(row(1000), null),
    'a job that is not stale prints no clock of its own, so it must add nothing');

  // And the signature has to actually carry it — for the Done rows as well, which print the same
  // "Last reviewed 12m ago" and would freeze the same way.
  const sig = codeOnly(fnBody(ui, 'function homeInboxSig('));
  assert.match(sig, /rowAgeText\(e\.r, e\.job\)/, 'every active row must contribute its age text');
  assert.match(sig, /doneRows\.map\(\(r\) => `\$\{r\.id\}~\$\{rowAgeText\(r, null\)\}`\)/,
    'and every done row its own');
  assert.ok(!/Date\.now\(\)/.test(sig),
    'the signature must never read the clock directly — that repaints every single tick');
  assert.ok(!/Date\.now\(\)/.test(codeOnly(fnBody(ui, 'function renderHomeInbox('))),
    'nor may the tick that compares it');
});

test('U6: a section sees exactly the jobs that act on its own workspaces', () => {
  const ui = readUi();
  // KIND_ACTIONS + actsOnKind read nothing else, so they are run rather than read.
  const table = ui.match(/const KIND_ACTIONS = \{[\s\S]*?\n\};/);
  assert.ok(table, 'the kind→actions map must be declared once, at module scope');
  const { actsOnKind } = liftUi(ui, [table[0], 'function actsOnKind(']);

  // The bug: `r.action === kind` is true only because a PR review's action IS its workspace kind.
  // Spec has no action of its own name, so #/spec matched nothing and never folded a job — one
  // workspace reading "In progress" on Home and "Ready to post" on its own section.
  for (const a of ['audit', 're-audit', 'propose']) {
    assert.equal(actsOnKind({ action: a }, 'spec'), true, `#/spec must see its own ${a} jobs`);
    assert.equal(actsOnKind({ action: a }, 'pr-review'), false,
      `and a ${a} job must not reach a PR section`);
    assert.equal(actsOnKind({ action: a }, 'pr-respond'), false);
  }
  // No PR job may leak the other way, which is the scoping the fix could most easily get wrong.
  for (const a of ['pr-review', 'pr-respond']) {
    assert.equal(actsOnKind({ action: a }, 'spec'), false,
      `a ${a} job must never be admitted to #/spec`);
    assert.equal(actsOnKind({ action: a }, a), true, 'while each PR kind still sees its own');
  }
  assert.equal(actsOnKind({ action: 'pr-respond' }, 'pr-review'), false,
    'and the two PR kinds must not see each other, exactly as jobBindsTo refuses to cross them');
  // apply and poll are not owned by a kind. `apply` may only reach a section through jobBindsTo —
  // that is what keeps an apply on a PR workspace out of #/spec — and `poll` drives the Refresh
  // button, never a card.
  for (const kind of ['spec', 'pr-review', 'pr-respond']) {
    assert.equal(actsOnKind({ action: 'apply' }, kind), false,
      'apply must not be admitted by the kind arm — jobBindsTo is its only way in');
    assert.equal(actsOnKind({ action: 'poll' }, kind), false);
  }
  assert.equal(actsOnKind({ action: 'nonsense' }, 'spec'), false);
  assert.equal(actsOnKind({ action: 'audit' }, 'no-such-kind'), false,
    'an unknown kind must admit nothing rather than throw on an undefined lookup');

  // One taxonomy, like WS_STATES and WORKSPACE_STATES: every action the server can enqueue must be
  // either owned by exactly one kind or one of the two deliberately shared ones. A new action added
  // to ledger.js and forgotten here is precisely how #/spec went blind in the first place.
  const owners = new Map();
  for (const [kind, actions] of Object.entries(new Function(`${table[0]}; return KIND_ACTIONS;`)())) {
    for (const a of actions) {
      assert.ok(!owners.has(a), `"${a}" is claimed by both ${owners.get(a)} and ${kind}`);
      owners.set(a, kind);
    }
  }
  const shared = ['apply', 'poll'];
  for (const a of ledger.REQUEST_ACTIONS) {
    assert.ok(owners.has(a) || shared.includes(a),
      `ledger.js can enqueue "${a}" but no section claims it and it is not one of the shared `
      + `actions (${shared.join(', ')}) — it would be invisible on every section`);
  }
  for (const a of owners.keys()) {
    assert.ok(ledger.REQUEST_ACTIONS.includes(a),
      `KIND_ACTIONS claims "${a}", which ledger.js can never enqueue`);
  }
  for (const a of shared) {
    assert.ok(!owners.has(a), `"${a}" is shared and must not be claimed by a kind`);
  }
});

test('U6: #/spec is polled and banded like the PR sections, and guarded like them too', () => {
  const ui = readUi();
  const section = codeOnly(fnBody(ui, 'async function renderSection('));
  const grid = codeOnly(fnBody(ui, 'function sectionGrid('));
  const poll = codeOnly(fnBody(ui, 'function startSectionRequestsPoll('));

  // `if (isPr) startSectionRequestsPoll(kind)` is what left #/spec with no runner at all.
  assert.match(section, /\n\s*startSectionRequestsPoll\(kind\);/,
    'every kind must start the poll — a section that never sees a job cannot band by one');
  assert.ok(!/isPr\s*(\?|&&)?\s*startSectionRequestsPoll|if \(isPr\) startSectionRequestsPoll/.test(section),
    'and it must not be conditional on the kind being a PR one');
  // The section-actions header stays PR-only — spec has no Refresh or Run button and gains none.
  assert.match(section, /isPr\s*\n?\s*\?\s*h\('div', \{ class: 'section-actions' \}/,
    'the PR-only toolbar must stay PR-only: the poll is what generalises, not the header');

  // Both filters now read the one table, so a section cannot admit a job it does not own.
  assert.match(poll, /actsOnKind\(r, kind\)/, 'the relevance filter must ask the table');
  assert.match(grid, /actsOnKind\(r, kind\) && r\.prId/,
    'and so must the placeholder filter — with prId still required, because a placeholder has no '
    + 'workspace to take a name from and spec actions never carry one');
  assert.ok(!/r\.action === kind/.test(poll) && !/r\.action === kind/.test(grid),
    'the coincidence that a PR review\'s action equals its workspace kind must not be relied on '
    + 'anywhere — that is the whole bug');

  // Turning the poll on for #/spec hands it the repaint the PR sections already had, and this grid
  // draws the same delete-confirm the inbox does. Guarded by the SAME helpers — a second rule for
  // "may I repaint now" is how two surfaces drawing one confirm come to disagree about it.
  const holdAt = poll.indexOf('holdStands(hold, gridHold)');
  const writeAt = poll.indexOf('zone.replaceChildren(');
  assert.ok(holdAt > -1, 'the grid must ask the shared hold before repainting');
  assert.ok(writeAt > holdAt, 'and ask it before the write, not after');
  assert.match(poll.slice(holdAt, writeAt), /return;/,
    'a standing hold must return without reaching replaceChildren');
  assert.match(poll.slice(holdAt, writeAt), /zoneHeldNote\(zone, GRID_HELD_NOTE\[hold\]\)/,
    'and say so, for the same reason the inbox does');
  assert.ok(!/function (gridHold|sectionInteracting)\(/.test(ui),
    'the grid must reuse zoneHold/holdStands rather than grow a predicate of its own');
  // Its clock is its own, though: one shared record would carry a hold across a navigation between
  // two lists that are never on screen together.
  assert.match(ui, /^const gridHold = \{ heldAt: 0 \};$/m, 'the grid keeps its own hold clock');
  assert.match(section, /gridHold\.heldAt = 0/,
    'and a freshly rendered section must clear it — a fresh zone has no interaction in progress');
});
