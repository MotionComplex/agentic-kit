---
name: pr-review
description: >
  Load an Azure DevOps pull request into the SpecLever cockpit as a `pr-review` workspace: fetch the
  PR diff + spec/ticket, produce review findings anchored to file:line, and ingest them so you can
  step through and decide each one in the same review UI as specs — then post the kept comments back
  to the PR. Use when the user says "review PR X in the cockpit", "load PR X into speclever",
  "/speclever:pr-review X", or "PR review X with the stepper". For a plain markdown/interactive review
  without the cockpit, use the standalone `/pr-review` skill instead.
---

# /speclever:pr-review — PR review, in the cockpit

Bridges the existing `/pr-review` skill into the SpecLever review cockpit. The **fetch + analysis is
identical to `/pr-review`** (read that skill at `~/development/agentic-kit/skills/pr-review/SKILL.md`
for the spec-aware review methodology, auto-discovery of ticket/spec, and severity calibration). The
difference: findings go into a `pr-review` **workspace** so they're reviewed in the same stepper as
specs, and decisions are posted back as inline PR comments on **Apply**.

## 1. Resolve / create the workspace
- Input = a PR id or URL (ask if missing — don't guess).
- Workspace id `pr-<id>-<short-slug>` (e.g. `pr-482-checkout-api`). If absent:
  `SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature add <wsId> --title "PR #<id> — <pr title>" --kind pr-review`
- Register sources: the PR, plus any auto-discovered ticket/spec, via `source add` (use `ado`/`confluence`).

## 2. Fetch + review (reuse /pr-review)
Load the ADO MCP tools via ToolSearch, then exactly as `/pr-review`:
`repo_get_pull_request_by_id` (PR + linked work items), `repo_get_pull_request_changes` /
`repo_get_pull_request_threads` (diff + existing comments). Auto-discover + fetch the ticket and
Confluence spec. Run the spec-aware review → findings anchored to specific changed files + line ranges.

## 3. Map findings → ingest shape
For each review finding:
- `dimension`: reuse the existing set (correctness→`feasibility`/`consistency`, missing-thing→`completeness`,
  spec-mismatch→`consistency`, unclear→`ambiguity`, test gap→`testability`, DoR/process→`dor`,
  design→`design-match`). Severity per `/pr-review` calibration (blocker = must-fix before merge).
- `title`: stable one-line. `detail`: what's wrong + why, quoting the relevant diff hunk.
- `locus`: **`pr:<id>:<path>:L<line>`** (or `L<start>-<end>`). Stable loci = stable fingerprints across
  re-reviews (the diff moves — same reconcile model as spec re-audit).
- `suggestion`: the concrete fix.
Where you have a concrete code change, attach a **draft** so it shows as a red/green diff in the stepper:
`setFindingDraft(wsId, fp, { target: "<path>:L<line>", format: "text", before: "<current code>", after: "<suggested code>" })`
(via a small node script using `require("${CLAUDE_PLUGIN_ROOT}/app/src/ledger.js")`, or a future CLI cmd).
Dedup near-duplicates, then ingest:
`SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" ingest <wsId> --file <findings.json> --note "PR #<id> review @ <commit/iteration>"`.

## 4. Hand to the cockpit
Tell the user to open **Home → PR Review → this workspace** (or `/speclever:start`) and step through:
each finding shows the diff + decision row (Accept · Edit · Redirect · Waive · Skip). Decisions persist.

## 5. Apply (post comments back) — explicit confirmation required
When the user has reviewed and asks to post: read their decisions
(`SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" finding list <wsId> --json` → use each finding's status + `draft.review` verdict/edited
text, or the exported work order). For every **accepted/edited** finding (skip rejected/waived), post an
inline PR comment anchored to the finding's file:line via `repo_create_pull_request_thread`
(use the user's edited text if present, else the suggestion). **Never post without an explicit yes.**
After posting, set those findings → `reworking`. A later `/speclever:pr-review` re-run reconciles (resolved
comments drop off, new ones appear) — same loop as specs.
