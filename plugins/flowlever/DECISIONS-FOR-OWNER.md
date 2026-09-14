# Decisions made on your behalf — FlowLever PR-triage run

Every entry is a default-and-proceed call taken while you were away. **You can override any of
them**; each notes how reversible it is. Run outcome and unit history: `AUTOPILOT-STATE.md`.

## Decisions

### Process

- [process] **Worktree + branch `feat/flowlever-pr-triage`, and the merge to `main` is left to you.**
  Alternatives: work on `main` as previous runs did / merge it myself when green. Why: the live
  cockpit serves `web/` from the main checkout and had three queued jobs, so a `main` merge would
  have landed this UI under a runner mid-flight — exactly what you asked me to avoid. Reversible:
  yes — one merge command. **See OWNER ACTIONS REQUIRED.** OWNER CAN OVERRIDE.

- [state] **Replaced the previous run's `AUTOPILOT-STATE.md` / `DECISIONS-FOR-OWNER.md`.** Why: that
  run is closed and its record is in git; one state file, one truth — the same call the P2 run made.
  Reversible: yes — `git show 7b4c358:plugins/flowlever/AUTOPILOT-STATE.md`.

### The taxonomy

- [design] **The state is computed on the server, not in the browser.** Why: the repo's own principle
  is "all state logic stays in the core" — and browser code cannot be unit-tested here, so a taxonomy
  built there would be the one part of this change nothing could verify. Reversible: yes, but it
  would give up the tests.

- [design] **Live-job states outrank the workspace's own state.** A PR being re-reviewed by a runner
  shows as "Re-reviewing", not as whatever it was before the job started. Why: the question a list
  answers is "what is happening to this now". Reversible: one branch in `categoryOf`.

- [design] **Order inside "Needs you": broken → ready-to-post → new → re-review → author responded.**
  Yours listed new PRs first; I put a stalled/failed job above them (nothing else moves until it is
  unstuck) and `ready-to-post` next (it is one click from finished, so leaving it buried costs the
  most). Reversible: trivially — the order is one array (`WS_STATES`), and changing it reorders every
  surface at once. OWNER CAN OVERRIDE.

- [scope] **"Ready to post" added as a state you did not list.** Your list jumps from "new PRs to
  check" to "queued action: posting review", with nothing for a PR you have fully decided but not yet
  posted. That state exists in the data today and is the cheapest action on the board. Reversible:
  fold it into `needs-review`. OWNER CAN OVERRIDE.

- [scope] **A stalled or errored job rises into "Needs you" rather than staying "In progress".**
  Your list put queued actions in the informative tier. But `req-204` in your real queue had been
  waiting 27 minutes with no runner draining it — calling that "in progress" is the lie the band
  split exists to remove, and the card says "Nothing has been posted" with a cancel control.
  Reversible: one branch in `categoryOf`. OWNER CAN OVERRIDE.

- [scope] **Grouping applies to Home and all three sections, not just PR Review.** Why: they share
  one grid/row renderer; giving PR Review its own taxonomy would either fork that renderer or leave
  the other three visibly inconsistent. The band labels are kind-agnostic. Reversible: a `kind` guard.
  OWNER CAN OVERRIDE.

### Judgement calls made while fixing what the reviews found

- [design] **A poll tick that changes nothing now touches nothing, and one that does change something
  waits for you to finish.** Folding jobs onto Home rows turned the 4-second poll into something that
  repainted the whole inbox every tick — which reverted an open **delete** confirm within 4s and
  dropped your focus. The fix holds the repaint, and the hold has two reasons with different rules:
  an unanswered destructive **confirm** holds until answered (it is a question, and a repaint would
  answer it "no" on your behalf, silently); mere **focus or selection** holds for 12 seconds, then
  repaints and puts your focus back. Why not hold on focus forever: a list that is silently wrong
  about the world is worse than a moment's disruption. Reversible: `ZONE_BUSY_HOLD_MS`.

- [design] **While the rows are held, the jobs strip and the "Run N jobs" button keep updating, and
  the rows say so.** The alternative — freezing them too — means a button promising a stale number
  and live work hidden at the moment it is happening. Reversible: it is one branch and one string.

- [design] **Relative ages are in the repaint signature as their rendered text, not as a clock.**
  Putting `Date.now()` in would repaint every tick and reinstate the problem above; leaving them out
  froze "queued 27m ago" indefinitely. Signing the string means a repaint happens exactly when the
  displayed text would change — about once a minute.

- [design] **Spec jobs now speak spec.** A running spec audit said "Re-reviewing" and an apply said
  "Posting to PR", on a workspace that has no PR. The repo's own vocabulary is that spec *applies*,
  pr-review *posts*, pr-respond *replies*; the job labels now follow it. Reversible: one table.

- [design] **A job binds a workspace only when the job's action matches the workspace's kind.**
  Before, a `pr-respond` job could label a `pr-review` workspace "Re-checking threads", and — because
  `prNumber()` will match any digit run in an id — a PR job could bind a **spec** workspace whose id
  merely contained that number. The `wsId` arm is untouched and still names a workspace outright.

- [design] **The `draft` lifecycle chip is hidden when it is the default.** Every active card said
  `draft`; beside the new state pill it carried no information. Non-default statuses
  (`auditing`/`reworking`/`ready`/`implementing`) still show. Reversible: one guard.

- [design] **API version bumped 3 → 4.** The UI depends on the new `state` field, so an old server
  with the new page must say so rather than mis-group silently. Consequence: **the cockpit must be
  restarted after you merge**, or you will see the stale-server banner. That banner is the mechanism
  working, not a fault.

## OWNER ACTIONS REQUIRED

1. **Merge when your queue is clear.** `req-202`, `req-203` and `req-204` were queued when this run
   started, and `req-145` was errored. Once they have drained:

   ```bash
   cd /Users/elias.douglas/development/agentic-kit
   git merge --no-ff feat/flowlever-pr-triage
   ```

2. **Restart the cockpit** — the API version changed, so the running server (pid 51980) is older than
   the page it will serve until you do:

   ```bash
   kill 51980
   node /Users/elias.douglas/development/agentic-kit/plugins/flowlever/app/src/cli.js start --no-open
   ```

3. **Remove the worktree when you are done with it** (optional):

   ```bash
   git worktree remove /Users/elias.douglas/development/agentic-kit-pr-triage
   git branch -d feat/flowlever-pr-triage   # only after merging
   ```

Nothing was pushed. Your main checkout was never touched — verified clean on `main` at `7b4c358` at
the end of the run — and `~/.flowlever` was only ever read.
