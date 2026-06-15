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
   FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" requests set <reqId> --status running
   ```
   - **`pr-review`** (has `prId`): run the **`/flowlever:pr-review <prId>`** procedure — create/locate the
     `pr-review` workspace, fetch + review, ingest findings. On success:
     `requests set <reqId> --status done --wsId <workspaceId>` (so the UI links the request to the workspace).
   - **`pr-respond`** (has `prId`): run **`/flowlever:pr-respond <prId>`** — create the `pr-respond` workspace,
     fetch threads, ingest. Then `requests set <reqId> --status done --wsId <workspaceId>`.
   - **`apply`** (has `wsId`): run the **Apply** step of the matching adapter for that workspace's `kind`
     (post inline comments for `pr-review`, post replies / apply fixes for `pr-respond`), reading the user's
     decisions from the ledger. Then `requests set <reqId> --status done`.
3. If a request fails (fetch error, bad PR id, auth), set `--status error --note "<short reason>"` and move
   on — never let one bad request block the rest.

## Important
- **Writes still gate on intent:** `pr-review`/`pr-respond` ingest are read-only (safe to run
  automatically). The **`apply`** action posts to ADO — it only exists because the user clicked
  "Post comments/replies" in the UI, which IS their confirmation; still, surface what was posted.
- Keep each pass quick and idempotent: a request already `running`/`done` is skipped. The UI polls request
  status, so the user watches queued → running → done in the browser while this runs in the session.
- This is the bridge that makes the cockpit **UI-driven, session-reactive**: user clicks in the browser →
  this runner does the MCP work → results show up back in the UI.
