---
name: create-swarm
description: >-
  Set up and orchestrate a team of Claude Code agents in CMUX. The current session
  becomes the orchestrator and spawns N−1 worker panes that take dispatched tasks.
  Use when the user says "create a swarm", "spin up a swarm", "start an agent team",
  "parallelize this across agents", "run these tasks with multiple agents", or
  "orchestrate workers in cmux". Encodes the concrete cmux patterns (spawn, lazy-PTY,
  brief-file dispatch, commit/footer monitoring, git-worktree isolation, per-worker
  browser) so a swarm runs deterministically.
compatibility: "macOS + the cmux app (auto-installable via the /cmux-swarm:cmux-bootstrap command). Workers run `claude --dangerously-skip-permissions`, so use only on repos/tasks you trust. Pairs with the sibling plugin skills /cmux-swarm:code-check (filtered checks) and /cmux-swarm:visual-check (filtered browser checks) — dispatch those to workers. All cmux primitives live in swarm.sh inside this plugin."
---

# Create Swarm

Turn the current Claude Code session into the **orchestrator** of a CMUX agent team. You
spawn worker sessions (`W1…Wn`), dispatch tasks to them via brief files, monitor them, and
merge their work back. The user talks mainly to you, but can also talk to any worker directly.

**CMUX object model:** `window → workspace → pane → surface`. Each worker is its own
**workspace** (tab) named `🤖 W<n>` running one `claude` session; you address its terminal
by `--workspace <ws> --surface <surf>`.

**The helper does the mechanics.** `swarm.sh` (bundled in this plugin at
`${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh`) implements every cmux primitive below.
Call it; don't re-derive the commands each run. `swarm.sh help` lists subcommands.
(`${CLAUDE_PLUGIN_ROOT}` is substituted to the plugin's install dir at runtime.)

---

## Step 1 — How many agents?

Ask the user the team size. **Default 3** = 1 orchestrator (this session) + 2 workers
(`W1`, `W2`). Use the AskUserQuestion tool with options like `2 (1+1)`, `3 (1+2,
recommended)`, `4 (1+3)`, `5 (1+4)`. The worker count is `N − 1`.

Also clarify, if not obvious:
- **Same repo or separate?** If multiple workers will **edit the same working tree**, you
  need **git worktrees** (Step 5). Read-only/analysis workers don't.
- **Target repo** for the workers (defaults to the orchestrator's cwd).

## Step 2 — Bootstrap cmux (install-if-missing)

Run the bundled command **`/cmux-swarm:cmux-bootstrap`** — it detects cmux and, if missing,
offers to `brew install --cask cmux` (or prints the download link). Equivalent direct calls:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" check-cmux     # prints path, or MISSING
```

- **Present** → continue silently.
- **MISSING** → ask the user whether to install. On yes:
  `bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" install-cmux` (runs `brew install --cask cmux`).
  If Homebrew is absent, the helper prints the download link instead — relay it and stop.

This skill only runs **inside** a cmux session (the orchestrator must itself be a cmux
workspace). If `check-cmux` is MISSING you cannot be running in cmux — install, then have the
user relaunch Claude inside cmux.

## Step 3 — Spawn the workers

For each worker `n` in `1..N-1`:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" spawn <n> <repo>
# → WORKSPACE=workspace:<k>
#   SURFACE=surface:<m>
```

`spawn` does three things you must not skip:
1. `cmux new-workspace --name "🤖 W<n>" --cwd <repo> --command "<claude> --dangerously-skip-permissions" --focus false` — creates the tab and launches Claude in it. (The helper finds the claude binary; on this machine `/Users/elias/.local/bin/claude`.)
2. **Forces the PTY** with `cmux select-workspace --workspace <ws>` **once**. A freshly created workspace does **not** attach a PTY until rendered — skip this and `read-screen` returns *"Terminal surface not found"*.
3. Resolves and prints the `WORKSPACE`/`SURFACE` refs (by matching the unique `🤖 W<n>` name). **Record these per worker** — every later call needs them.

Lost the refs later? `swarm.sh refs <n>` re-resolves them. To see the whole tree:
`cmux tree` / `cmux list-workspaces`.

Give each worker a moment to finish booting Claude, then proceed.

## Step 4 — Dispatch tasks (brief files, not pasted prompts)

**Always dispatch via a brief file.** Pasting a long multi-line prompt straight into a pane
auto-submits early (newlines trigger send). Instead:

1. Write the full task to `/tmp/<task-id>.md` (scope, files, acceptance criteria, and the
   exact done-marker you want — see monitoring).
2. Dispatch a short pointer:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" dispatch <ws> <surf> /tmp/<task-id>.md "<one-line gist>"
# sends:  "Read /tmp/<task-id>.md in full and execute. <one-line gist>"  then Enter
```

3. Label the tab so the team is legible at a glance:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" rename <ws> <surf> "W1 · <current task>"
```

Update the label whenever the worker's task changes.

**Between tasks**, reset the worker's context: `swarm.sh reset <ws> <surf>` (sends `/clear`).

**Raw input / control keys** when you need them: `swarm.sh send <ws> <surf> "<text>"` (text +
Enter). Bare keys via `cmux send-key --workspace <ws> --surface <surf> <key>` where `<key>` ∈
`enter | escape | ctrl+c | ctrl+u` (e.g. `ctrl+c` to interrupt a stuck worker, `escape` to
dismiss a menu).

## Step 5 — Parallel edits → git worktrees

If two or more workers will edit the **same repo**, give each its own worktree so they don't
clobber each other's working tree:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" worktree <repo> <branch> <sibling-dir> <base>
# git worktree add -b <branch> <sibling-dir> <base>; symlinks node_modules; copies .env*
```

Then spawn that worker with `<repo>` = its `<sibling-dir>`, and tell it (in the brief) to use
**absolute paths**, stay inside its worktree, and commit to **its** branch. Merge the branches
back when each unit lands. **If you are NOT using worktrees, enforce one editor per working
tree at a time** — never let two workers write the same checkout concurrently.

## Step 6 — Monitor (most robust → least)

Use the strongest signal the task affords:

1. **Commit-aware (best for code tasks).** Arm before dispatch, then wait:
   ```bash
   SHA=$(bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" head <repo>)
   # ... dispatch ...
   bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" wait-commit <repo> "$SHA" 1800   # prints new sha
   ```
   A new commit = the worker finished a unit of work.

2. **Footer markers.** `swarm.sh status <ws> <surf>` → `WORKING` (`esc to interrupt` present)
   / `IDLE` (`← for agents` present) / `UNKNOWN`. Use `wait-idle <ws> <surf> [timeout]` — it
   **re-checks after 6s** before declaring idle, because a single idle frame is flaky while
   output is still streaming.

3. **Anchored markers.** Have the brief end the worker with `DONE: <task-id>` or
   `BLOCKED: <task-id>`, then `swarm.sh read <ws> <surf>` and grep. **Anchor to a unique
   phrase** (`DONE: <task-id>`, not bare `DONE:`) — a bare `DONE:` echoes back from the
   dispatched prompt text and gives false positives.

Read a worker's screen any time: `swarm.sh read <ws> <surf> [lines]`.

## Step 7 — Visual checks: one browser per worker

If a worker does a browser/visual check, it must launch its **own isolated headed browser**
(Playwright with a unique temp `user-data-dir`) — **never** a single shared browser or shared
MCP browser, which locks across concurrent agents. The `/cmux-swarm:visual-check` skill
already does this; instruct workers to use it rather than a shared session.

## Step 8 — Wind down

When the work lands: merge worktree branches, `swarm.sh reset` idle workers for reuse, or
`cmux close-workspace --workspace <ws>` to retire a worker. Summarize what each worker
produced (commits/branches) back to the user.

---

## Quick reference

| Goal | Command |
|---|---|
| Is cmux installed? | `swarm.sh check-cmux` |
| Install cmux | `swarm.sh install-cmux` |
| Spawn worker n | `swarm.sh spawn <n> <repo>` → `WORKSPACE`/`SURFACE` |
| Re-find worker n's refs | `swarm.sh refs <n>` |
| Relabel tab | `swarm.sh rename <ws> <surf> "W1 · task"` |
| Dispatch a brief | `swarm.sh dispatch <ws> <surf> /tmp/x.md "gist"` |
| Raw send + Enter | `swarm.sh send <ws> <surf> "text"` |
| Reset context | `swarm.sh reset <ws> <surf>` |
| Read screen | `swarm.sh read <ws> <surf> [lines]` |
| Working or idle? | `swarm.sh status <ws> <surf>` |
| Wait until idle | `swarm.sh wait-idle <ws> <surf> [timeout]` |
| Wait for a commit | `SHA=$(swarm.sh head <repo>); swarm.sh wait-commit <repo> "$SHA"` |
| Isolate parallel edits | `swarm.sh worktree <repo> <branch> <dir> <base>` |
| See the team | `cmux tree` / `cmux list-workspaces` |
| Interrupt a worker | `cmux send-key --workspace <ws> --surface <surf> ctrl+c` |
| Retire a worker | `cmux close-workspace --workspace <ws>` |

## Pitfalls

- **Skipping the PTY force.** No `select-workspace` after `new-workspace` → `read-screen` says
  *"Terminal surface not found"*. `spawn` does it for you; don't bypass it.
- **Pasting long prompts.** Multi-line paste auto-submits early. Always use brief files + a
  short pointer (`dispatch`).
- **Bare `DONE:` markers.** They echo from the dispatched prompt → false "done". Anchor to a
  unique task id.
- **Two workers, one working tree.** Race → clobbered edits. Worktrees, or one-editor-at-a-time.
- **Shared browser across workers.** Profile lock / crashes. One headed browser + unique
  `user-data-dir` per worker.
- **Trusting a single idle frame.** Output streams in bursts; require idle to persist
  (`wait-idle` handles this).

## When NOT to use this

A single task that fits one session — just do it. The swarm pays off when there's genuinely
parallel, separable work (independent files, independent checks, independent repos).
