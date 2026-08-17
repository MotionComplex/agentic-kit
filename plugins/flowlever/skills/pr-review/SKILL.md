---
name: pr-review
description: >
  Load an Azure DevOps pull request into the FlowLever cockpit as a `pr-review` workspace: fetch the
  PR diff + spec/ticket, produce review findings anchored to file:line, and ingest them so you can
  step through and decide each one in the same review UI as specs — then post the kept comments back
  to the PR. Use when the user says "review PR X in the cockpit", "load PR X into flowlever",
  "/flowlever:pr-review X", or "PR review X with the stepper". For a plain markdown/interactive review
  without the cockpit, use the standalone `/pr-review` skill instead.
---

# /flowlever:pr-review — PR review, in the cockpit

Bridges the existing `/pr-review` skill into the FlowLever review cockpit. The **fetch + analysis is
identical to `/pr-review`** — if this monorepo also has that standalone skill checked out (a sibling
of `plugins/`, typically at `skills/pr-review/SKILL.md` relative to the repo root; `${CLAUDE_PLUGIN_ROOT}`
won't resolve it, since it points inside `plugins/flowlever`), read it there for the fuller
methodology. A standalone plugin install won't have it, so don't depend on it: everything you
actually need is inlined below — spec-aware review methodology (§2's mandatory spec discovery),
auto-discovery of ticket/spec, and severity calibration (§3). The difference from the standalone
skill: findings go into a `pr-review` **workspace** so they're reviewed in the same stepper as
specs, and decisions are posted back as inline PR comments on **Apply**.

## Review scope (per-run instructions)
If the request carries `instructions` (the user's free-text scope/focus for this run, e.g. "front-end
only", "back-end only", "focus on the import validation"), treat them as the **review scope/focus**:
restrict or prioritize accordingly — review only the changed files in scope and say which you skipped, or
lead with the focus area. **Spec discovery (mandatory, below) still applies**, scoped to what's relevant.
State the applied scope explicitly in the run summary, and record it on the workspace so the cockpit shows
it: set `feature.reviewBrief` to the instruction (via a small node script using
`require("${CLAUDE_PLUGIN_ROOT}/app/src/ledger.js")` → `getFeature`/`saveFeature`). With no instructions,
review the whole diff as usual.

## 1. Resolve / create the workspace
- Input = a PR id or URL (ask if missing — don't guess).
- **Reuse an existing workspace for this PR when one exists** — this is what makes a re-review
  reconcile into the same ledger instead of forking a duplicate:
  1. If the request carries a `wsId` (the cockpit's "↻ Re-review" passes the workspace to re-run),
     use exactly that workspace.
  2. Otherwise list workspaces and reuse any whose id starts with `pr-<id>-`
     (`FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature list`).
  3. Only if none exists, create one with id `pr-<id>-<short-slug>` (e.g. `pr-482-checkout-api`):
     `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature add <wsId> --title "PR #<id> — <pr title>" --kind pr-review`
- Register sources: the PR, plus any auto-discovered ticket/spec, via `source add` (use `ado`/`confluence`).
- If the request carried `instructions`, persist them onto the workspace as `feature.reviewBrief` here.

> **When run from the cockpit queue (`/flowlever:watch`), emit phases as you go** so the job row shows
> live progress instead of an opaque spinner. With the request id as `<reqId>`:
> `requests set <reqId> --phase "<step>"` at each step below, AND — critically — flag `needsInput`
> *before* the first Azure DevOps fetch (it can pop a 2FA/auth prompt in another window), then clear it.
> Skip these `requests set` calls when invoked directly (no `<reqId>`).

## 2. Fetch + review (reuse /pr-review)
**Before the first ADO call** (may trigger 2FA/auth):
`requests set <reqId> --phase "fetching PR #<id> (may need your approval)" --needs-input --note "If a 2FA/auth prompt appears in another window, approve it to continue."`
Load the ADO MCP tools via ToolSearch, then exactly as `/pr-review`:
`repo_get_pull_request_by_id` (PR + linked work items), `repo_get_pull_request_changes` /
`repo_get_pull_request_threads` (diff + existing comments). **Once the first fetch succeeds, clear the
prompt:** `requests set <reqId> --no-needs-input --phase "fetching linked ticket/spec"`.

**MANDATORY spec discovery — do NOT skip (this is the whole point of a *spec-aware* review):**
1. Read the **linked work item** off the PR; fetch its Description + Acceptance Criteria.
2. **Scan the ticket Description/AC for every Confluence link** (`*.atlassian.net/wiki/...` incl. tiny
   `/wiki/x/<id>` links). Recurse one level into those pages for sub-spec links (contracts, matrices).
   Fetch each via `getConfluencePage`.
3. **Register every source you used as a workspace source** so the UI's Sources strip is complete and
   honest — the PR (`--type ado`), the ticket (`--type ado --itemType "User Story"`), and **each
   Confluence spec** (`--type confluence --id <pageId> --title "<page title>" --url "<url>"`). A
   code-only review with zero confluence sources is a FAILURE of this skill — if the ticket has spec
   links, they must be fetched AND registered.
4. If the ticket genuinely has no spec links, say so explicitly in the run summary (so "no specs" is a
   stated finding, never a silent omission).

Then `requests set <reqId> --phase "reviewing changes"` and run the spec-aware review: check the PR's
implementation against the fetched specs (contract/schema/column/AC compliance), not just code quality →
findings anchored to specific changed files + line ranges, with spec-mismatch findings citing the spec
locus (`confluence:<pageId>#<section>`).

## 3. Map findings → ingest shape

**Duplicate-comment detection (before ingesting):** compare every candidate finding against the
PR's **existing threads** (`repo_get_pull_request_threads` — other reviewers' comments AND your own
previously posted ones). Judge by substance, not wording:
- Existing thread already makes the point → **drop the finding** and list it in the run summary as
  `covered by <author>'s thread on <file:line>` — never open a parallel thread for the same point.
  If it is worth keeping visible in the cockpit (e.g. the user should still triage it), ingest it
  with **`duplicateOf`** set (`{ "label": "<author> on <file:line>", "url": "<deep link>" }` — deep
  link: `.../pullRequest/<prId>?discussionId=<threadId>`; the cockpit shows an amber DUPLICATE chip
  linking there) and `suggestion` = the generic
  `Duplicate of [<author>'s comment on <file:line>](<deep link>) — already being handled there.`
- Existing thread touches the point but you add something material (a failure case, a concrete fix
  they missed) → keep the finding, but give it locus **`pr:<id>:thread:<threadId>`** and write the
  suggestion as a **reply into that thread** that adds ONLY the increment (open with
  `Adding to <author>'s point:`), not a restatement. On Apply, a thread-locus finding posts via
  thread reply, not a new thread.
- Your own earlier findings are already reconciled by fingerprint — this check is about threads
  from OTHER surfaces (human reviewers, other tools).

For each review finding:
- `dimension`: reuse the existing set (correctness→`feasibility`/`consistency`, missing-thing→`completeness`,
  spec-mismatch→`consistency`, unclear→`ambiguity`, test gap→`testability`, DoR/process→`dor`,
  design→`design-match`). Severity per `/pr-review` calibration (blocker = must-fix before merge).
- `title`: stable one-line. `detail`: what's wrong + why, quoting the relevant diff hunk.
- `locus`: **`pr:<id>:<path>:L<line>`** (or `L<start>-<end>`). The line is the **new-file (right-side)
  line number of the exact code the comment is about**, read from the diff (`@@ … +<start>,<count> @@`
  counting down the new side) — never eyeballed/estimated. Point at the line whose content matches the
  snippet you quote in the body, not a nearby JSDoc/blank line. Stable loci = stable fingerprints across
  re-reviews (the diff moves — same reconcile model as spec re-audit).
- `suggestion`: **the proposed PR comment body — it IS what gets posted, so write it as a
  [Conventional Comment](https://conventionalcomments.org/)**: start with a label, then the concrete fix.
  Format: `<label>[ (blocking)]: <body>` (lowercase label, colon, space). Labels:
  - `issue` — a problem in the code (add `(blocking)` when it must be fixed before merge, i.e. severity blocker).
  - `suggestion` — a concrete change that isn't strictly required.
  - `question` — something the author must clarify/answer.
  - `nitpick` — trivial, non-blocking preference (style/naming/wording).
  - (also valid when they fit: `praise`, `thought`, `chore`.)
  Map from severity/dimension: blocker→`issue (blocking)`, major→`issue`, a proposed improvement→`suggestion`,
  `ambiguity`→`question`, minor style→`nitpick`. Examples:
  `issue (blocking): Cap retries — `if (retryCount >= MAX_RETRIES) return;` — or a persistently failing endpoint retries forever.`
  · `nitpick: rename `buf` → `baseBuffer` to match the deployed FTD field name.`
Where you have a concrete code change, attach a **draft** so it shows as a red/green diff in the stepper:
`setFindingDraft(wsId, fp, { target: "<path>:L<line>", format: "text", before: "<current code>", after: "<suggested code>" })`
(via a small node script using `require("${CLAUDE_PLUGIN_ROOT}/app/src/ledger.js")`, or a future CLI cmd).
Dedup near-duplicates, then (`requests set <reqId> --phase "ingesting findings"`) ingest:
`FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" ingest <wsId> --file <findings.json> --note "PR #<id> review @ <commit/iteration>"`.

**Then stamp the PR's activity clock** — you just read the PR, so you know when the author last
touched it. Record the newest author comment / pushed iteration:
```
... cli.js feature activity <wsId> --at "<ISO ts of the author's newest update>" --by "<author>"
```
The ingest itself is the "Reviewed <when>" side of the cockpit's stamp pair (a round IS a review
pass); this is the "PR updated <when>" side. Stamping it here means the workspace reads correctly
the moment the review lands, instead of waiting for the next poll pass. Omit it only if the PR
genuinely has no author activity to point at.

The runner then marks the request `done --phase "review ready" --wsId <wsId>`.

## 4. Hand to the cockpit
Tell the user to open **Home → PR Review → this workspace** (or `/flowlever:start`) and step through:
each finding shows the diff + decision row (Accept · Edit · Redirect · Waive · Skip). Decisions persist.

## 5. Apply (post comments back) — explicit confirmation required
When run as an `apply` request, emit phases too: `--phase "posting comments (may need your approval)"
--needs-input --note "Approve the auth prompt in your other window if asked."` before the first post,
clear it after, then `--status done --phase "posted to PR"`.
When the user has reviewed and asks to post: read their decisions
(`FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" finding list <wsId> --json` → use each finding's status + `draft.review` verdict/edited
text, or the exported work order). For every **accepted/edited** finding (skip rejected/waived), post an
inline PR comment via `repo_create_pull_request_thread` (use the user's edited text if present, else the
suggestion) — EXCEPT findings whose locus is `pr:<id>:thread:<threadId>` (duplicate-increment findings):
those post as a **reply into that existing thread**, never a new one. **Never post without an explicit
yes.**

**AI disclosure line — honor the request's `instructions`.** The cockpit's Post button carries a
disclosure toggle (default ON) as `instructions` on the apply request:
- `disclosure: append …` (or no instructions at all) → append `🤖 AI comment posted by Claude` as
  the **last line** of every posted comment, separated by a blank line.
- `disclosure: off` → post the reviewed text verbatim.
Beyond that one line, add NOTHING else — no other signature, attribution, or footer (no
"_AI-generated…_", "🤖 Generated with…", "Posted via FlowLever"). The body is exactly the finding's
suggestion or the user's edited text (+ the disclosure line when on).

### Anchoring — get the line right (this is what makes a comment land on the code it's about)
A finding's `locus` line is a *hint*; **verify it against the live diff before posting**, because an
off-by-N or old-vs-new-file line lands the comment on unrelated code (e.g. a JSDoc block instead of the
call it discusses). For each finding:
1. Re-fetch the latest diff once: `repo_get_pull_request_changes` (includeLineContent:true). For the
   finding's file, find the line whose **content actually matches the code the comment cites** (the
   symbol/snippet quoted in the body) — don't trust the stored number blindly.
2. Anchor to that line in the **RIGHT (new) file**, 1-based: pass `rightFileStartLine` (and
   `rightFileEndLine` to span a multi-line snippet; add `rightFileStartOffset`/`rightFileEndOffset` only
   if you need a sub-line span). ADO line numbers are the new-file lines, NOT the old-file or the diff's
   visual row.
3. The cited code is a **deleted** line (only in the old file)? ADO can't right-anchor a pure deletion —
   anchor to the nearest surviving new-file line (usually the replacement) and name the removed code in the
   body, or post it as a file-level thread (`filePath` only, no line) if there's no sensible line.
4. After posting, sanity-check the returned thread's `rightFileStart.line` matches your intended line;
   surface any that fell back to file-level so the user knows.
### Stamping is not optional — you are the ONLY thing that can confirm a post
**The cockpit cannot stamp a post; only you can.** When the user clicks Post, the UI sets a transient
`pending: "post"` marker (the "Posting…" lane) and enqueues the `apply` request — nothing more. The
`postedAt` stamp exists exactly once: when *you* record it after ADO accepted the comment. So:

**Stamp each finding the moment its comment lands — one call per finding, immediately after the
`repo_create_pull_request_thread` for it succeeds. Never batch this to the end of the run.**
```
FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" finding posted <wsId> --fps <fp>
```
Batching is what strands work: if the session dies, 2FA times out, or an ADO call fails halfway, every
comment you already posted is left marked "Posting…" forever — the cockpit shows in-flight work that
will never resolve while the comments are actually sitting on the PR. Per-finding stamping makes any
interruption leave a truthful partial state instead.

A posted finding stays `reworking` but is stamped `postedAt` → it moves to the cockpit's **"Posted —
awaiting author"** lane, stops being re-counted as "to review", and no longer drags the readiness score
down. Do **not** set posted comments to `resolved` — that would hide them from the re-review reconcile.

**Before posting anything, check what is already there (resume-safe / no double posts).** A finding
marked `pending: "post"` with no `postedAt` means a previous attempt was interrupted — it does NOT tell
you whether the comment made it. List the PR's threads first
(`repo_pull_request_thread action:list`) and compare against the findings you are about to post:
- a thread whose body already matches the finding's comment (same anchor + text, authored by you) →
  **do not post again**; just stamp it (`finding posted <wsId> --fps <fp>`) — the write did happen,
  only the stamp was lost.
- no matching thread → post it normally, then stamp.
Skipping this check is how a retried apply ends up posting the same comment twice.

**If the apply fails or you abandon it, release what you did NOT post** — otherwise those findings stay
stuck in the "Posting…" lane with no way back:
```
... cli.js finding cancel <wsId> --fps <fp>[,<fp>...] --reason "post failed: <short reason>"
... cli.js requests set <reqId> --status error --note "<short reason>"
```
(`finding cancel` with no `--fps` releases every still-pending finding in the workspace. It never
touches ones already stamped `postedAt`, so it is safe to run after a partial success.)

## 6. Re-review (after the author responds) — same reconcile loop as specs
When the author has replied or pushed new commits, **re-run this exact skill against the SAME `<wsId>`**
(the cockpit's "↻ Re-review" button on the `(re-run)` stage enqueues a fresh `pr-review` request for the
same PR; `/flowlever:watch` then runs this skill again). Re-fetch the PR diff + threads, re-run the
spec-aware review, and re-`ingest` into the same workspace. Reconciliation does the rest, keyed on the
stable `pr:<id>:<path>:L<line>` loci:
- a posted finding the author **addressed** drops out of the new set → **auto-resolves** (moves to Resolved);
- one **still flagged** stays (its `postedAt` and lane are preserved);
- anything **new** is inserted as `open` for a fresh triage pass.
The reviewer can also close a posted finding manually at any time from the board (Mark resolved / Reopen /
Dismiss) when no author response is needed.
