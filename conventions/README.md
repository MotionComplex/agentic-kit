# Conventions

Personal staging area for conventions I want Claude (and my teammates) to follow. Each file
is a draft I refine over time. When mature, the convention is copied into the relevant team
repo's `docs/conventions/` or `CLAUDE.md` (see `../templates/docs-conventions/` for promotion
templates).

## Index

| File | Topic | Status |
|---|---|---|
| [code-review.md](code-review.md) | Code review comment style (Conventional Comments) | draft — used personally |
| [azure-devops.md](azure-devops.md) | Azure DevOps PR/work-item conventions | draft — partial (mention syntax unresolved) |

## Status meanings
- **draft** — written, in personal use, not yet shared with the team.
- **proposed** — shared with team, awaiting feedback.
- **adopted** — accepted by the team, copy lives in the team repo. Keep this file as a mirror
  or shrink it to a pointer.

## Adding a new convention

1. Add an entry to [todo.md](todo.md) when you spot a recurring decision worth capturing.
2. When ready to write it up, create a new `.md` here and add it to the index above.
3. When promoting to a team repo, use the appropriate template under
   `../templates/docs-conventions/` and update the status above.
