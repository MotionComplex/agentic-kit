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
A finding may carry **`duplicateOf`** — a marker that the same point was already raised elsewhere
(`{ "label": "Oriol on OktaErrorHelper.cs:39", "url": "<ADO deep link>", "fp": "<canonical fp>" }`,
label required). The cockpit renders an amber DUPLICATE chip linking to `url`; the posted reply
should be the generic cross-reference (`Duplicate of [<label>](<url>) — already being handled
there.`), never a second full answer. Validated on ingest and via `setFindingDetails`.

For PR kinds a finding's **`suggestion` IS the proposed PR comment / reply body** — the cockpit shows it
as "Proposed comment" / "Proposed reply" and the decision row is comment triage rather than spec rework:
- **pr-review** → **Approve** (will post) · **Edit comment** · **Dismiss** (won't post). "Edit comment"
  opens the `suggestion` in a textarea; saving persists it via `setFindingDetails({ suggestion })`
  (`POST /api/features/:id/findings/:fp` now accepts `suggestion`) and marks the comment Approved (edited).
Every decision is **persisted immediately**, from whichever surface it's made (board modal or stepper):
Approve/Edit set the finding's `decision` field, Dismiss sets `status:waived`. The review flow's
in-memory decision map is hydrated from this persisted state, so the board, the stepper and the Post
screen always agree and a decision survives a page refresh.
- **pr-respond** → **Reply** · **Fix + reply** · **Fix only** · **Push back** · **Skip**. **Fix only**
  (`decision: "fix-only"`) pushes the code change and writes no comment at all — the runner resolves the
  reviewer's thread via `update_status: Fixed` instead. It requires a code draft (there is nothing to push
  otherwise) and is counted separately on the Post button ("Post 2 replies + 1 fix (no reply)") so the
  button never claims a reply it won't send.
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
### The fix gate — a claimed code fix must point at a real pushed commit
**Invariant: a `pr-review`/`pr-respond` finding whose agreed response is a CODE CHANGE cannot be marked
posted without the sha of the commit that carries it.** `markPosted` throws EUSER otherwise (→ 400 on
the HTTP path, exit 1 on the CLI), validating the whole batch before writing anything so a mixed batch
cannot half-apply.

This exists because the opposite happened: a run replied "Fixed" on two threads, reported the job `done`
with the phase *"posted to PR + fixes applied"*, and never committed anything. The reviewer re-raised
both points five days later. Replying is the easy half and succeeded alone, so every downstream surface
read the reply as completion.

- **`isAgreedCodeFix(finding)`** — the gate's trigger: a `draft` whose `after` differs from `before`,
  not vetoed by a `redirect`/`reject` verdict, AND signed off either finding-level (`decision` of
  `edit` / `fix-only`) **or** hunk-by-hunk (a `draft.review.hunks` entry `accepted`/`edited`). The hunk
  path is essential: going straight from per-hunk Accept to Post never sets `decision`, so keying only
  off `decision` would leave the commonest case ungated.
- **`fixCommit: { sha, repo, branch, at }`** — set via `markPosted({ sha })` or `setFindingFixCommit`
  (CLI `finding fixed --sha`). Rendered as a green `✔ fix <sha>` chip.
- **Scope:** PR kinds only. A `spec` workspace's drafts are Confluence/ADO edits whose proof of delivery
  is `appliedAt` (`markApplied`), so no sha is owed. An unreadable kind fails **closed** (gate on).
- **`unbackedFixes(featureId)`** (CLI `finding unbacked [--json]`) audits the inverse: agreed code fixes
  closed as handled with no commit behind them. The cockpit shows a red banner + `⚠ fix not pushed`
  chips and offers to reopen them; `/flowlever:watch` runs the audit every pass and reopens confirmed
  ones. Findings stamped before the gate existed surface here, which is intended.
- Reply-only findings are untouched — there a reply IS the whole deliverable.

### In-flight markers and who is allowed to claim a write
`pending: "post" | "apply"` is a **transient claim that a write is in flight**, set by the cockpit when
the user confirms Post/Apply. It is deliberately NOT a completion: the browser cannot reach ADO, so it
cannot know anything landed. Only the runner may claim the write, by stamping `postedAt` / `appliedAt`
(`markPosted` / `markApplied`, i.e. `finding posted` / `finding applied`).

That split makes one failure mode possible and it must be handled everywhere: a pending finding whose
runner never arrived, died mid-flight, or failed. It is excluded from the review queue (`isInFlightOrOut`)
and never stamped, so without a way out it is stranded in the "Posting…/Applying…" lane forever — the
cockpit showing work in progress that nobody is doing.
- **`clearFindingPending(featureId, fps, { reason })`** (CLI `finding cancel`, HTTP `review/cancel`) is
  the way out: it drops the marker, keeps the finding `reworking` with its `decision` intact (so a retry
  re-posts the same items), records the release in `history`, and **never** sets `postedAt`/`appliedAt`.
  Findings already stamped are left untouched, so it is safe after a partial success.
- **`pendingFindings(featureId)`** lists what a workspace currently has in flight.
- The runner MUST stamp **per finding, immediately after each write succeeds** — never batched at the
  end of a run — and MUST `finding cancel` whatever it did not write when an apply fails. `/flowlever:watch`
  additionally heals strays each pass: pending findings with no queued/running `apply` are checked against
  the PR and either stamped (the comment is there, only the stamp was lost) or released.
- The cockpit treats a queued/running job untouched for **3 minutes** as *stalled* and says so — "no
  runner picked this up · nothing has been posted" — instead of spinning indefinitely, and a request that
  reached `done` while findings are still pending is reported as **not confirmed**, never as posted.

### The two review clocks — "when can I re-review?"
The cockpit answers that question by showing two timestamps side by side on every PR workspace (card,
inbox row and detail header), via `ledger.reviewStamps(feature, lastRoundAt)`:
- **Reviewed** = `lastRoundAt`, the `at` of the workspace's last ingest round. A round IS a review pass,
  so there is deliberately **no separate stored stamp** for this — it can never drift out of sync.
- **PR updated** = `review.lastActivityAt` (+ `lastActivityBy`), the real ADO timestamp of the newest
  update by the *other* side: the author on a `pr-review` workspace, the reviewer on `pr-respond`.

`reviewStamps` derives **`newSinceReview`** = `lastActivityAt` parses later than `lastReviewedAt`. That is
the "you can re-review now, and it will actually see something" signal: the UI badges the stamp
("● new since your review"), the card's review line says "Author responded <when>", and `reviewWait()`
treats it exactly like the runner's explicit `authorRespondedAt` flag → the prominent **↻ Re-review** CTA.
Timestamps are compared with `Date.parse`, not string order, since ADO's offsets/precision differ from ours.

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
                                     //   NOTE: this is DETECTION time — when the runner noticed.
    "lastActivityAt": null,          //   the REAL ISO ts of the newest counterpart update on the PR (their
                                     //   latest comment / pushed commit), as reported by ADO. Set by the
                                     //   runner via `feature activity --at`. Survives re-review (it stays
                                     //   true) — it's the last-round comparison, not the flag, that decides
                                     //   whether it still counts as "new".
    "lastActivityBy": null,          //   who made that update (display name), for "PR updated 20m ago by X"
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
      "decision": "approve",              // OPTIONAL (pr-review/pr-respond) approve | edit | fix-only — the
                                          // reviewer's PERSISTED triage decision on a not-yet-posted comment
                                          // ("will post"). `fix-only` (pr-respond) = push the code fix and
                                          // post NO reply; the runner resolves the thread by setting its ADO
                                          // status to Fixed instead of commenting (a thread left Active would
                                          // be re-detected as "awaiting your reply" on every later sweep).
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
        "targetRef": {                    // OPTIONAL — machine write target for /flowlever:apply-spec (surgical apply)
          "system": "ado",                //   ado | confluence
          "adoId": 42695,                 //   ado: work item id + field reference name…
          "field": "Microsoft.VSTS.Common.AcceptanceCriteria"
          // confluence form: { "system":"confluence", "pageId":"123456", "anchor":"flow-payment", "version":14 }
          //   version = the page version `before` was read from → optimistic-concurrency on write.
          // Omitted for Figma / hand-off drafts (no auto-write target). Set/preserved by setFindingDraft;
          // re-drafting text only keeps the prior targetRef.
        },
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

### Spec change proposals (spec workspaces) — Accept / Edit / Reject+counter → Apply
The same `draft` + `draft.review` model powers reviewable **spec change proposals**, the spec-side
mirror of PR-review comments. `/flowlever:propose` drafts a before→after edit bound to a `targetRef`
(an ADO field or a Confluence section); the cockpit's decision row is:
- **Accept** → `draft.review.verdict` stays `proposed` (and/or hunk `accepted`); apply writes `after`.
- **Edit** → the hunk's `status:"edited"` + `editedText`; apply writes the edited text. No re-audit.
- **Reject + counter** → `draft.review.verdict:"redirect"` + the counter `note`, AND a scoped
  **`re-audit`** request is enqueued (see actions below) so `/flowlever:audit` re-evaluates ONLY the
  redirected findings against the counter and re-drafts — a per-item refine loop.
On the user's **Apply**, an `apply` request for the spec workspace runs `/flowlever:apply-spec`, which
writes the accepted/edited drafts back **surgically** (patch one ADO field / one Confluence node with
optimistic-concurrency via `targetRef.version`; never regenerate a page). `redirect`/`reject`/`waived`
drafts and drafts without a `targetRef` (Figma/hand-off) are skipped by apply.

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
      "action": "pr-review",           // pr-review | pr-respond | apply | re-audit | audit | propose | poll
      "prId": "1481",                  // PR id — required for pr-review/pr-respond, else null
      "wsId": "pr-1481-review",        // target workspace id — required for apply + re-audit, set by the runner once it creates the ws
      "kind": null,                    // `poll` only: pr-review | pr-respond narrows the refresh to one
                                       // section; null = both. Ignored for other actions.
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
The **actions**:
- `pr-review` — start a PR review (requires `prId`). The runner runs the `/lever:pr-review` adapter,
  creates a `pr-review` workspace, and sets the request's `wsId` + `status: done`.
- `pr-respond` — start a reviewer-thread response (requires `prId`). Same flow via `/lever:pr-respond`.
- `apply` — write the reviewed output of an existing workspace back to its source (requires `wsId`).
  The runner **branches on the workspace `kind`**: PR kinds post kept comments/replies back to the PR
  (`/flowlever:pr-review`/`pr-respond` Apply); a `spec` workspace runs `/flowlever:apply-spec`, writing
  accepted change proposals to ADO fields / Confluence sections surgically. Enqueued from a workspace's
  review finish screen.
- `re-audit` — scoped re-audit of a `spec` workspace (requires `wsId`). Enqueued when the user **Rejects
  a proposal with a counter**: `/flowlever:audit` re-evaluates ONLY the findings whose
  `draft.review.verdict === "redirect"`, honoring each one's counter `note` (+ the request `instructions`),
  and re-drafts or waives them — the per-item refine loop. Does not run the full sweep or ingest a round.
- `audit` — start a **new spec analysis** from the UI's "+ New spec analysis" button (requires
  `instructions` = the Confluence / ADO / Figma URLs, + optional focus; optional `title`). The runner runs
  `/flowlever:audit`: it parses the URLs, creates the `spec` workspace, registers the sources, runs the
  sweep, and sets the request's `wsId` + `status: done` so the cockpit links to the new workspace.
- `poll` — the cockpit's **"↻ Refresh"** button: run a discovery pass NOW instead of waiting for the
  scheduled `/flowlever:poll` (optional `kind` scopes it to one PR section; no target ids needed). The
  runner executes `/flowlever:poll` steps 1–4 — find PRs with no workspace, re-check known ones for
  counterpart updates (stamping `review.lastActivityAt`), enqueue the resulting reviews — then keeps
  draining. Read-only toward ADO: it never posts. Reported back via `phase` (e.g. "2 new · 1 updated").

`POST /api/requests` accepts an extra **`dedupe: true`** (mirroring the CLI's `--dedupe`): if a
queued/running request already matches the same action + `prId`/`wsId`/`kind`, the existing one is
returned with `deduped: true` and HTTP 200 instead of stacking a second job. The Refresh button uses this,
so a double-click cannot fan out two passes.

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
feature activity <id> [--responded] [--note "..."] [--at <iso>] [--by "<name>"] | --clear   mark/clear "author responded" on a posted PR review (watch runner); --at/--by record the REAL time + author of the newest counterpart update on the PR (review.lastActivityAt/lastActivityBy) — the "PR updated <when>" clock the cockpit pairs with "Reviewed <when>". Stamp-only (no --responded) is allowed.
source add <featureId> --type confluence|ado|figma --id ... --title ... --url ...
ingest <featureId> --file findings.json [--reopen-resolved] [--note "..."]   # audit round ingest + reconcile
finding list <featureId> [--status open] [--dimension x] [--severity y]
finding set <featureId> <fp> --status resolved|waived|reworking|open [--reason "..."] [--pin|--unpin]
finding posted <featureId> --fps <fp>[,<fp>...]   mark PR comment(s)/repl(ies) posted (reworking + postedAt). RUNNER ONLY, and per finding right after each write succeeds — never batched at the end of a run
finding cancel <featureId> [--fps <fp>[,<fp>...]] [--reason "..."]   release in-flight "Posting…/Applying…" markers (default: all) back to the review queue; claims nothing was written. Call on every failed/abandoned apply
finding draft <featureId> <fp> --before "..." --after "..." [--target "..."] [--format text|gherkin|markdown] [--target-ref '<json>']   attach a proposed before→after change (+ machine write target for apply)
finding draft-clear <featureId> <fp>      remove a finding's proposed change
finding review <featureId> <fp> [--verdict proposed|redirect|reject] [--note "..."] [--hunk <idx> --hunk-status accepted|rejected|edited [--edited-text "..."]]   record Accept/Edit/Reject+counter on a proposal
readiness <featureId>                     print score + gate + blockers
report <featureId> [--out report.md]      markdown report
coverage set <featureId> --file coverage.json
requests list [--status queued|running|done|error] [--json]   list UI-triggered job requests
requests add --action <action> [--prId <id>] [--wsId <id>] [--kind pr-review|pr-respond] [--title "..."] [--instructions "..."] [--dedupe] [--json]   enqueue a job from the CLI (same queue as POST /api/requests; --kind scopes a `poll` refresh; --dedupe no-ops on an identical queued/running request)
requests delete <id>                      remove a request from the queue
requests set <id> --status running|done|error [--note "..."] [--wsId <id>] [--phase "..."] [--needs-input|--no-needs-input]   update a request (runner skill); --phase = live step label, --needs-input = blocked on you (2FA/auth)
demo                                      seed demo feature
```
Exit codes: 0 ok, 1 user error (bad args/not found), 2 internal. All output human-readable; `--json` flag for machine output on list/show/readiness.

## HTTP API (src/server.js, port 4173)
```
GET  /api/home                      → [{ id, title, kind, readiness:{score,gate}, counts:{toReview,open,reworking,posted,resolved,waived}, lastRoundAt, stamps }] cross-kind inbox, most-actionable first (posted = awaiting author, never double-counted as reworking/toReview)
GET  /api/features[?kind=spec|pr-review|pr-respond] → [featureSummary]  (incl. kind + readiness + stamps; optional kind filter)
     stamps = { lastReviewedAt, lastActivityAt, lastActivityBy, lastPostedAt, authorRespondedAt, newSinceReview }
              — the two review clocks (see "The two review clocks" above); newSinceReview ⇒ re-review is worthwhile
GET  /api/features/:id              → { feature, ledger, rounds, readiness }
DELETE /api/features/:id            → 200 { id, deleted: true }; 404 if missing. Removes features/<id>.json, ledger/<id>.json, rounds/<id>.json.
POST /api/features/:id/findings/:fp → body { status?, reason?, pinned?, suggestion?, decision? }  (lifecycle ops + comment-body edit + persisted triage decision; suggestion → setFindingDetails, decision ('approve'|'edit'|null) → setFindingDecision; a status change clears decision)
POST   /api/features/:id/findings/:fp/draft → body { target?, targetRef?, before, after, format? } (set rework draft; 400 w/o before+after; targetRef = machine write target {system:'ado',adoId,field?} | {system:'confluence',pageId,anchor?,version?})
DELETE /api/features/:id/findings/:fp/draft → clear the rework draft
POST /api/features/:id/findings/:fp/draft/review → body { hunk, status, editedText? } | { hunks } | { note? } | { verdict? } (merges)
POST /api/features/:id/findings/:fp/counter → body { note, scope? } Reject+counter a proposal: records verdict='redirect'+note on the draft AND enqueues a scoped re-audit request for this workspace. Returns { finding, request }. 400 if note empty; 400/404 if the finding has no draft.
POST /api/features/:id/review/apply → body { fps: [...], status? } sets the listed findings to reworking (default), resolved (close without author), or posted (PR comment sent → reworking + postedAt stamp, "awaiting author"); allowlist. Atomic: 400 if any fp is unknown. (review-flow finish screen)
POST /api/features/:id/review/cancel → body { fps?, requestId?, reason? } releases stranded in-flight markers (default: every pending finding in the workspace) so they return to the review queue, and optionally drops the dead request. Never stamps postedAt/appliedAt — it claims nothing was written. → { cancelled, requestDeleted, findings }. 400 on unknown fps.
POST /api/features/:id/status       → body { status } sets the workspace lifecycle status (draft|auditing|reworking|ready|implementing|done) — e.g. "Mark review complete". 400 on bad status.
POST /api/features/:id/activity     → body { authorResponded?, note?, lastPostedAt?, at?, lastActivityAt?, lastActivityBy? } updates the "waiting on author" tracker (feature.review). The /flowlever:watch runner sets authorResponded:true + note when it detects new PR activity, plus lastActivityAt/lastActivityBy = the REAL time + author of the newest counterpart update; the UI clears the flag on re-review. 400 if empty or if lastActivityAt is unparseable.
POST /api/ingest/:id                → body { findings: [...], note?, reopenResolved? } (used by skills)
POST /api/requests                  → body { action, prId?, wsId?, kind?, title?, instructions?, dedupe? } → 201 created request (400 on bad/missing fields). instructions = optional per-run review scope/focus (string); kind scopes a `poll` refresh; dedupe:true returns the matching queued/running request as 200 { …, deduped:true } instead of stacking a duplicate
GET  /api/requests[?status=queued]  → [request]  (UI-triggered job queue; optional status filter)
POST /api/requests/:id              → body { status?, note?, wsId?, phase?, needsInput? } → updated request (runner skill drives this; phase=live step, needsInput=blocked on user)
DELETE /api/requests/:id            → 200 { id, deleted: true }; 404 if missing. Removes the request from the queue.
GET  /api/runner[?log=1]            → { available, reason, bin, binFrom, running, action, pid, startedAt, finishedAt, exitCode, signal, logPath, actions, log? } — is a session draining the queue? `log=1` tails <data>/runner.log
POST /api/runner                    → body { action?: "watch" | "poll" } spawns a headless `claude -p "/flowlever:<action>"` in a login shell → 202 + status. 400 unknown action · 409 one already running · 503 no `claude` binary (set FLOWLEVER_CLAUDE_BIN). The prompt comes from a fixed allowlist — never from the request body.
DELETE /api/runner                  → SIGTERM the running runner → 200 + status; 409 when idle
GET  /api/report/:id                → text/markdown report
Static: / → web/index.html, /app.js, /style.css
```
Ingest findings shape (what skills/audit produce — fp computed server/CLI-side, do NOT send fp):
```jsonc
{ "dimension": "consistency", "severity": "major", "title": "...", "detail": "...", "locus": "...", "suggestion": "..." }
```
