---
name: audit
description: >
  Run a spec-readiness audit for a feature across its Confluence spec, Azure DevOps
  work items, and Figma designs, then ingest the findings into the FlowLever ledger.
  Use when the user says "audit feature X", "/flowlever:audit", "validate the spec for X",
  "is X ready for implementation", "check spec readiness", or shares a Confluence/ADO/Figma
  link and asks whether it's consistent / complete / ready to build.
---

# /flowlever:audit — spec-readiness audit

You are the audit engine of **FlowLever** (a local review cockpit; see
`${CLAUDE_PLUGIN_ROOT}/app/README.md` and `${CLAUDE_PLUGIN_ROOT}/app/docs/SCHEMA.md`). Your
job: fetch a feature's real sources via MCP, run a
7-dimension validation, and ingest findings into the fingerprinted ledger so they are
tracked across rounds. **You never mutate Confluence/ADO/Figma in this skill — read only.**

## 0. Preconditions
The commands below are self-contained: the bundled app lives at `${CLAUDE_PLUGIN_ROOT}/app`,
and ledger data lives per-user in `~/.flowlever` (override via `FLOWLEVER_DATA`, shared across
repos). All ledger state changes go through the CLI so reconciliation/scoring stay consistent.

## 1. Resolve the feature
- The argument is a `featureId` (kebab-case). Run `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature list --json`.
- If it exists, read `${FLOWLEVER_DATA:-$HOME/.flowlever}/features/<id>.json` for its `sources` and `specSections`.
- If it does NOT exist: create it with `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature add <id> --title "..."`,
  then add its sources. Discover sources from the user's message (Confluence/ADO/Figma URLs)
  and register each:
  - `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" source add <id> --type confluence --id <pageId> --title "..." --url "<url>"`
  - `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" source add <id> --type ado --id <workItemId> --title "..." --url "<url>"` (work item type via `--itemType "User Story"` if available)
  - `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" source add <id> --type figma --fileKey <key> --nodeId <node> --title "..." --url "<url>"`
  - If you cannot determine sources, ask the user for the spec page, the work item IDs, and the Figma file/frame — then proceed.

## 2. Fetch all sources (READ ONLY) via MCP
Load the MCP tools you need with ToolSearch first (they are deferred), then fetch. Never let
one failed fetch abort the whole audit — record what you couldn't read and continue.

- **Confluence** (`mcp__claude_ai_Atlassian_Rovo__*`): resolve the cloudId from the page URL
  host (e.g. `uniccom.atlassian.net`), then `getConfluencePage` (body + `version`). Use
  `searchConfluenceUsingCql` if you only have a title.
- **Azure DevOps** (`mcp__azure-devops__*`): `wit_get_work_items_batch_by_ids` (or
  `wit_get_work_item`) for the work items — capture Description, Acceptance Criteria, State,
  and relations. `wit_list_work_item_comments` if AC lives in discussion. The org here is
  `FZAG`; the DXP project id is `c026630b-a803-4b06-9a1a-77db52707d9c`.
- **Figma** (`mcp__claude_ai_Figma__*`): `get_metadata` for the frame tree and
  `get_screenshot` for the actual visuals of the relevant nodeIds.

## 3. Refresh the spec outline (`specSections`)
Parse the Confluence page headings into a stable outline. Slugify each heading to a `key`
(lowercase, hyphenated, **stable across runs** — don't renumber). Update the feature file's
`specSections` array. If no CLI command exists for this, edit `${FLOWLEVER_DATA:-$HOME/.flowlever}/features/<id>.json`
directly with the Edit tool (it is plain JSON; keep the schema in `docs/SCHEMA.md`).
Stable section keys matter — the coverage matrix and finding loci depend on them.

## 4. Run the 7-dimension audit
If the user has opted into swarms/workflows, fan out one subagent **per dimension** in
parallel, each given the fetched source material and instructed to return findings in the
exact **ingest shape** (below). Otherwise analyze the dimensions inline, sequentially.

Each finding is JSON of this shape (no `fp` — the CLI computes it):
```json
{ "dimension": "...", "severity": "blocker|major|minor|info",
  "title": "stable, deterministic one-liner",
  "detail": "what's wrong and why it matters",
  "locus": "confluence:<id>#<sectionKey>  | ado:<id> | figma:<fileKey>:<nodeId>  (vs-joined for cross-source)",
  "suggestion": "the concrete fix" }
```

**Severity calibration:**
- `blocker` — implementation would be built wrong or get stuck (contradiction, missing core flow, undecided scope).
- `major` — real rework needed but not blocking (missing ACs, untestable goal, design/spec divergence).
- `minor` — polish / clarity (ambiguous wording, missing analytics event).
- `info` — observation, no action required.

**Locus + title discipline (this is what makes findings durable):** phrase titles
*deterministically* — no dates, no fluctuating counts ("lists 4 methods" → "payment methods
differ between spec and work item"). Use stable loci. Same underlying issue across rounds →
same fingerprint → the ledger tracks it instead of duplicating it.

### Dimensions (what each hunts for, with examples)
1. **consistency** — contradictions *between* sources. *e.g.* "Payment methods differ between
   spec and work item" (`confluence:982341#payment-methods vs ado:42696`); "Rollout percentages
   differ between spec and task".
2. **completeness** — gaps: missing acceptance criteria, unhandled edge cases, an absent
   error/empty/loading state. *e.g.* "Guest checkout story has no acceptance criteria" (`ado:42695`).
3. **testability** — statements QA cannot verify. *e.g.* "Fast checkout requirement is not
   measurable"; "Abandonment metric lacks a definition window".
4. **design-match** — spec ↔ Figma divergence. *e.g.* "Design shows saved-address picker not
   described in spec"; "No design frame for error handling section".
5. **dor** — Definition of Ready checklist failures (no AC, no owner, no estimate, unclear value).
6. **ambiguity** — multi-interpretable wording. *e.g.* "Email capture timing is ambiguous".
7. **feasibility** — technical risk / unbudgeted work. *e.g.* "Twint requires server-side
   webhook not budgeted" (`ado:42696`).

## 5. Dedup across dimensions
Before ingest, merge near-duplicate findings that describe the same underlying issue (keep
the highest severity; merge their loci). Two dimensions flagging the same contradiction = one
finding, not two.

## 6. Coverage matrix
Build `coverage[]` mapping each spec section to the ADO items and Figma frames that realize
it, with a `status` of `covered | partial | uncovered | orphan` (orphan = a work item/design
with no matching section, `sectionKey: null`). Apply it:
`FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" coverage set <id> --file coverage.json`.

## 7. Ingest the round
Write the deduped findings array to a temp file and run:
```
FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" ingest <id> --file <tmp.json> --note "<one-line summary of this audit>"
```
Do **not** pass `--reopen-resolved` unless the user explicitly wants to re-litigate closed
findings. The CLI reconciles automatically: new findings inserted, still-open refreshed,
fixed ones auto-resolved, and any **regression** (a resolved/waived finding that reappeared)
surfaced in the round stats.

## 8. Report
Print the round stats (new / auto-resolved / **regressions** / total open) prominently, then
`FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" readiness <id>` for score + gate + blockers. If there are regressions, call
them out loudly — a fixed thing came back. End by recommending the next step:
- open blockers/majors → **`/flowlever:rework`**
- gate `ready` → **`/flowlever:brief`**
Mention the dashboard: `node "${CLAUDE_PLUGIN_ROOT}/app/src/server.js"` → http://localhost:4173.
