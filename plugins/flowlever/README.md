# FlowLever

A local **review cockpit** for specifications and pull requests. FlowLever turns spec-readiness
audits and PR reviews into a tracked, repeatable loop: findings are **fingerprinted** so the same
issue keeps the same identity across rounds (new ones surface, fixed ones auto-resolve, and
regressions get caught when a closed issue reappears). You review and decide each finding in a
guided **stepper UI**, export **work orders**, and trigger jobs from the browser that the Claude
session executes.

It bundles a zero-dependency Node app (Node 24, no install) under `app/` plus a set of
`/flowlever:*` skills that drive it via MCP (Confluence, Azure DevOps, Figma).

## Quick start

```
/flowlever:start
```

Boots the dashboard (default **http://localhost:4173**) and starts the watch loop so UI-triggered
jobs run. With no data yet, seed an example with the demo, or run `/flowlever:audit <feature>` to
populate a real one.

## Skills

| Skill | What it does |
| --- | --- |
| `/flowlever:start` | Launch the cockpit dashboard + the UI-job watch loop. |
| `/flowlever:audit <id>` | Fetch a feature's Confluence/ADO/Figma sources (read-only) and run a 7-dimension spec-readiness audit, ingesting fingerprinted findings. |
| `/flowlever:track <id>` | Fast, local-only status read: score, gate, what's open, what moved since the last round. |
| `/flowlever:rework <id>` | Draft fixes for open findings and apply them to the spec/work items — only on explicit confirmation. |
| `/flowlever:brief <id>` | Compose an implementation-ready handoff brief once the readiness gate is green. |
| `/flowlever:watch` | Session-side runner: drain the cockpit's UI request queue (PR reviews, applies). Usually run on a loop. |
| `/flowlever:poll` | Scheduled autopilot pass: discover reviewer PRs + threads on your own PRs, decide review/re-review/skip, enqueue + drain. See [Scheduled autopilot](#scheduled-autopilot-flowleverpoll). |
| `/flowlever:pr-review <prId>` | Load an ADO PR into a `pr-review` workspace, review against spec/ticket, step through findings, post kept comments back. |
| `/flowlever:pr-respond <prId>` | Load reviewer feedback on your PR into a `pr-respond` workspace, draft replies/fixes, post them back. |

## Scheduled autopilot (`/flowlever:poll`)

`/flowlever:poll` turns the cockpit into an unattended PR-review autopilot: one pass discovers the
Azure DevOps PRs where you're a reviewer (plus reviewer threads awaiting you on your own PRs),
decides per PR what to do, enqueues the work on the same queue the UI feeds, and drains it. Run it
manually anytime, or fire it from a scheduler every couple of hours.

**Decision rules** (first match wins): skip drafts/WIP · skip if a request for the PR is already
queued/running · skip if you approved and nothing changed · **re-review** when the author replied
or pushed *after* your posted review (`review.lastPostedAt`) · skip while ingested findings await
your triage · otherwise **new review**. Re-reviews reuse the PR's workspace, so reconciliation
auto-resolves what the author fixed and only the delta surfaces.

**Two review clocks, so you can see when a re-review is due.** Every PR workspace shows the pair
side by side — on its card, its inbox row and its detail header:

| Stamp | Where it comes from |
|---|---|
| **Reviewed** `3h ago` | the workspace's last ingest round (a round *is* a review pass, so it can't drift) |
| **PR updated** `20m ago by Oriol` | `review.lastActivityAt` / `lastActivityBy` — the real Azure DevOps timestamp of the newest update by the *other* side (the author on a `pr-review`, the reviewer on `pr-respond`), recorded by the poll/watch runner |

When the second is newer than the first, the stamp turns blue with a **● new since your review**
badge and the workspace surfaces the prominent **↻ Re-review** action — that's the "you can
re-review now, and it will actually see something" signal. Hover any stamp for the exact time.
(`review.authorRespondedAt` still exists, but it only records when the runner *noticed*; the
activity stamp is the fact worth reading.)

**Don't want to wait for the next pass?** The cockpit has a **↻ Refresh** button on Home and on
both PR sections. It enqueues a `poll` job (scoped to that section) that your `/flowlever:watch`
session picks up and runs immediately: find PRs you have no workspace for, and re-check the known
ones for updates. The button itself is the progress indicator — queued → the live phase → done,
or the reason it failed with a retry. It de-dupes, so a double-click can't fan out two passes, and
like the scheduled pass it never posts anything.

### Running jobs straight from the UI — **▶ Run N jobs**

The queue only moves when a Claude Code session runs `/flowlever:watch`. The cockpit server is a local
process, so it can start that session for you: **▶ Run N jobs** (Home, both PR sections, and inside the
stalled banner on a workspace) spawns exactly the invocation the launchd schedule uses —
`claude -p "/flowlever:watch" --dangerously-skip-permissions` in a login shell — and the existing job
rows then animate queued → running (live phase) → done as it works. While it runs the control becomes
**Runner working… ■ Stop**.

Because this one *writes* to Azure DevOps (unlike Refresh), it asks once — "Run the queued jobs now?
Approved comments get posted" — before starting. Clicking Post was your approval of the *content*; this
confirms you want it to go out now. Details:

- **One at a time.** A second start is refused (409), so a double-click can't fork two sessions posting
  the same comments.
- **Fixed prompts only.** The action must be `watch` or `poll`; the command is built from constants and
  a resolved absolute binary path, never from request data.
- **Binary resolution:** `FLOWLEVER_CLAUDE_BIN` → `~/.local/bin/claude` → `command -v claude` in a login
  shell (a login shell is required — the OAuth token lives in the macOS Keychain). If none is found the
  button says so instead of failing silently.
- **Output** is appended to `~/.flowlever/runner.log` and tailable via `GET /api/runner?log=1`, so a
  headless failure (expired auth, missing MCP) is visible rather than mysterious.
- **↻ Refresh** now also starts a runner when none is going — otherwise it would just queue work nobody
  would do.

### A claimed fix must point at a real commit

**Fix + reply** and **Fix only** promise a code change, so the ledger refuses to mark such an item done
without the sha of the pushed commit carrying it. `finding posted` hard-errors; the runner is told to
either supply `--sha` or `finding cancel` the item. There is no path where a reply says "Fixed" and the
branch doesn't contain the change.

This is a regression guard, not a precaution. It happened: a run replied "Fixed" on two threads of
PR 5751, reported `done` with the phase *"posted to PR + fixes applied"*, and committed nothing — the
reviewer re-raised both points five days later. Replying is the easy half, it succeeded on its own, and
every surface downstream read the reply as completion.

- The runner's apply step is now **fix → push → verify → then speak**: verify the edit is on disk, that
  the sha is on the remote, and that the anchor file *at that sha* contains the change — only then reply
  or resolve the thread, then stamp with `--sha`.
- A landed fix shows a green **`✔ fix <sha>`** chip. One closed as handled with no commit shows a red
  **`⚠ fix not pushed`** chip plus a workspace banner offering to reopen it.
- `node src/cli.js finding unbacked` audits the whole ledger for them; `/flowlever:watch` runs it every
  pass, checks each against the branch, and reopens the ones that genuinely never landed.
- Spec workspaces are exempt (their proof of delivery is `appliedAt`, not a git sha).

**A Post can never silently look done.** Clicking Post in the cockpit writes nothing — the browser can't
reach Azure DevOps. It marks the items **“Posting…”** and queues an `apply` job; only the runner can
confirm a comment landed, by stamping it **Posted — awaiting author**. That means the runner has to be
running, so the cockpit is explicit whenever it isn't:

- a job queued (or claiming to run) for over 3 minutes with **no runner going** reads **⏸ Not running —
  nothing has been posted**, never a spinner, and offers **▶ Run it now**. (With a runner live the same
  job correctly reads "queued for the runner" — it's waiting its turn, not abandoned.)
- a job that reached `done` while items are still “Posting…” reads **finished, but N items not confirmed
  as posted** — a runner's own "done" is not treated as proof;
- both offer **↩ Back to the review queue**, which releases the items (keeping your Approve/Edit
  decisions) so you can Post again. It never pretends anything was written.

Each `/flowlever:watch` pass also heals strays: for any item stuck “Posting…” with no live job it checks
the PR and either stamps it (the comment is there — only the stamp was lost) or releases it.

**Safety:** the pass is ingest-only — it never posts comments, replies, or votes. Posting always
stays behind your explicit **Apply** in the cockpit. Auto-enqueued jobs are tagged
`instructions: "auto ..."` so you can tell them from manual runs.

**Tuning (env):** `FLOWLEVER_ADO_PROJECT` (project to scan), `FLOWLEVER_REVIEWER_EMAIL` (whose
reviews), `FLOWLEVER_POLL_CAP` (max heavy jobs per pass, default 3), `FLOWLEVER_DATA` (ledger dir).
The decision rules themselves live in `skills/poll/SKILL.md`.

**Pause / resume:** `touch ~/.flowlever/poll-pause` makes every pass exit immediately; delete the
file to resume. This pauses the automation without touching the scheduler.

### Scheduling on macOS — use launchd, not cron

Claude Code keeps its OAuth credentials in the macOS Keychain. Plain `cron` runs outside your GUI
login session and cannot unlock the Keychain, so headless `claude -p` fails with
`Not logged in · Please run /login`. A **LaunchAgent** runs inside your login session and works.
`~/Library/LaunchAgents/com.motioncomplex.flowlever.poll.plist` (every 2h, 07–17h; the command
skips weekends):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.motioncomplex.flowlever.poll</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string><string>-lc</string>
    <string>[ "$(date +%u)" -gt 5 ] &amp;&amp; exit 0; echo "=== poll $(date '+%F %T') ==="; FLOWLEVER_ADO_PROJECT=&lt;project&gt; FLOWLEVER_REVIEWER_EMAIL=&lt;you@example.com&gt; $HOME/.local/bin/claude -p "/flowlever:poll" --dangerously-skip-permissions</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>7</integer><key>Minute</key><integer>7</integer></dict>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>7</integer></dict>
    <dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>7</integer></dict>
    <dict><key>Hour</key><integer>13</integer><key>Minute</key><integer>7</integer></dict>
    <dict><key>Hour</key><integer>15</integer><key>Minute</key><integer>7</integer></dict>
    <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>7</integer></dict>
  </array>
  <key>StandardOutPath</key><string>/Users/&lt;you&gt;/.flowlever/poll.log</string>
  <key>StandardErrorPath</key><string>/Users/&lt;you&gt;/.flowlever/poll.log</string>
</dict>
</plist>
```

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.motioncomplex.flowlever.poll.plist  # install
launchctl kickstart gui/$(id -u)/com.motioncomplex.flowlever.poll                               # run a pass NOW (test)
launchctl bootout   gui/$(id -u)/com.motioncomplex.flowlever.poll                               # uninstall
```

Adjust the schedule by editing `StartCalendarInterval` and re-running bootout + bootstrap.
`--dangerously-skip-permissions` is required for unattended runs; it's acceptable here because
the poll pass is ingest-only by design. On Linux, plain cron works (no Keychain).

**Operating it day to day:** a macOS notification arrives only when a pass produced something for
you (findings ready, threads awaiting reply, a job errored/needs input). Install
`terminal-notifier` (`brew install terminal-notifier`) so clicking the notification opens the
cockpit directly (starting its server if needed) — without it the pass falls back to plain
osascript notifications, which open Script Editor when clicked. Or open the cockpit yourself
(`/flowlever:start`) to triage and Apply. The run log is `~/.flowlever/poll.log` — check it if
passes seem silent for too long. The first scheduled ADO fetch may require a one-time 2FA/auth
approval; run `/flowlever:poll` once from an interactive session if the log shows auth errors.

## Friendly hostname (optional): http://flowlever.test

Use the `.test` TLD, not `.local` — macOS routes `.local` lookups to Bonjour/mDNS at the socket
layer, so a `/etc/hosts` entry for it resolves in `dscacheutil` but times out in curl/browsers.

Hostname only (keeps the port, `http://flowlever.test:4173`):

```sh
sudo sh -c 'echo "127.0.0.1 flowlever.test flowlever.localhost" >> /etc/hosts'
```

`flowlever.localhost` rides along as an alias: browsers hardwire `*.localhost` to loopback even
without the hosts entry, but curl and most CLI tools don't — the entry makes it universal.

Hostname **without the port** (`http://flowlever.test`) additionally needs a loopback pf redirect
80 → 4173 and a LaunchDaemon so it survives reboots — macOS still reserves ports <1024 for root.
The pf ruleset must keep Apple's default anchors and slot the `rdr` into the translation block
(rule-order matters):

```
scrub-anchor "com.apple/*"
nat-anchor "com.apple/*"
rdr-anchor "com.apple/*"
rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port 4173
dummynet-anchor "com.apple/*"
anchor "com.apple/*"
load anchor "com.apple" from "/etc/pf.anchors/com.apple"
```

Save as `/etc/pf-flowlever.conf`, apply with `pfctl -f /etc/pf-flowlever.conf && pfctl -e`, and
add a `RunAtLoad` LaunchDaemon running the same two commands for boot persistence. The server
itself needs no change — it binds the wildcard interface and ignores the Host header.

**pf reflection quirk:** if the `rdr` target is the same IP the rule matches (`127.0.0.1` →
`127.0.0.1`), direct connections to the target port (`:4173`) start timing out — replies collide
with the translation state. Fix: redirect to a dedicated loopback alias instead
(`ifconfig lo0 alias 127.94.41.73` + `rdr … -> 127.94.41.73 port 4173`; add the ifconfig to the
LaunchDaemon). The server hears it because it binds the wildcard interface.

**Keep the server up:** the cockpit dies with the session that started it. A user-level
`KeepAlive` LaunchAgent running `node app/src/cli.js start --no-open` (with `FLOWLEVER_DATA` set)
makes `flowlever.test` always-on and restarts the server if it crashes.

## Data location

Ledger state (features, findings, rounds, requests, briefs) lives **per-user** in `~/.flowlever`,
so it's shared across repositories and kept out of the plugin. Override the location with the
`FLOWLEVER_DATA` environment variable — every skill honors it.

## The bundled app

The cockpit app lives under `app/` (`app/src/cli.js`, `app/src/server.js`, `app/web/`, with
`app/docs/SCHEMA.md` and `app/docs/ARCHITECTURE.md` documenting the schema and design). Skills
invoke it via `${CLAUDE_PLUGIN_ROOT}/app/src/cli.js`. Run its tests with `cd app && node --test`.
