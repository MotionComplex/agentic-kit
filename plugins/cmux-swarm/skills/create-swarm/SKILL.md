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
spawn worker sessions (`W0…W<n>`), dispatch tasks to them via brief files, monitor them, and
merge their work back. The user talks mainly to you, but can also talk to any worker directly.

**Naming scheme:** the team's workspace is named after a **constellation** — `🐙 Team Orion`,
`🐙 Team Cygnus`, `🐙 Team Lyra`, … (first free name from the `TEAM_NAMES` list in `swarm.sh`) —
the orchestrator's tab is `🧠 Orchestrator`, worker tabs are `🤖 W0`, `🤖 W1`, … (0-based).

**CMUX object model:** `window → workspace → pane → surface`. Each worker is one `claude`
session named `🤖 W<n>`, in one of two layouts (you address its terminal by
`--workspace <ws> --surface <surf>` either way):

- **Split view (default):** every worker is a **pane in the orchestrator's own workspace** —
  orchestrator left, workers stacked in a column on the right. The whole team is visible at
  once. Best for ≤ 4 workers; beyond that the panes get cramped.
- **Tabs:** every worker is its own **workspace** (tab). Use for big teams or when the user
  prefers tabs.

**The helper does the mechanics.** `swarm.sh` (bundled in this plugin at
`${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh`) implements every cmux primitive below.
Call it; don't re-derive the commands each run. `swarm.sh help` lists subcommands.
(`${CLAUDE_PLUGIN_ROOT}` is substituted to the plugin's install dir at runtime.)

---

## Step 1 — How many agents?

Ask the user the team size. **Default 3** = 1 orchestrator (this session) + 2 workers
(`W0`, `W1`). Use the AskUserQuestion tool with options like `3 (1+2, recommended)`,
`4 (1+3)`, `5 (1+4)`, `Dynamic (scale on demand)`. A fixed worker count is `N − 1`,
numbered `W0…W<N-2>`; **Dynamic** spawns workers lazily as tasks demand (see below).

Also clarify, if not obvious:
- **Layout?** Default to **split view** for ≤ 4 workers (everything in one workspace);
  offer **tabs** for larger teams or if the user prefers them. Fold this into the same
  AskUserQuestion (second question) rather than asking twice.
- **Same repo or separate?** If multiple workers will **edit the same working tree**, you
  need **git worktrees** (Step 5). Read-only/analysis workers don't.
- **Target repo** for the workers (defaults to the orchestrator's cwd).

### Dynamic mode (scale on demand)

If the user picked **Dynamic**, don't pre-spawn a fixed team in Step 3 — spawn lazily:

- **Start with zero workers** (or one, if a task is already queued). Whenever a
  dispatchable task exists and no worker is `IDLE`, spawn the next worker.
- **Reuse before spawning.** Check existing workers with `swarm.sh status` — if one is
  idle, `swarm.sh reset` it and dispatch there instead of growing the team.
- **Keep a monotonic index counter.** The next worker is always `W<next>`; never reuse a
  retired worker's number, so labels and `refs <n>` stay unambiguous.
- **Cap the team.** Default max **4 workers**; ask the user before spawning beyond it.
- **Layout:** split view is fine while the team stays ≤ 4 — record each new worker's
  `PANE` so the next `spawn-split` can anchor below it. If the team may grow beyond 4,
  prefer tabs.
- **Scale down.** When the task queue empties, retire workers that stay idle (Step 8);
  keep one warm if more work is likely.

Everything else (bootstrap, spawn mechanics, dispatch, worktrees, monitoring) is
identical — dynamic mode only changes *when* you spawn and retire. The status dashboard
(Step 3.5) is especially useful here: it shows joins, retirements, and idle workers live.

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

(In **dynamic mode**, run the spawn steps below per worker at the moment a task needs
one, not all upfront — the mechanics are the same.)

First, label this session as the team's brain — its **tab** becomes `🧠 Orchestrator` and
its **workspace** becomes `🐙 Team <constellation>` (first free name from `TEAM_NAMES`; idempotent):

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" name-orchestrator
```

### Split view (default)

Spawn W0 with no anchor (it splits **right** of the orchestrator), then chain each further
worker below the previous one by passing the previous worker's `PANE` ref as the anchor:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" spawn-split 0 <repo>
# → WORKSPACE=workspace:<k>   (the orchestrator's own workspace)
#   SURFACE=surface:<m>
#   PANE=pane:<p>
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" spawn-split 1 <repo> pane:<p>   # below W0
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" spawn-split 2 <repo> <W1's PANE> # below W1
```

**Spawn sequentially, not in parallel** — each call needs the previous worker's `PANE` ref,
and concurrent moves race on the layout. Under the hood `spawn-split` stages each worker in a
hidden temp workspace (`new-pane` can't take `--cwd`/`--command`; `new-workspace` can), moves
the surface into the orchestrator's workspace, splits it off, closes the empty shell, and
waits for the PTY to attach (it attaches when the pane first renders).

### Tabs

For each worker `n` in `0..N-2`:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" spawn <n> <repo>
# → WORKSPACE=workspace:<k>
#   SURFACE=surface:<m>
```

`spawn` does three things you must not skip:
1. `cmux new-workspace --name "🤖 W<n>" --cwd <repo> --command "<claude> --dangerously-skip-permissions" --focus false` — creates the tab and launches Claude in it. (The helper finds the claude binary; on this machine `/Users/elias/.local/bin/claude`.)
2. **Forces the PTY** with `cmux select-workspace --workspace <ws>` **once**. A freshly created workspace does **not** attach a PTY until rendered — skip this and `read-screen` returns *"Terminal surface not found"*.
3. Resolves and prints the `WORKSPACE`/`SURFACE` refs (by matching the unique `🤖 W<n>` name).

### Both layouts

**Record the printed refs per worker** — every later call needs them. Lost them? `swarm.sh
refs <n>` re-resolves both layouts (in split view it scans the tree for the `🤖 W<n>` tab
label, which Claude may overwrite while working — so recording at spawn time is the reliable
path). To see the whole tree: `cmux tree` / `cmux list-workspaces`.

Give each worker a moment to finish booting Claude, then proceed.

## Step 3.5 — Sticky status dashboard (optional, recommended)

Give the team a live overview: a thin self-refreshing pane pinned **above the
orchestrator's own pane**, one line per worker:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" spawn-dashboard        # 5s refresh
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" spawn-dashboard 3     # custom interval
```

```
 ╭─ 🐙 Team Orion ─────────────────────────────────── agentic-kit@main · busy 1/2 · queue 2/5 ─╮
 │                                                                                             │
 │         TASK                          WORKTREE        PORT    NETWORK         COMMIT    AGE │
 │ W0   ⠧  fix-auth                      agentic-kit     :5173   192.168.1.7:5173    +2     4m │
 │ W1   ✓  -                             agentic-kit-w1  :5174   -                    -      - │
 ╰─────────────────────────────────────────────────────────────────────────────────────────────╯
```

Per worker: state (animated ⠧ spinner = working, green ✓ = idle, dim ? = unknown,
red ✖ = gone), current task (the dispatch gist — bright while working, dim once idle),
worktree/repo basename, the worker's **dev server** (`PORT` = listening port(s), `+`
when more than one; `NETWORK` = the LAN `ip:port` in green when the server is bound on
all interfaces — open that URL on a phone on the same network), commits landed since
dispatch (`+n`, green when > 0), and time since dispatch. PORT/NETWORK are auto-detected
each refresh via `lsof` (listening TCP servers whose process cwd is inside the worker's
worktree) — nothing to report manually. The header shows the team name (bold), the team
repo with its **current branch**, the busy count, and — if you report it — queue progress:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" queue <done> <total>   # update header counter
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" queue clear            # remove it again
```

The queue counter is **orchestrator-reported**: it only changes when you call `queue`,
so update it as tasks complete and `queue clear` it when the batch is done.

How it behaves:
- **Data comes from the team state file** (`/tmp/cmux-swarm-<ws>.state`), which `spawn`,
  `spawn-split`, `dispatch`, `reset`, and `retire` maintain automatically — workers
  spawned **without** swarm.sh won't appear.
- **Height is dynamic**: the pane auto-fits to its content every refresh (cmux's minimum
  pane height applies, ~6 rows). New workers appear and grow the pane on the next
  refresh; retired ones drop off. Disable auto-fit with `spawn-dashboard <interval> 0`.
- Retire workers via `swarm.sh retire <ws> <surf>` (instead of raw `close-surface` /
  `close-workspace`) so the dashboard stays in sync.
- Works in both layouts; run `name-orchestrator` first so the header shows the team
  name and the team repo (it records the orchestrator's cwd for the `repo@branch` part).
- Worker data refreshes once per interval; the spinner animates at 4 fps in between.

## Step 4 — Dispatch tasks (brief files, not pasted prompts)

**Always dispatch via a brief file.** Pasting a long multi-line prompt straight into a pane
auto-submits early (newlines trigger send). Instead:

1. Write the full task to `/tmp/<task-id>.md` (scope, files, acceptance criteria, and the
   exact done-marker you want — see monitoring). If the task touches UI, include the
   **dev-server rules** from Step 7 verbatim (LAN-exposed, leave running after verification).
2. Dispatch a short pointer:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" dispatch <ws> <surf> /tmp/<task-id>.md "<one-line gist>"
# sends:  "Read /tmp/<task-id>.md in full and execute. <one-line gist>"  then Enter
```

3. Label the tab so the team is legible at a glance:

```bash
bash "${CLAUDE_PLUGIN_ROOT}/skills/create-swarm/swarm.sh" rename <ws> <surf> "🤖 W0 · <current task>"
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

### Dev-server rules (put these in every UI-touching brief)

1. **Expose the dev server on the network**, not just localhost — start it bound on all
   interfaces (e.g. `npm run dev -- --host 0.0.0.0`; Vite: `--host`, Next.js: `-H 0.0.0.0`,
   Astro/Nuxt: `--host`) and pick a **unique port per worker** (e.g. `517<n>` for W`<n>`)
   so parallel workers don't collide. The user verifies changes on real mobile devices on
   the same network; an exposed server shows up green in the dashboard's NETWORK column.
2. **Leave the dev server running after verification.** When a worker finishes its work and
   checks pass, it must **not** kill the dev server — the user manually verifies any visual
   change (desktop and mobile) against the still-running server. Report the local and
   network URLs in the completion message. Servers are only shut down at wind-down
   (Step 8), or when the orchestrator explicitly says so.

## Step 8 — Wind down

When the work lands: merge worktree branches, `swarm.sh reset` idle workers for reuse, or
retire a worker — `swarm.sh retire <ws> <surf>` (handles both layouts and keeps the
dashboard in sync). Summarize what each worker produced (commits/branches) back to the user.
Dev servers left running for manual verification (Step 7) are stopped **only now**, after
the user confirms they're done checking — never as part of a worker's own task completion.

---

## Quick reference

| Goal | Command |
|---|---|
| Is cmux installed? | `swarm.sh check-cmux` |
| Install cmux | `swarm.sh install-cmux` |
| Label this session | `swarm.sh name-orchestrator` → 🧠 Orchestrator tab + 🐙 Team <constellation> workspace |
| Spawn worker (split view) | `swarm.sh spawn-split <n> <repo> [anchor-pane]` → `WORKSPACE`/`SURFACE`/`PANE` |
| Spawn worker (tab) | `swarm.sh spawn <n> <repo>` → `WORKSPACE`/`SURFACE` |
| Re-find worker n's refs | `swarm.sh refs <n>` |
| Relabel tab | `swarm.sh rename <ws> <surf> "🤖 W0 · task"` |
| Dispatch a brief | `swarm.sh dispatch <ws> <surf> /tmp/x.md "gist"` |
| Raw send + Enter | `swarm.sh send <ws> <surf> "text"` |
| Reset context | `swarm.sh reset <ws> <surf>` |
| Read screen | `swarm.sh read <ws> <surf> [lines]` |
| Working or idle? | `swarm.sh status <ws> <surf>` |
| Wait until idle | `swarm.sh wait-idle <ws> <surf> [timeout]` |
| Wait for a commit | `SHA=$(swarm.sh head <repo>); swarm.sh wait-commit <repo> "$SHA"` |
| Isolate parallel edits | `swarm.sh worktree <repo> <branch> <dir> <base>` |
| Sticky status pane | `swarm.sh spawn-dashboard [interval] [autofit 1\|0]` |
| Report queue progress | `swarm.sh queue <done> <total>` |
| See the team | `cmux tree` / `cmux list-workspaces` |
| Interrupt a worker | `cmux send-key --workspace <ws> --surface <surf> ctrl+c` |
| Retire a worker (either layout) | `swarm.sh retire <ws> <surf>` |

## Pitfalls

- **Skipping the PTY force.** No `select-workspace` after `new-workspace` → `read-screen` says
  *"Terminal surface not found"*. `spawn`/`spawn-split` handle it for you; don't bypass them.
- **Parallel `spawn-split` calls.** Each split anchors on the previous worker's pane and
  concurrent layout moves race. Spawn split-view workers one at a time, in order.
- **Pasting long prompts.** Multi-line paste auto-submits early. Always use brief files + a
  short pointer (`dispatch`).
- **Bare `DONE:` markers.** They echo from the dispatched prompt → false "done". Anchor to a
  unique task id.
- **Two workers, one working tree.** Race → clobbered edits. Worktrees, or one-editor-at-a-time.
- **Shared browser across workers.** Profile lock / crashes. One headed browser + unique
  `user-data-dir` per worker.
- **Trusting a single idle frame.** Output streams in bursts; require idle to persist
  (`wait-idle` handles this).
- **Workers killing their dev server on completion.** The user verifies visual changes
  manually (including on phones via the NETWORK column URL) — briefs must say *leave the
  server running, bound on all interfaces* (Step 7), or the dashboard goes dark the moment
  the worker finishes.

## When NOT to use this

A single task that fits one session — just do it. The swarm pays off when there's genuinely
parallel, separable work (independent files, independent checks, independent repos).
