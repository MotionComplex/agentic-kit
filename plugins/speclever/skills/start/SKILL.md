---
name: start
description: >
  Launch the SpecLever cockpit — start the local dashboard server and open it in the browser —
  so the user can work entirely from the UI. Use when the user says "start lever", "/speclever:start",
  "open the dashboard", "launch the cockpit", "run speclever", or "open the spec dashboard".
---

# /speclever:start — launch the cockpit

Start the SpecLever dashboard and open it in the browser. The user does the rest (create features,
review drafts, set/waive/resolve findings, export) from the UI.

## Procedure
Run the launcher (it boots `server.listen()` and opens the browser):

```
SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" start
```

- Add `--port N` to use a non-default port (default 4173), e.g. `SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" start --port 4180`.
- Add `--no-open` to start the server without opening a browser tab.
- If the port is already in use, a cockpit is likely already running — just point the user to
  `http://localhost:4173` instead of starting a second one (check with
  `curl -s -o /dev/null -w "%{http_code}" localhost:4173/api/features`).

Run it in the background so it keeps serving (it's a long-running process), then tell the user the URL:
**http://localhost:4173**. If there's no data yet, suggest `SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" demo` for a seeded example,
or running `/speclever:audit <feature>` to populate a real one.

## Also start the watch loop (so the UI can trigger jobs)
After the server is up, **kick off the runner loop in this session** so UI-enqueued jobs (e.g. "+ New PR
review") actually execute: begin a recurring **`/speclever:watch`** (via the `/loop` mechanism or a
self-scheduled wake-up). This makes the cockpit fully UI-driven: the user clicks in the browser, the loop
drains the request queue here and does the MCP fetch/post. Tell the user it's running and that they can
work entirely in the UI from now on. (Unless the user says "server only" / "no loop" — then skip it.)

## Note — what still needs this session
The browser can't reach MCP, so the **Claude session must stay open**: the watch loop (and `/speclever:audit`)
run here. After `/speclever:start` the user does everything in the UI; this session is just the engine the loop
runs in. Reviewing, status changes, drafts, and export are all in the dashboard.
