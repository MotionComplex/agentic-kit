# feature-dev

Portable **plan → implement → PR → CI loop → finalize** workflow. Works with or without Cursor.

## What is Cursor-specific vs portable

| Piece | Cursor | Claude Code CLI | GitHub only (no IDE) |
|---|---|---|---|
| Plan + implement | Agent / Plan mode | `claude` in terminal + `CLAUDE.md` | `@claude` on Issues |
| Lint on save/edit | `.cursor/hooks/` | run `hooks/after-edit-lint.sh` manually or from a npm script | N/A |
| Procedure rule | `.cursor/rules/feature-workflow.mdc` | `CLAUDE.md` snippet (installed) | `AGENTS.md` snippet |
| PR review loop | N/A (CI) | N/A (CI) | requires `claude-review-loop` workflow |
| Finalize PR | `/babysit` skill in Cursor | same skill if linked in `~/.claude/skills/` | `gh` + manual |

**You are not bound to Cursor.** Install `claude-review-loop` for CI automation, then install
`feature-dev` for local procedure + hooks. Use Cursor when you want the IDE; use Claude CLI +
worktrees when you do not.

## Install

Requires `claude-review-loop` on the same repo for the automated PR loop (install that first).

```bash
# 1. Claude GitHub App (once per repo)
claude    # then: /install-github-app

# 2. CI review loop
~/dev/agentic-kit/workflows/claude-review-loop/install.sh /path/to/repo

# 3. Local / portable dev workflow
~/dev/agentic-kit/workflows/feature-dev/install.sh /path/to/repo
```

## Labels

Create once per repo (installer prints commands if missing):

```bash
gh label create human-gate --description "Hold auto-merge; human reviews before merge" --color FBCA04
```

Optional: `gh variable set HUMAN_GATE_NOTIFY --body "your-github-username"` for @mentions when merge is held.

## Parallel features

Use one git worktree per feature (documented in the installed rule). CI loops are independent per PR.

## Layout

```
feature-dev/
├── README.md
├── install.sh
└── source/
    ├── .cursor/rules/feature-workflow.mdc
    ├── .cursor/hooks/hooks.fragment.json   # merged into hooks.json
    ├── hooks/after-edit-lint.sh            # copied to .cursor/hooks/
    ├── CLAUDE-snippet.md
    └── AGENTS-snippet.md
```
