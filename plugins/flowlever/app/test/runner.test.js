'use strict';

// Covers the process-spawning module. The properties under test are the ones that keep an HTTP
// handler spawning a subprocess safe and honest: a fixed prompt allowlist, one run at a time,
// truthful liveness, and a visible log.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlever-runner-'));
process.env.FLOWLEVER_DATA = tmpDir;

// A stand-in for the `claude` CLI: echoes its argv so we can assert exactly what was invoked,
// then lingers long enough for the concurrency checks.
const FAKE = path.join(tmpDir, 'fake-claude');
fs.writeFileSync(FAKE, '#!/bin/sh\necho "argv: $@"\necho "data: $FLOWLEVER_DATA"\nsleep 5\n');
fs.chmodSync(FAKE, 0o755);
process.env.FLOWLEVER_CLAUDE_BIN = FAKE;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const runner = require('../src/runner');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A login shell sources the user's profile, which can take a second or two on a real machine —
// poll for the expected output instead of guessing a fixed delay.
async function waitForLog(re, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const log = runner.tailLog();
    if (re.test(log)) return log;
    if (Date.now() > deadline) return log;
    await sleep(200);
  }
}

after(() => {
  try { runner.stop(); } catch { /* already idle */ }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('status resolves the binary from FLOWLEVER_CLAUDE_BIN and starts idle', () => {
  const s = runner.status();
  assert.equal(s.available, true);
  assert.equal(s.bin, FAKE);
  assert.equal(s.binFrom, 'FLOWLEVER_CLAUDE_BIN');
  assert.equal(s.running, false);
  assert.equal(s.logPath, path.join(tmpDir, 'runner.log'));
});

test('start refuses any action outside the allowlist (no request text reaches the shell)', () => {
  for (const action of ['rm -rf /', 'watch; touch /tmp/pwned', 'apply', '', null, 42]) {
    const r = runner.start(action);
    assert.equal(r.ok, false, `${JSON.stringify(action)} must be refused`);
    assert.equal(r.code, 'EACTION');
  }
  assert.equal(runner.isRunning(), false, 'a refused start must not spawn anything');
});

test('start spawns the fixed prompt, pins FLOWLEVER_DATA, and logs the invocation', async () => {
  const r = runner.start('watch');
  assert.equal(r.ok, true);
  assert.equal(runner.isRunning(), true);
  assert.equal(r.status.action, 'watch');
  assert.ok(r.status.pid > 0);

  const log = await waitForLog(/argv:/);
  assert.match(log, /=== watch started .* \(from the cockpit\) ===/);
  assert.match(log, /argv: -p \/flowlever:watch --dangerously-skip-permissions/,
    'the prompt must be exactly the allowlisted skill');
  assert.match(log, new RegExp(`data: ${tmpDir}`), 'the child writes to the ledger this server serves');
});

test('a second start while running is refused, not queued', () => {
  assert.equal(runner.isRunning(), true, 'previous test left it running');
  const r = runner.start('watch');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EBUSY');
  assert.ok(r.status.running);
});

test('stop terminates it and status turns truthful again', async () => {
  assert.equal(runner.stop().ok, true);
  await sleep(500);
  const s = runner.status();
  assert.equal(s.running, false);
  assert.equal(s.signal, 'SIGTERM');
  assert.ok(s.finishedAt, 'the end time is recorded');
  assert.equal(runner.stop().ok, false, 'stopping an idle runner is an error, not a silent no-op');
});

test('a missing binary is reported, not spawned blindly', () => {
  const saved = process.env.FLOWLEVER_CLAUDE_BIN;
  process.env.FLOWLEVER_CLAUDE_BIN = path.join(tmpDir, 'does-not-exist');
  try {
    const s = runner.status();
    assert.equal(s.available, false);
    assert.match(s.reason, /does not exist/);
    const r = runner.start('watch');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'ENOBIN');
  } finally {
    process.env.FLOWLEVER_CLAUDE_BIN = saved;
  }
});
