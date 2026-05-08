# agentic-kit

My personal toolkit for working with Claude Code: skills, conventions, templates. Synced
across machines via git so all my Claude Code instances share the same setup.

## Layout

```
agentic-kit/
├── skills/                 # Claude Code skills — symlinked into ~/.claude/skills/
├── conventions/            # Personal staging area for conventions before promoting them to
│                           # team repos. Each .md file is a draft I refine over time.
├── templates/              # Reusable boilerplate (CLAUDE.md, READMEs, team-repo conventions)
└── install.sh              # New-machine setup: symlinks, basic checks
```

## Install on a new machine

```bash
git clone <this-repo> ~/dev/agentic-kit
cd ~/dev/agentic-kit
./install.sh
```

## What goes where

| Type | Location | Synced? |
|---|---|---|
| Skills (reusable across projects) | `skills/` | Yes — git |
| Personal conventions (drafts) | `conventions/` | Yes — git |
| Templates / boilerplate | `templates/` | Yes — git |
| Project-specific facts | The project's `CLAUDE.md` | Yes — project git |
| Local-only personal prefs (per-machine) | `~/.claude/.../memory/` | No |

When a convention in `conventions/` is mature, copy it into the relevant team repo's
`docs/conventions/` (or `CLAUDE.md`) so the team gets it. Templates under
`templates/docs-conventions/` are starting points for that promotion.

## Maintenance

`conventions/todo.md` tracks conventions I want to capture but haven't written up yet.
Pull it open when I notice "I keep telling Claude this — should write it down."
