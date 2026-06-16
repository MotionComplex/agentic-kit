# FlowLever Data Schema (v1) — THE CONTRACT

All data lives in `data/` as JSON. Node-only, zero deps. All timestamps ISO-8601 strings.
Every module MUST conform to this. Changes to this file require updating PROGRESS.md decisions log.

## Files
```
data/
  features/<featureId>.json      # one workspace per feature
  ledger/<featureId>.json        # findings ledger per feature
  rounds/<featureId>.json        # audit round history per feature
  config.json                    # global settings (weights, gates)
  requests.json                  # UI-triggered job queue (one file, all requests)
```

## featureId
Kebab-case slug, e.g. `checkout-redesign`. `[a-z0-9-]+`, max 64 chars.

## kind — the workflow a workspace hosts
Every workspace declares a `kind`. All three kinds ride the **same** finding model, ledger,
reconciliation and review stepper; only the UI label/icon differs.
- `spec` — spec-readiness audit of a feature (Confluence/ADO/Figma). The default and the back-compat
  value: a feature on disk with no `kind` field is treated as `spec` everywhere.
- `pr-review` — reviewing someone else's pull request; findings model review comments (locus like
  `pr:<n>:<path>:<line>`).
- `pr-respond` — responding to reviewer threads on your own PR; findings model the threads awaiting a
  reply (locus like `pr:<n>:thread:<m>`).
`createFeature({ id, title, kind })` validates the enum and defaults to `spec`. The live PR adapters
(`/pr-review`, `/pr-respond`) land in a later phase; the engine is kind-agnostic today.

### Comment triage (pr-review / pr-respond)
For PR kinds a finding's **`suggestion` IS the proposed PR comment / reply body** — the cockpit shows it
as "Proposed comment" / "Proposed reply" and the decision row is comment triage rather than spec rework:
- **pr-review** → **Approve** (will post) · **Edit comment** · **Dismiss** (won't post). "Edit comment"
  opens the `suggestion` in a textarea; saving persists it via `setFindingDetails({ suggestion })`
  (`POST /api/features/:id/findings/:fp` now accepts `suggestion`) and marks the comment Approved (edited).
Every decision is **persisted immediately**, from whichever surface it's made (board modal or stepper):
Approve/Edit set the finding's `decision` field, Dismiss sets `status:waived`. The review flow's
in-memory decision map is hydrated from this persisted state, so the board, the stepper and the Post
screen always agree and a decision survives a page refresh.
- **pr-respond** → **Reply** · **Apply fix** · **Push back** · **Skip**.
A finding is **reviewable** (counted by the "Review N comments" CTA + walked by the stepper) when it is
open/reworking, is NOT yet posted (no `postedAt`), AND carries a `draft` OR a non-empty `suggestion` — a
code-diff `draft` is optional. At the finish/Post screen, approved/edited items are stamped **posted**
(`review/apply` with `status:'posted'` → stays `reworking` + sets `postedAt`) and dismissed items `waived`,
then an `apply` request is enqueued for the runner to post the comments back.

### Posted lifecycle (pr-review / pr-respond) — "awaiting author" + re-review
A **posted** finding is one whose comment/reply has been sent back to the PR: it keeps status `reworking`
(so reconciliation can still auto-resolve it) but carries a `postedAt` stamp. Semantically it's *awaiting
the author*, not open reviewer work, so it:
- sits in its own **"Posted — awaiting author"** board lane (PR kinds; rendered out of the Reworking lane),
- is excluded from the "to review" CTA/stepper and from the home `toReview`/`reworking` counts (counted
  under a separate `posted` count instead),
- does **not** penalize the readiness score (`computeReadiness` skips posted findings; they remain `isOpen`
  for reconciliation only).
**Re-review** = re-running `/flowlever:pr-review` against the same workspace (the cockpit's "↻ Re-review"
button on the `(re-run)` loop stage enqueues a fresh `pr-review` request for the same PR). On the next
ingest, reconciliation auto-resolves posted findings the author addressed (gone from the new set), keeps
the still-flagged ones (stamp preserved), and inserts anything new as `open`. The reviewer can also close a
posted finding manually at any time (Mark resolved / Reopen — reopening drops the `postedAt` stamp / Dismiss).

## features/<featureId>.json
```jsonc
{
  "id": "checkout-redesign",
  "title": "Checkout Redesign",
  "kind": "spec",                  // spec | pr-review | pr-respond — the workflow this workspace hosts (default spec)
  "status": "auditing",            // draft | auditing | reworking | ready | implementing | done
  "createdAt": "2026-06-13T01:10:00Z",
  "updatedAt": "2026-06-13T01:10:00Z",
  "sources": {
    "confluence": [ { "id": "123456", "title": "Checkout Redesign Spec", "url": "https://...", "version": 14, "lastFetched": null } ],
    "ado":        [ { "id": 42695, "type": "User Story", "title": "...", "url": "https://...", "state": "New", "lastFetched": null } ],
    "figma":      [ { "fileKey": "abc123", "nodeId": "1:23", "title": "Checkout flow v3", "url": "https://...", "lastFetched": null } ]
  },
  "specSections": [                 // extracted outline of the spec, used by coverage matrix
    { "key": "goals", "title": "Goals & Non-goals" },
    { "key": "flow-payment", "title": "Payment flow" }
  ],
  "coverage": [                     // spec section ↔ ado ↔ figma mapping (filled by audit)
    { "sectionKey": "flow-payment", "adoIds": [42695], "figmaNodeIds": ["1:23"], "status": "covered" }
    // status: covered | partial | uncovered | orphan (ado/figma with no section)
  ],
  "review": {                       // OPTIONAL (pr-review/pr-respond) — the "waiting on author" tracker
    "lastPostedAt": "2026-06-16T…",  //   when comments were last posted (the "since" anchor); set by markPosted
    "authorRespondedAt": null,       //   set by the /flowlever:watch runner when it sees new author activity;
                                     //   null ⇒ still waiting. Cleared on re-post and on re-review.
    "note": null                     //   human summary of the activity, e.g. "2 new replies · 1 new commit"
  },
  "notes": "",
  "reviewBrief": ""                 // OPTIONAL — per-run review scope/focus this workspace was launched
                                    // with (copied from the enqueuing request's `instructions`, e.g.
                                    // "front-end only"); surfaced as a "Review scope" note in the UI
}
```

## ledger/<featureId>.json
```jsonc
{
  "featureId": "checkout-redesign",
  "findings": [
    {
      "fp": "a1b2c3d4e5",                 // fingerprint: sha1(featureId|dimension|normTitle|locus).slice(0,10)
      "dimension": "consistency",         // consistency | completeness | testability | design-match | dor | ambiguity | feasibility
      "severity": "blocker",              // blocker | major | minor | info
      "title": "Spec says 3 payment methods, ADO story lists 4",
      "detail": "Section 'Payment flow' lists card/PayPal/invoice; AB#42695 AC adds Twint.",
      "locus": "confluence:123456#flow-payment vs ado:42695",  // free-form but stable; part of fingerprint
      "suggestion": "Align: either add Twint to spec section or remove from AC.",
      "status": "open",                   // open | reworking | resolved | waived
      "statusReason": null,               // required when waived
      "postedAt": null,                   // OPTIONAL (pr-review/pr-respond) ISO ts — set when the comment/reply
                                          // was posted back to the PR. Present ⇒ "Posted — awaiting author":
                                          // stays reworking (reconcile-eligible) but its own lane, no penalty,
                                          // excluded from "to review". Cleared on reopen (status→open).
      "decision": "approve",              // OPTIONAL (pr-review/pr-respond) approve | edit — the reviewer's
                                          // PERSISTED triage decision on a not-yet-posted comment ("will post").
                                          // Dismiss is modelled by status:waived, not here. Cleared on any
                                          // status change (waive/resolve/reopen/post). Hydrated into the review
                                          // flow so board + stepper + Post agree and survive a refresh.
      "pinned": false,                    // pinned findings never auto-resolve on reconciliation
      "firstSeenRound": 1,
      "lastSeenRound": 2,
      "resolvedInRound": null,
      "createdAt": "...", "updatedAt": "...",
      "history": [ { "at": "...", "from": "open", "to": "reworking", "by": "user|audit|reconcile", "note": "" } ],
      "draft": {                          // OPTIONAL — a proposed before→after fix, shown as a PR-style red/green diff
        "target": "AB#42695 — Acceptance Criteria",  // human/locus label for what the change touches
        "format": "text",                 // text | gherkin | markdown (display hint only)
        "before": "current text…",        // multi-line strings; diffed line-by-line in the cockpit
        "after": "proposed text…",
        "updatedAt": "...",
        "review": {                         // OPTIONAL — the reviewer's decisions on this draft
          "hunks": { "0": { "status": "accepted|rejected|edited", "editedText": "…", "at": "..." } },
          "note": "",                       // FINDING-level free-text counter-proposal for the coding agent
          "verdict": "proposed",            // proposed (default) | redirect (apply differently/elsewhere) | reject (don't apply)
          "updatedAt": "..."
        }
      }
    }
  ]
}
```
The `draft` is purely descriptive: it never touches identity fields (dimension/title/locus), so the
fingerprint is unaffected. `setFindingDraft`/`clearFindingDraft` set/remove it and append a history entry.
`setDraftReview` records per-hunk Accept/Reject/Edit decisions AND the finding-level `note`/`verdict`
counter-proposal; `redirect`/`reject` override the per-hunk proposal in the exported work order.

### Fingerprint normalization
`normTitle` = title lowercased, whitespace collapsed, punctuation stripped, truncated to 80 chars.
Fingerprint = `sha1(featureId + "|" + dimension + "|" + normTitle + "|" + locus)` hex, first 10 chars.

### Reconciliation rule (audit round N ingests a fresh finding set)
- Finding in new set, fp not in ledger → insert (status open, firstSeenRound=N).
- fp in ledger & status open/reworking → update lastSeenRound=N, refresh detail/suggestion.
- fp in ledger & status resolved/waived → reopen ONLY if `reopenResolved: true` passed; else log "still-flagged-but-closed" in round summary (regression alert).
- fp in ledger (open/reworking), NOT in new set → auto-resolve (by:"reconcile") unless pinned.

## rounds/<featureId>.json
```jsonc
{
  "featureId": "checkout-redesign",
  "rounds": [
    {
      "n": 1, "at": "...",
      "trigger": "audit",                  // audit | manual
      "stats": { "new": 12, "stillOpen": 0, "autoResolved": 0, "regressions": 0, "totalOpen": 12 },
      "readiness": { "score": 41, "gate": "not-ready", "openBySeverity": { "blocker": 2, "major": 4, "minor": 5, "info": 1 } },
      "note": "Initial swarm audit, 7 dimensions"
    }
  ]
}
```

## requests.json — UI-triggered job queue
A single JSON file holding a monotonic counter + the queue. The web UI enqueues a **request**; a
session-side runner skill (`/lever:watch`) polls `status: queued`, runs the matching adapter, and
flips the request through `running → done` (or `error`). The engine never runs adapters itself.
```jsonc
{
  "counter": 3,                        // monotonic; the next id is req-<counter+1>. NOT derived from a clock.
  "requests": [
    {
      "id": "req-3",                   // short slug: `req-<counter>`
      "action": "pr-review",           // pr-review | pr-respond | apply
      "prId": "1481",                  // PR id — required for pr-review/pr-respond, else null
      "wsId": "pr-1481-review",        // target workspace id — required for apply, set by the runner once it creates the ws
      "title": "Checkout PR",          // optional human label, else null
      "instructions": "front-end only",// optional per-run scope/focus the runner honors (string), else null
      "status": "queued",              // queued | running | done | error
      "phase": null,                   // short live label of the runner's current step (e.g. "fetching PR diff"); null when not running
      "needsInput": false,             // true when the job is BLOCKED waiting on the user (e.g. a 2FA/auth prompt); `note` carries the instruction
      "note": null,                    // optional free text — error reason, progress note, or the needs-input instruction
      "createdAt": "...", "updatedAt": "..."
    }
  ]
}
```
The three **actions**:
- `pr-review` — start a PR review (requires `prId`). The runner runs the `/lever:pr-review` adapter,
  creates a `pr-review` workspace, and sets the request's `wsId` + `status: done`.
- `pr-respond` — start a reviewer-thread response (requires `prId`). Same flow via `/lever:pr-respond`.
- `apply` — post the reviewed output (kept comments / replies) of an existing workspace back to the PR
  (requires `wsId`). Enqueued from a workspace's review finish screen.

The optional **`instructions`** is free-text scope/focus for THAT run (e.g. "front-end only", "focus on
the import validation"). `addRequest` validates it's a string when present and stores it (trimmed, else
null). The `/lever:watch` runner passes it to the adapter, which honors it as the review scope and copies
it onto the created workspace as `reviewBrief` (see features schema) so the applied scope stays visible.

Lifecycle: every request begins `queued` (`phase: null`, `needsInput: false`). The runner sets
`running` while working and advances `phase` step-by-step ("fetching PR diff" → "reviewing changes" →
…) so the UI shows what it's doing live. When the runner is about to do something that needs the user —
an auth/2FA approval, a decision — it sets `needsInput: true` + a human-facing `note`; the UI then
shows a prominent "⚠ needs your input" banner. It clears `needsInput` once unblocked. On success it
sets `done`, on failure `error` (with a `note`). `addRequest` validates the action enum + the
action-specific required field; `setRequestStatus` validates the status enum and merges any of
`status`/`note`/`wsId`/`phase`/`needsInput` (unspecified fields untouched), bumps `updatedAt`, and
clears `needsInput` whenever a terminal status (done/error) is set. All writes are atomic.

## config.json
```jsonc
{
  "severityWeights": { "blocker": 10, "major": 5, "minor": 2, "info": 0.5 },
  "gates": { "blockerOpenMeansNotReady": true, "readyThreshold": 85 },
  "dimensions": ["consistency","completeness","testability","design-match","dor","ambiguity","feasibility"]
}
```

## Readiness scoring
`penalty = Σ open findings (weight by severity)`; `score = max(0, round(100 − penalty * 100 / 40))`
(i.e. 40 weighted points ⇒ 0). Gate: any open blocker ⇒ `not-ready`. score ≥ readyThreshold & no blockers ⇒ `ready`. else `in-progress`.

## CLI surface (src/cli.js) — `node src/cli.js <cmd>`
```
feature add <id> --title "..."            create workspace
feature list | feature show <id>
feature delete <id>                       delete workspace (features + ledger + rounds files)
feature activity <id> --responded [--note "..."] | --clear   mark/clear "author responded" on a posted PR review (watch runner)
source add <featureId> --type confluence|ado|figma --id ... --title ... --url ...
ingest <featureId> --file findings.json [--reopen-resolved] [--note "..."]   # audit round ingest + reconcile
finding list <featureId> [--status open] [--dimension x] [--severity y]
finding set <featureId> <fp> --status resolved|waived|reworking|open [--reason "..."] [--pin|--unpin]
finding posted <featureId> --fps <fp>[,<fp>...]   mark PR comment(s)/repl(ies) posted (reworking + postedAt)
readiness <featureId>                     print score + gate + blockers
report <featureId> [--out report.md]      markdown report
coverage set <featureId> --file coverage.json
requests list [--status queued|running|done|error] [--json]   list UI-triggered job requests
requests delete <id>                      remove a request from the queue
requests set <id> --status running|done|error [--note "..."] [--wsId <id>] [--phase "..."] [--needs-input|--no-needs-input]   update a request (runner skill); --phase = live step label, --needs-input = blocked on you (2FA/auth)
demo                                      seed demo feature
```
Exit codes: 0 ok, 1 user error (bad args/not found), 2 internal. All output human-readable; `--json` flag for machine output on list/show/readiness.

## HTTP API (src/server.js, port 4173)
```
GET  /api/home                      → [{ id, title, kind, readiness:{score,gate}, counts:{toReview,open,reworking,posted,resolved,waived} }] cross-kind inbox, most-actionable first (posted = awaiting author, never double-counted as reworking/toReview)
GET  /api/features[?kind=spec|pr-review|pr-respond] → [featureSummary]  (incl. kind + readiness; optional kind filter)
GET  /api/features/:id              → { feature, ledger, rounds, readiness }
DELETE /api/features/:id            → 200 { id, deleted: true }; 404 if missing. Removes features/<id>.json, ledger/<id>.json, rounds/<id>.json.
POST /api/features/:id/findings/:fp → body { status?, reason?, pinned?, suggestion?, decision? }  (lifecycle ops + comment-body edit + persisted triage decision; suggestion → setFindingDetails, decision ('approve'|'edit'|null) → setFindingDecision; a status change clears decision)
POST   /api/features/:id/findings/:fp/draft → body { target?, before, after, format? } (set rework draft; 400 w/o before+after)
DELETE /api/features/:id/findings/:fp/draft → clear the rework draft
POST /api/features/:id/findings/:fp/draft/review → body { hunk, status, editedText? } | { hunks } | { note? } | { verdict? } (merges)
POST /api/features/:id/review/apply → body { fps: [...], status? } sets the listed findings to reworking (default), resolved (close without author), or posted (PR comment sent → reworking + postedAt stamp, "awaiting author"); allowlist. Atomic: 400 if any fp is unknown. (review-flow finish screen)
POST /api/features/:id/status       → body { status } sets the workspace lifecycle status (draft|auditing|reworking|ready|implementing|done) — e.g. "Mark review complete". 400 on bad status.
POST /api/features/:id/activity     → body { authorResponded?, note?, lastPostedAt?, at? } updates the "waiting on author" tracker (feature.review). The /flowlever:watch runner sets authorResponded:true + note when it detects new PR activity; the UI clears it on re-review. 400 if empty.
POST /api/ingest/:id                → body { findings: [...], note?, reopenResolved? } (used by skills)
POST /api/requests                  → body { action, prId?, wsId?, title?, instructions? } → 201 created request (400 on bad/missing fields). instructions = optional per-run review scope/focus (string)
GET  /api/requests[?status=queued]  → [request]  (UI-triggered job queue; optional status filter)
POST /api/requests/:id              → body { status?, note?, wsId?, phase?, needsInput? } → updated request (runner skill drives this; phase=live step, needsInput=blocked on user)
DELETE /api/requests/:id            → 200 { id, deleted: true }; 404 if missing. Removes the request from the queue.
GET  /api/report/:id                → text/markdown report
Static: / → web/index.html, /app.js, /style.css
```
Ingest findings shape (what skills/audit produce — fp computed server/CLI-side, do NOT send fp):
```jsonc
{ "dimension": "consistency", "severity": "major", "title": "...", "detail": "...", "locus": "...", "suggestion": "..." }
```
