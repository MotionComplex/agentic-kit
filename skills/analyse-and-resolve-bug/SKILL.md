---
name: analyse-and-resolve-bug
description: >
  Investigates an Azure DevOps work item (a bug, or a user story carrying a grid/table of QA
  observations) and decides what to do with it: validate whether it is a reasonable, well-formed
  ticket; verify each reported symptom against the actual codebase to find the real root cause;
  then either fix it on a correctly-named feature branch with tests + verification, or report the
  next steps (close as by-design, raise separate bugs per grid row, or list clarifying questions).
  Use this skill when the user shares a work item / bug URL and asks things like "check this bug",
  "does this ticket make sense", "is this a reasonable bug", "analyse these QA observations",
  "look at this work item and fix it or tell me the next steps", or "what's the issue here".
compatibility: "Requires Azure DevOps MCP (work items + repo/PR access) and a local checkout of the referenced repo. Pairs with /context-brief (context fetching) and /pr-review (review of the resulting PR). Branch/commit conventions live in ~/dev/agentic-kit/conventions/azure-devops.md."
---

# Analyse-and-Resolve-Bug Skill

Takes an Azure DevOps work item — often a bug, or a user story whose **QA-observation grid** (an
HTML table of "Observation | Comment" rows) has been triaged into individual issues — and walks it
from "here is a reported problem" to either a verified fix or a clear set of next steps.

The defining trait of this workflow: **never trust the ticket at face value.** A reported symptom
is a hypothesis. The skill confirms it against the real code, separates genuine bugs from
by-design behaviour and spec gaps, and only then acts.

---

## When to use this skill

Trigger when the user points at a work item (bug or story) and wants it understood, validated, or
acted on. Examples:

- "Check the bug: <ADO url>. Does it make sense? What's the issue?"
- "Is this a reasonable bug-ticket?"
- "Analyse this user story's QA observations and tell me which are real."
- "Look at this and fix it on a new branch, or tell me the next steps."

If the user only wants raw context pasted with no analysis, prefer `/context-brief`. If they want
a PR reviewed, use `/pr-review`. This skill is the investigate → decide → fix/report loop.

---

## Inputs

| Input | Required | Forms |
|---|---|---|
| Work item reference | **Yes** | Bug/story ID (e.g. `42648`) or full ADO work item URL |
| Specific observation | No | A single row of a QA grid, or "all of them" |
| Repo / base branch | No — inferred | Defaults to the current checkout; base branch inferred from context |

If no work item reference is given, ask for it. Do not guess an ID.

---

## Phase 1 — Fetch & understand

1. Resolve the work item ID from the URL/number. Fetch it via the Azure DevOps MCP
   (`wit_get_work_item` with `expand: "all"` so you get fields **and** relations).
2. Read the meaningful fields: `System.Title`, `Microsoft.VSTS.TCM.ReproSteps` (bugs),
   `System.Description` + `Microsoft.VSTS.Common.AcceptanceCriteria` (stories), `System.History`,
   severity/priority, area/iteration, tags, state.
3. **Follow the links.** Bugs usually link a parent/related **user story** that holds the real
   acceptance criteria and the QA-observation grid. Fetch related/parent items too. The story's
   AC is the source of truth for "expected behaviour"; the bug is just one observed deviation.
4. **Parse the grid.** When a story's `History`/`ReproSteps`/`AcceptanceCriteria` contains an HTML
   table of QA observations, extract each row as a separate `{ observation, comment, status }`
   triple. Note which rows were already raised as bugs, fixed, or confirmed-as-expected — the
   comment column usually says (e.g. "Jacek: Raised a bug #42648", "Confirmed with Corrine that
   correct behavior"). The row(s) tied to the current ticket are your focus.
5. If a Confluence spec is linked, fetch it (or invoke `/context-brief`) when the AC alone is
   ambiguous.

Output a short, plain-language restatement of what each symptom claims and what the spec says the
behaviour should be. Do not start verifying until the claim and the expectation are both clear.

---

## Phase 2 — Validate the ticket quality

Before touching code, judge whether it is a **reasonable, well-formed ticket**:

- Clear repro steps? Stated environment? Concrete actual-vs-expected? Sensible severity/priority?
- Correctly linked to its parent story / AC?
- For grids: are distinct symptoms split out, or conflated into one row?

Call out weaknesses plainly (e.g. "the title states the symptom as if it were the cause", "the
Expected Result is a copy-paste artifact"). These are cosmetic notes, not blockers — but they help
the author and they shape how you scope the fix. If two symptoms share one root cause, say so and
treat them as one bug.

---

## Phase 3 — Verify against the codebase

This is the heart of the skill. For each symptom:

1. Search the repo for the relevant code (event names, field names, component names from the
   ticket — e.g. `page_view`, `page_initial_load`). Locate the implementation, not just tests.
2. Read the actual implementation and trace the execution path. Reproduce the bug **by reasoning**
   through the code (timing, ordering, gating, async hydration are common culprits).
3. Tie the conclusion to specific `file:line` references — clickable, concrete.
4. Classify the symptom:
   - **Real bug** — the code genuinely deviates from the spec. Find the *root cause*, not just the
     surface symptom (e.g. "the initial event fires before consent hydrates and is never retried",
     not "the flag is always false").
   - **By design** — the behaviour is intentional and correct (often documented in a comment). Do
     not "fix" it. Explain why, and reference the design intent.
   - **Spec gap / needs product input** — behaviour is ambiguous or the spec contradicts the
     report. Flag for clarification.
5. When the behaviour has legal/compliance/security implications (e.g. GDPR consent gating), reason
   about those explicitly before proposing a change — the "fix" must not break the constraint.

If you delegate the search, keep the conclusion and the `file:line` anchors, not the file dumps.

---

## Phase 4 — Decide the next step

State a recommendation per symptom:

- **Fix now** → proceed to Phase 5.
- **By design / not a bug** → recommend closing with the explanation; offer to post it as a comment.
- **Needs clarification** → list the specific questions for the PO/QA; offer to post them.
- **Real but out of scope / separate concern** → recommend raising a distinct bug (and note any
  unrelated issues you spotted, like a duplicated script include).

Then ask the user how to proceed if it isn't already obvious. Do **not** silently start editing.

---

## Phase 5 — Fix (only once fixing is agreed)

**Branch.** Follow the house convention (see `~/dev/agentic-kit/conventions/azure-devops.md`):

- Name: `feature/<ticket-number>-<kebab-descriptive-title>`.
- Branch **off the release branch** when the work is release-bound (e.g. `release/3.2`), not off
  `develop`. Confirm the base branch if it isn't obvious.
- When a bug and its parent story both have numbers, **ask which number** belongs in the branch
  name — they are awkward to rename later. Default suggestion: the bug number for a bug fix.

**Implement.**

- Make the **minimal** change that addresses the root cause. Match the surrounding code's idiom,
  naming, and comment density.
- Preserve intentional behaviour the tests/comments document (e.g. a referrer chain that advances
  even on denied consent). Re-read such tests before changing shared helpers.
- Add or adapt **tests** that capture the regression — both the failing-before scenario and the
  fixed-after behaviour, plus the edge cases (e.g. "never fires when consent is never granted").

**Verify.**

- Run the targeted test suites (`jest <pattern>` or the repo's equivalent).
- Typecheck (`tsc --noEmit`) and lint (`eslint <changed files>`) the changed files.
- Report results faithfully. If something fails, say so with the output.

---

## Phase 6 — Wrap up

Summarise: root cause, what the fix does, and the verification results (tests passing, typecheck +
lint clean). Reference the changed files.

**Do not commit or push until the user asks.** When they do:

- Stage only the relevant files (skip build artifacts like `tsconfig.tsbuildinfo`).
- Commit message: `fix [<id>]: <summary>` (bare ADO work-item number — never a `DXPSM-` prefix,
  that's the Confluence service-management project) with a body explaining the root cause and the fix,
  ending with the `Co-Authored-By` trailer the environment specifies.
- Push the feature branch with `-u origin <branch>`.
- Offer to open the PR, and ask the target (`release/3.2` if release-bound, else `develop`); link
  it to the bug and parent story.

---

## Pitfalls

- **Treating the symptom as the cause.** "Flag is always false" is the symptom; "the only events
  that survive the gate are the ones that set it false" is the cause. Dig to the cause.
- **Fixing by-design behaviour.** Always check for a comment explaining intent before changing it.
- **Backtracking / replay concerns.** When a fix re-emits a previously-dropped event, verify it
  generates a *fresh* event from current state rather than flushing buffered pre-consent data —
  the latter can be a compliance violation.
- **Committing too early.** Investigation and fixing are separate from publishing. Wait for the go.
- **Conflating grid rows.** Each QA observation may be a different root cause (or a duplicate of
  another). Triage them individually before deciding.
