---
name: poll
description: >
  The scheduled autopilot pass for PR reviews. Discovers Azure DevOps PRs where you are a reviewer
  (plus reviewer threads on your own PRs), decides per PR whether to review, re-review, or skip —
  aware of reviews you triggered manually — enqueues the work on the cockpit queue, then drains it
  like /flowlever:watch. Ingest-only: it NEVER posts to a PR (posting stays behind your explicit
  Apply). Use when the user says "/flowlever:poll", "run the review poller", "check my PRs for
  reviews", or from a scheduler (cron/launchd running `claude -p "/flowlever:poll"`).
---

# /flowlever:poll — scheduled PR-review autopilot pass

One pass = discover → decide → enqueue → drain → notify. Designed to be fired every ~2h by an
external scheduler running headless `claude -p "/flowlever:poll"` — on macOS that MUST be a
launchd LaunchAgent, not cron (cron runs outside the GUI session, can't unlock the Keychain, and
`claude` fails with "Not logged in"; see the plugin README's "Scheduled autopilot" section for the
plist). Running it manually does exactly the same thing. Everything it queues lands in the same cockpit queue and workspaces
as manual `/flowlever:pr-review` runs, so manual and scheduled work can never fork or collide.

**Hard rule: this pass is ingest-only.** It reviews into draft findings in the cockpit. It never
posts comments, never replies, never votes, never touches the PR. `apply` requests are never
enqueued by this skill — only the user does that from the UI.

## Config (env, all optional)
- `FLOWLEVER_DATA` — ledger dir, default `~/.flowlever` (same as every other skill).
- `FLOWLEVER_ADO_PROJECT` — ADO project to scan (e.g. `dxp`). No value → derive from the current
  repo's git remote; if neither exists, say so and stop.
- `FLOWLEVER_REVIEWER_EMAIL` — whose PRs/reviews to scan. No value → `git config user.email`,
  else the authenticated ADO identity.
- `FLOWLEVER_POLL_CAP` — max heavy jobs (review/re-review/respond ingests) per pass, default `3`.
  Anything over the cap simply waits for the next pass — never silently dropped: log what was
  deferred.

## 0. Pause + stop checks (before anything else)
- If `${FLOWLEVER_DATA:-$HOME/.flowlever}/poll-pause` exists: say "poll paused (remove
  poll-pause to resume)" and STOP. (`touch ~/.flowlever/poll-pause` = pause the automation
  without touching the scheduler.)
- Keep the whole pass read-only toward ADO; local ledger writes only.

## 1. Discover (ADO MCP — load via ToolSearch)
Resolve the reviewer identity (email above → `core_get_identity_ids`). Then list **active** PRs
in the project (prefer a project-level PR listing; fall back to iterating repositories if the
tool requires a repository):
- **Set A — PRs where I am a reviewer** (any repo, status active).
- **Set B — PRs I created** (status active) → for the pr-respond mirror.

Also load ledger state once:
```
FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature list --json
FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" requests list --json
```
A PR's workspace is any feature whose id starts with `pr-<prId>-` (kind `pr-review` for set A,
`pr-respond` for set B).

## 2. Decide per PR in set A (reviewer PRs)
Apply in order — first match wins:
1. **Skip: draft/WIP.** `isDraft` or title matches `\bWIP\b`i → skip ("draft").
2. **Skip: already queued/running.** A `pr-review` request for this `prId` is queued or running
   (manual or previous pass — this is the manual-trigger awareness for in-flight runs; the
   `--dedupe` flag below double-guards it) → skip.
3. **Skip: I approved, nothing new.** My reviewer vote on the PR is Approved (10) or
   Approved-with-suggestions (5) → skip ("approved"). (Votes reset on new pushes under the usual
   policy, so a new iteration clears this skip by itself.)
4. **Re-review: author responded after my posted review.** Workspace exists AND
   `review.lastPostedAt` is set: check for activity **since `lastPostedAt`** by anyone other
   than me — new iteration/commits pushed, or author replies on threads. If found and
   `review.authorRespondedAt` is not already handled, flag + enqueue:
   ```
   ... cli.js feature activity <wsId> --responded --note "<e.g. 2 new replies · 1 new iteration>"
   ... cli.js requests add --action pr-review --prId <prId> --wsId <wsId> --dedupe \
         --title "<PR title>" --instructions "auto re-review: author responded after posted review"
   ```
   (Passing `--wsId` makes the adapter reuse exactly that workspace; reconciliation auto-resolves
   the findings the author addressed and surfaces only the delta.)
5. **Skip: review in progress.** Workspace exists but nothing posted yet (`review.lastPostedAt`
   null) → a review (manual or scheduled) is already ingested and being triaged; don't stack a
   new round on top of the user's in-progress decisions → skip ("awaiting your triage").
6. **New review: no workspace.** Enqueue:
   ```
   ... cli.js requests add --action pr-review --prId <prId> --dedupe \
         --title "<PR title>" --instructions "auto review (scheduled poll)"
   ```
Always tag auto-enqueued requests via `--instructions "auto ..."` — that's how the cockpit (and
you) tell scheduled runs from manual ones.

**Cap:** order candidate enqueues oldest-PR-first, enqueue at most `FLOWLEVER_POLL_CAP` heavy
jobs per pass (re-reviews count; step-4 `feature activity` flags do NOT — always flag). Log
"deferred to next pass: PR x, PR y".

## 3. Mirror for set B (my own PRs → pr-respond)
For each PR I created: count **threads awaiting my reply** (active threads whose latest comment
is not mine, same filter as `/flowlever:pr-respond`). If > 0 and either (a) no `pr-respond`
workspace exists for the PR, or (b) new such thread activity happened after the workspace's last
round → enqueue (counts toward the cap):
```
... cli.js requests add --action pr-respond --prId <prId> --dedupe \
      --title "<PR title>" --instructions "auto: <n> thread(s) awaiting your reply"
```

## 4. Housekeeping (auto-archive)
For each `pr-review`/`pr-respond` workspace whose PR is now **completed or abandoned**: set the
workspace status to `done` (small node script: `require("${CLAUDE_PLUGIN_ROOT}/app/src/ledger.js")`
→ `setFeatureStatus(wsId, 'done')`). Mention what was archived.

## 5. Drain the queue
Execute the queued requests exactly as **`/flowlever:watch`** does (read that skill and follow
its "Each pass" procedure, including per-request `--phase` updates and `needsInput` flagging
before the first auth-prone ADO call). The adapters (`/flowlever:pr-review`, `/flowlever:pr-respond`)
do the actual fetching + reviewing + ingest. Skip watch's own author-activity step — step 2.4
above already covered it.

## 6. Notify + summarize
After the drain, if anything actionable came out of this pass, send ONE notification. Prefer the
PushNotification tool when available; otherwise:
```
osascript -e 'display notification "PR 1481: 5 findings ready · PR 1490: 3 threads await you" with title "FlowLever" sound name "Glass"'
```
Notify only for: new/changed draft findings ready to triage, pr-respond threads prepared, a
request that ended `error` or is stuck `needsInput`. A pass where everything was skipped or
nothing changed sends NOTHING (quiet passes must stay silent — that's what makes the
notification worth reading).

End with a compact summary (this is the headless log line): reviewed / re-reviewed / prepared /
skipped-with-reason / deferred / archived.
