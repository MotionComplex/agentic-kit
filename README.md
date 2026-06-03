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

## Skills

Single-skill dirs (`skills/<name>/SKILL.md`) and multi-skill groups
(`skills/<group>/<name>/SKILL.md`, each linked individually) are both supported by
`install.sh`.

**`cmux-swarm/`** — orchestrate a team of Claude Code agents in [cmux](https://cmux.io):

| Skill | What it does |
|---|---|
| `create-swarm` | Spin up a cmux agent team: this session orchestrates, spawns `W1…Wn` workers, dispatches tasks via brief files, monitors them (commit / footer-marker / anchored `DONE:`), isolates parallel edits with git worktrees. Mechanics in `create-swarm/swarm.sh`. |
| `code-check` | Run the project's checks (type/lint/test) and return **only** failures + a one-line "N passed" — the token-win for workers. Hands off to `/code-review` for adversarial diff review. |
| `visual-check` | Direct-Playwright browser check: own headed Chromium + unique temp `user-data-dir` (safe for concurrent workers), screenshot + assert, return only pass/fail + failing screenshot. |

The bare skill names (`create-swarm`, `code-check`, `visual-check`) don't collide with
`code-review`, `visual-e2e`, or `design-vision-ui-review`.

## Maintenance

`conventions/todo.md` tracks conventions I want to capture but haven't written up yet.
Pull it open when I notice "I keep telling Claude this — should write it down."
