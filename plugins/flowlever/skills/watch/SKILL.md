---
name: watch
description: >
  The session-side runner for FlowLever's UI-triggered jobs. Polls the cockpit's request queue and
  executes each queued request — starting a PR review/respond from a PR id, or posting reviewed
  decisions back — by delegating to the matching /flowlever:* adapter. Use when the user says
  "/flowlever:watch", "watch the cockpit", "run the flowlever runner", or sets it on a loop
  ("/loop /flowlever:watch"). This is what lets the user kick off PR reviews from the web UI.
---

# /flowlever:watch — run UI-triggered cockpit jobs

The browser can't reach Confluence/ADO (MCP), so when the user enqueues a job from the UI (e.g. "+ New PR
review"), THIS skill — running in the Claude session — picks it up and executes it. Typically run on a
loop: **`/loop /flowlever:watch`** (or a longer interval). One pass = drain the currently-queued requests.

## Each pass
Run (self-contained — app at `${CLAUDE_PLUGIN_ROOT}/app`, data in `~/.flowlever`):

0. **Stop check.** If `${FLOWLEVER_DATA:-$HOME/.flowlever}/.watch-stop` exists, delete it, say "watch loop
   stopped", and **end the loop — do NOT reschedule another pass.** (`/flowlever:stop` drops this sentinel.)
   Otherwise continue:
1. **Read the queue:** `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" requests list --status queued --json`. If empty, say "no queued
   requests" and stop (the loop will check again).
2. **For each request** (oldest first), mark it running, then dispatch by `action` — and on completion
   mark it `done` (or `error` with a short note):
   ```
   FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" requests set <reqId> --status running --phase "starting"
   ```
   - **`pr-review`** (has `prId`): run the **`/flowlever:pr-review <prId>`** procedure — create/locate the
     `pr-review` workspace, fetch + review, ingest findings. On success:
     `requests set <reqId> --status done --phase "review ready" --wsId <workspaceId>` (so the UI links the request to the workspace).
   - **`pr-respond`** (has `prId`): run **`/flowlever:pr-respond <prId>`** — create the `pr-respond` workspace,
     fetch threads, ingest. Then `requests set <reqId> --status done --phase "threads ready" --wsId <workspaceId>`.
   - **`audit`** — two shapes, branch on `wsId`:
     - **No `wsId`** (source URLs are in `instructions`): start a NEW spec analysis. Run
       **`/flowlever:audit`** — parse the Confluence / ADO / Figma URLs (and any focus) from `instructions`,
       derive a kebab `featureId` (from the request `title` or the spec page title), create the `spec`
       workspace, register the sources, run the sweep, and ingest. On success:
       `requests set <reqId> --status done --phase "audit ready" --wsId <newWorkspaceId>`.
     - **Has `wsId`** (the cockpit's "↻ Re-audit" button on an applied spec): **full re-audit of that
       existing workspace.** Run **`/flowlever:audit <wsId>`** (NOT scoped mode) — re-fetch its already-
       registered sources, run the full sweep, and ingest into the SAME workspace. Reconciliation
       auto-resolves the findings the spec now reflects (the applied ones), keeps any still-open, and
       flags regressions. On success: `requests set <reqId> --status done --phase "re-audited" --wsId <wsId>`.

   **Pass the request's `instructions` to the adapter.** Each queued request may carry an `instructions`
   string (visible in `requests list --json`) — the user's free-text scope/focus for THIS run (e.g.
   "front-end only", "focus on the import validation"). When present, hand it to the `pr-review` /
   `pr-respond` procedure as the **review scope**: the adapter restricts/prioritizes accordingly AND copies
   it onto the created workspace as `feature.reviewBrief` (so the cockpit shows the applied scope). Apply
   requests inherit the scope already recorded on the workspace — no extra handling needed.
   - **`apply`** (has `wsId`): run the **Apply** step for that workspace's `kind`, reading the user's
     decisions from the ledger — **branch on kind** (check `feature list --json` / the feature file):
     - `pr-review` / `pr-respond` → post inline comments / replies back to the PR
       (`/flowlever:pr-review` / `/flowlever:pr-respond` Apply step). Then `--phase "posted to PR"`.
     - `spec` → run **`/flowlever:apply-spec <wsId>`**: write the accepted change proposals back to ADO
       work-item fields / Confluence sections **surgically** (patch one node, never regenerate the page).
       Then `--phase "applied to spec"`.
     On success: `requests set <reqId> --status done --phase "<as above>"`.
   - **`re-audit`** (has `wsId`): the user **Rejected a proposal with a counter**. Run
     **`/flowlever:audit <wsId>` in Scoped re-audit mode** (see that skill) — re-evaluate ONLY the
     findings whose `draft.review.verdict === "redirect"`, honoring each one's counter `note` (and the
     request `instructions`), and re-draft or waive them. Don't run the full sweep. Then
     `requests set <reqId> --status done --phase "re-audited"`.
   - **`propose`** (has `wsId`): the cockpit's "Draft proposals first" button — the user accepted
     findings but none carry a writable before→after draft yet. Run **`/flowlever:propose <wsId>`**:
     draft the mechanically-applicable edits (ADO field / Confluence section before→after with a
     `targetRef`) for the accepted/open findings and attach them to the ledger (READ ONLY — writes
     nothing external). Structural / decision-only findings that can't be a surgical patch get a
     no-targetRef hand-off draft instead; say so. Emit phases (`--phase "drafting proposals"`). On
     success: `requests set <reqId> --status done --phase "proposals drafted" --wsId <wsId>` (the UI
     then flips the button from "Draft proposals first" to "Apply").
3. If a request fails (fetch error, bad PR id, auth), set `--status error --note "<short reason>"` and move
   on — never let one bad request block the rest.

4. **Author-activity check (waiting-on-author detection).** After draining the queue, for each `pr-review`/
   `pr-respond` workspace that is **waiting on the author** — `feature list --json` rows where
   `review.lastPostedAt` is set and `review.authorRespondedAt` is null — check the PR for new activity
   **since `review.lastPostedAt`**, authored by someone **other than you** (the reviewer):
   - new replies on the threads you posted, or any new comment threads (`repo_list_pull_request_threads` /
     `repo_list_pull_request_thread_comments`), and/or
   - new commits / a new iteration pushed (`repo_get_pull_request_by_id` / the PR's iterations).

   If you find any, flip the workspace to "author responded" with a short human note so the cockpit lights
   **Re-review**:
   ```
   FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature activity <wsId> --responded --note "2 new replies · 1 new commit"
   ```
   This check is **read-only** (safe to run every pass). It only flags; the user (or a queued re-review)
   does the actual reconcile. Posting again (a re-review) re-anchors `lastPostedAt` and clears the flag
   automatically. Skip workspaces already flagged. Like the fetches above, flag `needsInput` before the
   first ADO call if it can pop a 2FA/auth prompt.

## Keep the UI honest: emit phases + flag when you need the user
As you run each adapter, call `requests set <reqId> --phase "<current step>"` at every step so the UI's job
row shows what's happening live (`Running · reviewing changes`) instead of an opaque spinner. The adapter
procedures below spell out the exact phases. **The one rule that matters most:** whenever the runner is
about to do something that needs the user — an **auth/2FA approval** in another window, or a decision —
set `needsInput` + a clear `note` *before* the call so the UI shows the amber "⚠ needs your input" banner,
then clear it once unblocked:
```
# Before the FIRST Azure DevOps fetch (which may pop a 2FA/auth prompt in another window):
requests set <reqId> --phase "fetching PR #<prId> (may need your approval)" --needs-input \
  --note "If a 2FA/auth prompt appears in another window, approve it to continue."
# …after it succeeds:
requests set <reqId> --no-needs-input --phase "fetching linked ticket/spec"
```
A silent block waiting on 2FA is the exact pain this prevents — never make an MCP call that can prompt the
user without first flagging `needsInput`.

## Important
- **Writes still gate on intent:** `pr-review`/`pr-respond` ingest are read-only (safe to run
  automatically). The **`apply`** action posts to ADO — it only exists because the user clicked
  "Post comments/replies" in the UI, which IS their confirmation; still, surface what was posted.
- Keep each pass quick and idempotent: a request already `running`/`done` is skipped. The UI polls request
  status, so the user watches queued → running (with live phase + any needs-input prompt) → done in the
  browser while this runs in the session.
- This is the bridge that makes the cockpit **UI-driven, session-reactive**: user clicks in the browser →
  this runner does the MCP work → results show up back in the UI.
