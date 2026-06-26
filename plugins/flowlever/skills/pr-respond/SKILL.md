---
name: pr-respond
description: >
  Load the reviewer feedback on YOUR Azure DevOps pull request into the FlowLever cockpit as a
  `pr-respond` workspace: pull the comment threads that await your response, ingest each as a finding
  with a proposed reply/fix, so you can step through and decide thread-by-thread in the same review UI —
  then post the replies (and apply code fixes) back. Use when the user says "respond to PR X in the
  cockpit", "load my PR threads into flowlever", "/flowlever:pr-respond X", or "work through PR X feedback".
  For a plain interactive/one-shot response without the cockpit, use the standalone `/pr-respond` skill.
---

# /flowlever:pr-respond — respond to PR feedback, in the cockpit

Bridges the existing `/pr-respond` skill into the cockpit. The **fetch + thread-triage is identical to
`/pr-respond`** (read it at `~/development/agentic-kit/skills/pr-respond/SKILL.md`: how it finds threads
awaiting the author's response and reads the current code at each anchor). The difference: each thread
becomes a finding in a `pr-respond` **workspace**, reviewed in the same stepper, and your decisions are
posted as replies / applied as code fixes on **Apply**.

## Review scope (per-run instructions)
If the request carries `instructions` (the user's free-text scope/focus for this run, e.g. "front-end
only", "focus on the import validation"), treat them as the **review scope/focus**: restrict or
prioritize the threads you work accordingly — handle only threads anchored to in-scope files and say which
you skipped, or lead with the focus area. **Spec discovery (mandatory) still applies**, scoped to what's
relevant. State the applied scope in the run summary, and record it on the workspace by setting
`feature.reviewBrief` to the instruction (via a small node script using
`require("${CLAUDE_PLUGIN_ROOT}/app/src/ledger.js")` → `getFeature`/`saveFeature`). With no instructions,
work all threads awaiting your reply as usual.

## 1. Resolve / create the workspace
- Input = a PR id/URL, or auto-detect from the current git branch (as `/pr-respond` does). Ask if unclear.
- Workspace id `pr-<id>-<short-slug>`, `--kind pr-respond`:
  `FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature add <wsId> --title "PR #<id> — <pr title> (your PR)" --kind pr-respond`
- Register the PR as a source.
- If the request carried `instructions`, persist them onto the workspace as `feature.reviewBrief` here.

> **When run from the cockpit queue (`/flowlever:watch`), emit phases** with the request id `<reqId>`:
> `requests set <reqId> --phase "<step>"` at each step, and flag `needsInput` *before* the first Azure
> DevOps fetch (it can pop a 2FA/auth prompt in another window), then clear it once unblocked. Skip these
> calls when invoked directly (no `<reqId>`).

## 2. Fetch the threads needing a response (reuse /pr-respond)
**Before the first ADO call** (may trigger 2FA/auth):
`requests set <reqId> --phase "fetching reviewer threads (may need your approval)" --needs-input --note "If a 2FA/auth prompt appears in another window, approve it to continue."`
Via the ADO MCP: `repo_list_pull_request_threads` → filter to **active** threads whose latest comment is
**not** from you (i.e. awaiting your response). **Clear the prompt after the first fetch succeeds:**
`requests set <reqId> --no-needs-input --phase "reading code at thread anchors"`. Read the current code at
each thread's anchor so the proposed response reflects the latest state.

## 3. Map threads → ingest shape
Each thread → one finding:
- `title`: the reviewer's ask, one line. `detail`: the reviewer comment(s) + the current code at the anchor.
- `locus`: **`pr:<id>:thread:<threadId>`** (stable across re-runs).
- `dimension`: best-fit from the existing set; `severity`: how blocking the reviewer's ask is.
- Attach a **draft** representing your proposed response: for a code change, `before`/`after` = the anchored
  code → its fix; for a reply-only, put the drafted reply text in `after` with `before` empty (renders as
  an additive diff). Use `setFindingDraft(wsId, fp, {...})`. (`requests set <reqId> --phase "drafting replies"`)
Then (`requests set <reqId> --phase "ingesting threads"`) ingest:
`FLOWLEVER_DATA="${FLOWLEVER_DATA:-$HOME/.flowlever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" ingest <wsId> --file <findings.json> --note "PR #<id> open threads @ <iteration>"`.
The runner then marks the request `done --phase "threads ready" --wsId <wsId>`.

## 4. Hand to the cockpit
Open **Home → PR Respond → this workspace**. Step through each thread; the decision row maps to the
`/pr-respond` actions:
- **Accept** = apply the proposed fix/reply as drafted · **Edit** = adjust the reply/fix ·
  **Redirect/Reject + note** = push back (explain why) · **Waive** = defer/won't-address (reason) ·
  **Skip** = decide later. Decisions persist.

## 5. Apply (post replies / code fixes) — explicit confirmation required
When run as an `apply` request, emit phases: `--phase "posting replies (may need your approval)"
--needs-input --note "Approve the auth prompt in your other window if asked."` before the first post,
clear it after, then `--status done --phase "posted to PR"`.
When the user asks to post: read decisions (`finding list <wsId> --json` + each `draft.review`). Then,
**only on an explicit yes**, per thread: post the reply via `repo_reply_to_comment` (using the edited text
if present), and for accepted code fixes apply the edit to the working tree (Edit/Write) for the user to
commit. Push-backs post the user's note as the reply. **Post the reply text verbatim — never append a
disclosure/attribution/AI footer** (no "_AI-generated_", "🤖 Generated with…", or similar). After
posting, set those findings → `reworking`.
A re-run reconciles as the reviewer responds again — same loop.
