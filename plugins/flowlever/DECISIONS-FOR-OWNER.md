# Decisions made on your behalf — FlowLever P2 run

Every entry is a default-and-proceed call taken while you were away. **You can override any of
them**; each notes how reversible it is. Run outcome and unit history: `AUTOPILOT-STATE.md`.

## Decisions

- [process] **Integration branch `feat/flowlever-p2`, merged `--no-ff` into `main` myself.**
  Alternatives: commit straight onto `main` (you said "work directly on main") / leave you a PR.
  Why: you asked for everything on `main` and were away, so an unmerged PR would have blocked you;
  the branch keeps each unit independently revertable. Reversible: yes — `git revert -m 1 <merge>`,
  or revert any single unit commit. OWNER CAN OVERRIDE.

- [state] **Replaced the previous run's `AUTOPILOT-STATE.md`.** Why: one state file, one truth; the
  prior run is closed and its full record is in git. Reversible: yes —
  `git show 49dae65:plugins/flowlever/AUTOPILOT-STATE.md`. OWNER CAN OVERRIDE.

- [scope] **Added U4 (coherence) to the run.** Your mandate said "plus whatever is needed to make it
  coherent", and the brevity rule shipped in `9fcfd5b` lived in 2 of the 4 comment-authoring sites
  while `conventions/code-review.md` — which declares itself canonical — was silent on length.
  Reversible: yes, docs only. OWNER CAN OVERRIDE.

- [design] **No new `/api/health` endpoint for the heartbeat.** `GET /api/version` already exists
  and is documented as the cheapest handler, matched first, that answers when everything else about
  the build is mismatched. A second endpoint would have been duplicate surface. Reversible: yes.

- [design] **A 3s deadline on the heartbeat fetch.** Twice the ~1.5s the server can legitimately
  block behind a contended ledger write, so a merely slow cockpit is not reported as gone. Without
  it the whole unit missed its motivating case (a wedged server never settles a bare fetch).
  Reversible: yes, one constant (`HEARTBEAT_TIMEOUT_MS`).

- [design] **A rejected finding stays `open` rather than `waived` or `resolved`.** Waiving would
  convert "don't apply this proposal" into "this finding is dismissed" — a different intent that
  also drops it off the board; resolving would hide it from the re-review reconcile. Cost: a
  rejected finding stays in the reviewable set indefinitely, exactly as an explicit Skip does.
  Reversible: yes.

- [scope] **"Approve all remaining" renders on `pr-review` workspaces only.** Bulk-approving
  replies (`pr-respond`) or spec write-backs is a materially larger consequence, and neither kind
  calls the act "Approve". Reversible: yes — it is one `kind` guard. OWNER CAN OVERRIDE.

- [scope] **The `title` ≤60-char rule stayed FlowLever-specific**, not promoted into the shared
  convention: it governs a ledger/UI field that is never posted to a PR. Reversible: yes.

- [correction] **Two claims in my original analysis were wrong and are corrected in the state file
  rather than implemented as specified:** the Post button was already correctly disabled at zero
  approved (only its dead-end label changed), and "one vocabulary everywhere" would have been worse
  than the drift it replaced, because the three workspace kinds perform genuinely different acts.

## OWNER ACTIONS REQUIRED

1. **Nothing is pushed.** `main` is ahead of `origin/main` by 4 commits plus a merge. Push when
   ready:
   ```
   git push origin main
   ```
2. **Hard-reload the cockpit** (⌘⇧R). The server sends no `ETag`/`Cache-Control`, so your tab may
   still hold the older `app.js`. You will now get a banner telling you when a restart means your
   assets are stale.
3. ~~**Worth a decision from you — a real hazard this run surfaced.** Clicking **Post** spawns a
   real `claude … /flowlever:watch` session that writes to real Azure DevOps. Pointing
   `FLOWLEVER_DATA` at a scratch ledger isolates the *data*, not the *outbound writes*.~~
   **DONE** — you asked for it afterwards and it shipped as `FLOWLEVER_READONLY=1` (`efc2517`),
   enforced at the ledger write choke point, the HTTP layer, and the runner spawn. See the
   Environment variables table in `README.md`. Nothing to decide.
4. **Unrelated, but your poller logged it during this run:** PR 5843's review was ingested at 08:37Z
   and the PR merged at 09:05Z with its five findings still in draft — never posted. The
   review-turnaround gap is yours to weigh.
