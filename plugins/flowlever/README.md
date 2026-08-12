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

## Data location

Ledger state (features, findings, rounds, requests, briefs) lives **per-user** in `~/.flowlever`,
so it's shared across repositories and kept out of the plugin. Override the location with the
`FLOWLEVER_DATA` environment variable — every skill honors it.

## The bundled app

The cockpit app lives under `app/` (`app/src/cli.js`, `app/src/server.js`, `app/web/`, with
`app/docs/SCHEMA.md` and `app/docs/ARCHITECTURE.md` documenting the schema and design). Skills
invoke it via `${CLAUDE_PLUGIN_ROOT}/app/src/cli.js`. Run its tests with `cd app && node --test`.
