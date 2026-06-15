---
name: pr-respond
description: >
  Load the reviewer feedback on YOUR Azure DevOps pull request into the SpecLever cockpit as a
  `pr-respond` workspace: pull the comment threads that await your response, ingest each as a finding
  with a proposed reply/fix, so you can step through and decide thread-by-thread in the same review UI —
  then post the replies (and apply code fixes) back. Use when the user says "respond to PR X in the
  cockpit", "load my PR threads into speclever", "/speclever:pr-respond X", or "work through PR X feedback".
  For a plain interactive/one-shot response without the cockpit, use the standalone `/pr-respond` skill.
---

# /speclever:pr-respond — respond to PR feedback, in the cockpit

Bridges the existing `/pr-respond` skill into the cockpit. The **fetch + thread-triage is identical to
`/pr-respond`** (read it at `~/development/agentic-kit/skills/pr-respond/SKILL.md`: how it finds threads
awaiting the author's response and reads the current code at each anchor). The difference: each thread
becomes a finding in a `pr-respond` **workspace**, reviewed in the same stepper, and your decisions are
posted as replies / applied as code fixes on **Apply**.

## 1. Resolve / create the workspace
- Input = a PR id/URL, or auto-detect from the current git branch (as `/pr-respond` does). Ask if unclear.
- Workspace id `pr-<id>-<short-slug>`, `--kind pr-respond`:
  `SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" feature add <wsId> --title "PR #<id> — <pr title> (your PR)" --kind pr-respond`
- Register the PR as a source.

## 2. Fetch the threads needing a response (reuse /pr-respond)
Via the ADO MCP: `repo_list_pull_request_threads` → filter to **active** threads whose latest comment is
**not** from you (i.e. awaiting your response). Read the current code at each thread's anchor so the
proposed response reflects the latest state.

## 3. Map threads → ingest shape
Each thread → one finding:
- `title`: the reviewer's ask, one line. `detail`: the reviewer comment(s) + the current code at the anchor.
- `locus`: **`pr:<id>:thread:<threadId>`** (stable across re-runs).
- `dimension`: best-fit from the existing set; `severity`: how blocking the reviewer's ask is.
- Attach a **draft** representing your proposed response: for a code change, `before`/`after` = the anchored
  code → its fix; for a reply-only, put the drafted reply text in `after` with `before` empty (renders as
  an additive diff). Use `setFindingDraft(wsId, fp, {...})`.
Ingest: `SPECLEVER_DATA="${SPECLEVER_DATA:-$HOME/.speclever}" node "${CLAUDE_PLUGIN_ROOT}/app/src/cli.js" ingest <wsId> --file <findings.json> --note "PR #<id> open threads @ <iteration>"`.

## 4. Hand to the cockpit
Open **Home → PR Respond → this workspace**. Step through each thread; the decision row maps to the
`/pr-respond` actions:
- **Accept** = apply the proposed fix/reply as drafted · **Edit** = adjust the reply/fix ·
  **Redirect/Reject + note** = push back (explain why) · **Waive** = defer/won't-address (reason) ·
  **Skip** = decide later. Decisions persist.

## 5. Apply (post replies / code fixes) — explicit confirmation required
When the user asks to post: read decisions (`finding list <wsId> --json` + each `draft.review`). Then,
**only on an explicit yes**, per thread: post the reply via `repo_reply_to_comment` (using the edited text
if present), and for accepted code fixes apply the edit to the working tree (Edit/Write) for the user to
commit. Push-backs post the user's note as the reply. After posting, set those findings → `reworking`.
A re-run reconciles as the reviewer responds again — same loop.
