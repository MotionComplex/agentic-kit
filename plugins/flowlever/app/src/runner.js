'use strict';

// Start / stop / inspect the session-side runner FROM the cockpit.
//
// The browser can't reach Azure DevOps, so a queued job only moves when a Claude Code session runs
// `/flowlever:watch`. Until now that session had to be started by hand, which is why a Post could
// sit "queued" indefinitely with the UI unable to do anything about it. This module lets the local
// cockpit server launch exactly that session headlessly — the same `claude -p "<skill>"` invocation
// the launchd schedule already uses — so "Run queued jobs" is a button.
//
// Safety properties that matter here, because this spawns a process from an HTTP handler:
//   * The prompt is NEVER built from request data. Callers pass an action name that must be in
//     ACTIONS; the command string is assembled from constants + a resolved absolute binary path.
//   * One run at a time (a second request is refused, not queued), so a click-happy user can't
//     fork ten sessions posting the same comments.
//   * Output is appended to <data>/runner.log and tailed over the API, so a headless failure
//     (expired auth, missing MCP) is visible in the UI instead of silently doing nothing.
//   * The server binds loopback by default, which is what makes "same trust boundary as the CLI
//     that starts it" true. It is NOT true of a non-loopback bind, so server.js refuses to start a
//     runner in that case unless the operator explicitly opts in. (This comment previously claimed
//     the server was localhost-only while listen() bound every interface.)

const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const { DATA_DIR } = require('./ledger');

// The only prompts this module will ever run. `watch` drains the queue (this is what makes a
// pending Post actually post); `poll` additionally discovers new PRs first.
const ACTIONS = {
  watch: { prompt: '/flowlever:watch', label: 'Drain queued jobs' },
  poll: { prompt: '/flowlever:poll', label: 'Discover + drain' },
};

const LOG_PATH = () => path.join(DATA_DIR, 'runner.log');
const LOG_TAIL_BYTES = 16 * 1024;

// Env vars worth forwarding to the child: the ledger it must operate on, plus the poll tuning the
// README documents. Everything else comes from the login shell.
const FORWARD_ENV = [
  'FLOWLEVER_DATA', 'FLOWLEVER_ADO_PROJECT', 'FLOWLEVER_REVIEWER_EMAIL', 'FLOWLEVER_POLL_CAP',
];

const state = {
  child: null,
  action: null,
  pid: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  signal: null,
};

// A login shell is required, not cosmetic: Claude Code's OAuth token lives in the macOS Keychain,
// which is only reachable from inside the GUI login session's environment (the same reason the
// README insists on launchd over cron).
function loginShell() {
  for (const sh of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (fs.existsSync(sh)) return sh;
  }
  return null;
}

// Resolve the `claude` binary without trusting the server's own PATH: a cockpit started from an
// editor, a launchd job or a shim'd terminal can each see a different PATH, and a stale shim path
// would fail at spawn time with nothing useful to show the user.
function resolveBin() {
  const explicit = process.env.FLOWLEVER_CLAUDE_BIN;
  if (explicit) {
    return fs.existsSync(explicit)
      ? { bin: explicit, from: 'FLOWLEVER_CLAUDE_BIN' }
      : { bin: null, reason: `FLOWLEVER_CLAUDE_BIN points at "${explicit}", which does not exist` };
  }
  const local = path.join(process.env.HOME || '', '.local/bin/claude');
  if (local && fs.existsSync(local)) return { bin: local, from: '~/.local/bin/claude' };
  const sh = loginShell();
  if (sh) {
    try {
      // `command -v` inside a login shell finds it the way the user's own terminal would.
      const out = cp.execFileSync(sh, ['-lc', 'command -v claude'], { encoding: 'utf8', timeout: 5000 }).trim();
      if (out && fs.existsSync(out)) return { bin: out, from: 'PATH (login shell)' };
    } catch { /* not on PATH */ }
  }
  return {
    bin: null,
    reason: 'Could not find the `claude` CLI. Install it, or set FLOWLEVER_CLAUDE_BIN to its full path.',
  };
}

function inProcessRunning() {
  return Boolean(state.child) && state.exitCode === null && state.signal === null;
}

// The "one run at a time" guard used to live only in this module's memory, so restarting the server
// forgot it entirely: a runner started before the restart was invisible, and the next click spawned
// a second session draining the same queue. The pid file makes the guard survive a restart.
//
// A recycled pid could in principle read as alive. That errs toward REFUSING to start a second
// runner, which is the safe direction — the cost is a stale-looking "already going" the operator can
// clear by stopping it, versus two sessions posting the same comments twice.
const PID_PATH = () => path.join(DATA_DIR, 'runner.pid');

// "Alive" means alive AND ours to signal. EPERM says the pid exists but belongs to another user,
// which our runner never does — it is a recycled pid belonging to someone else's process. Treating
// that as a live runner adopted a process we could neither stop (DELETE returned EPERM and left the
// stamp in place) nor replace (start returned EBUSY), leaving the runner permanently unusable with
// no in-product way out. Treating it as not-ours discards the stale stamp instead.
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code !== 'ESRCH' && err.code !== 'EPERM' ? true : false;
  }
}

function writePidFile(pid, action, startedAt) {
  try { fs.writeFileSync(PID_PATH(), JSON.stringify({ pid, action, startedAt }, null, 2) + '\n'); }
  catch { /* the guard degrades to in-process only */ }
}

function clearPidFile() {
  try { fs.rmSync(PID_PATH(), { force: true }); } catch { /* ignore */ }
}

// A runner this process did not spawn (started before a server restart), still alive.
function externalRunner() {
  if (inProcessRunning()) return null;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(PID_PATH(), 'utf8')); }
  catch { return null; }
  const pid = Number(doc && doc.pid);
  if (!Number.isInteger(pid) || pid <= 1 || !pidAlive(pid)) {
    clearPidFile();
    return null;
  }
  return { pid, action: doc.action || null, startedAt: doc.startedAt || null };
}

function isRunning() {
  return inProcessRunning() || Boolean(externalRunner());
}

function tailLog() {
  try {
    const fd = fs.openSync(LOG_PATH(), 'r');
    try {
      const { size } = fs.fstatSync(fd);
      const start = Math.max(0, size - LOG_TAIL_BYTES);
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function status() {
  const resolved = resolveBin();
  const sh = loginShell();
  // An adopted runner (started before a restart) must show up as running with ITS pid/action, not
  // as idle — otherwise the UI offers a Start button that will be refused.
  const external = externalRunner();
  return {
    available: Boolean(resolved.bin) && Boolean(sh),
    reason: resolved.bin ? (sh ? null : 'No POSIX shell found to launch the runner') : resolved.reason,
    bin: resolved.bin,
    binFrom: resolved.from || null,
    running: isRunning(),
    adopted: Boolean(external),
    action: external ? external.action : state.action,
    pid: external ? external.pid : (inProcessRunning() ? state.pid : null),
    startedAt: external ? external.startedAt : state.startedAt,
    finishedAt: external ? null : state.finishedAt,
    exitCode: external ? null : state.exitCode,
    signal: external ? null : state.signal,
    logPath: LOG_PATH(),
    actions: Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.label])),
  };
}

// Launch the runner. Returns { ok, status } or { ok:false, code, error } — `code` lets the caller
// pick an HTTP status: EBUSY → 409, ENOBIN → 503, EACTION → 400.
function start(action = 'watch') {
  if (!ACTIONS[action]) {
    return { ok: false, code: 'EACTION', error: `unknown runner action "${action}"` };
  }
  if (isRunning()) {
    return { ok: false, code: 'EBUSY', error: 'a runner is already going — wait for it to finish', status: status() };
  }
  const { bin, reason } = resolveBin();
  const sh = loginShell();
  if (!bin || !sh) return { ok: false, code: 'ENOBIN', error: reason || 'No shell available' };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const logFd = fs.openSync(LOG_PATH(), 'a');
  const startedAt = new Date().toISOString();
  const { prompt } = ACTIONS[action];
  // Assembled from constants only. `bin` is an absolute path we just stat'd; `prompt` is a literal
  // from ACTIONS. No request-controlled text reaches the shell.
  const cmd = `${JSON.stringify(bin)} -p ${JSON.stringify(prompt)} --dangerously-skip-permissions`;
  fs.writeSync(logFd, `\n=== ${action} started ${startedAt} (from the cockpit) ===\n`);

  let child;
  try {
    child = cp.spawn(sh, ['-lc', cmd], {
      cwd: process.env.HOME || undefined,
      env: {
        ...process.env,
        ...Object.fromEntries(FORWARD_ENV
          .filter((k) => process.env[k] !== undefined)
          .map((k) => [k, process.env[k]])),
        // The child is the ledger's writer too — pin it to the dir this server is serving.
        FLOWLEVER_DATA: DATA_DIR,
      },
      detached: true,
      stdio: ['ignore', logFd, logFd],
    });
  } catch (err) {
    fs.closeSync(logFd);
    return { ok: false, code: 'ESPAWN', error: `Could not start the runner: ${err.message}` };
  }

  state.child = child;
  state.action = action;
  state.pid = child.pid;
  state.startedAt = startedAt;
  state.finishedAt = null;
  state.exitCode = null;
  state.signal = null;
  writePidFile(child.pid, action, startedAt);

  child.on('exit', (code, signal) => {
    state.exitCode = code === null ? null : code;
    state.signal = signal || null;
    // A process that exits with neither a code nor a signal would leave isRunning() true forever.
    if (state.exitCode === null && state.signal === null) state.exitCode = -1;
    state.finishedAt = new Date().toISOString();
    clearPidFile();
    try { fs.writeSync(logFd, `=== ${action} exited (code ${code}${signal ? `, signal ${signal}` : ''}) ===\n`); } catch { /* log closed */ }
    try { fs.closeSync(logFd); } catch { /* already closed */ }
  });
  child.on('error', (err) => {
    state.exitCode = -1;
    state.finishedAt = new Date().toISOString();
    clearPidFile();
    try { fs.writeSync(logFd, `=== ${action} failed to start: ${err.message} ===\n`); } catch { /* ignore */ }
  });
  // Don't hold the server's event loop open for the child.
  child.unref();

  return { ok: true, status: status() };
}

// Stop the current run. SIGTERM only — the runner writes to the ledger, so it gets the chance to
// finish the write it is in. A half-done drain is safe: every job is idempotent and re-checked.
// Signal the whole process GROUP, not just the shell. The child is spawned `detached: true`, so it
// leads its own group — and `sh -lc "<cmd>"` only becomes the `claude` process when the shell
// chooses to exec instead of fork, which is profile- and shell-dependent. Signalling `state.pid`
// alone therefore killed the shell and left the `claude` grandchild running on some setups while
// `state` recorded the run as finished, so the next start() spawned a SECOND runner posting the
// same comments. Negative pid = the group. Falls back to the single pid if the group is already gone.
function stop() {
  if (!isRunning()) return { ok: false, code: 'EIDLE', error: 'no runner is going' };
  const external = externalRunner();
  const pid = external ? external.pid : state.pid;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (err) {
    if (err.code === 'EPERM') {
      // Not our process (a recycled pid). Drop the stamp so the runner is usable again rather than
      // wedged behind something we can never signal.
      clearPidFile();
      return { ok: false, code: 'EKILL', error: `The recorded runner pid ${pid} belongs to another `
        + 'user\'s process, so it was not ours to stop. The stale record has been cleared — you can '
        + 'start a runner again.' };
    }
    if (err.code !== 'ESRCH') {
      return { ok: false, code: 'EKILL', error: `Could not stop the runner: ${err.message}` };
    }
    try {
      process.kill(pid, 'SIGTERM');
    } catch (err2) {
      if (err2.code !== 'ESRCH') {
        return { ok: false, code: 'EKILL', error: `Could not stop the runner: ${err2.message}` };
      }
    }
  }
  // An adopted runner has no exit handler here to clear its stamp.
  if (external) clearPidFile();
  return { ok: true, status: status() };
}

module.exports = { ACTIONS, status, start, stop, isRunning, tailLog };
