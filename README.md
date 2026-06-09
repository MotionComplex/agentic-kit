# agentic-kit

My personal toolkit for working with Claude Code: skills, conventions, templates. Synced
across machines via git so all my Claude Code instances share the same setup.

## Layout

```
agentic-kit/
├── skills/                 # Claude Code skills — symlinked into ~/.claude/skills/
├── plugins/                # Standalone Claude Code plugins (installed via the marketplace below)
├── .claude-plugin/         # marketplace.json — makes this repo a local plugin marketplace
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
| Plugins (skills + commands bundled together) | `plugins/` | Yes — git |
| Personal conventions (drafts) | `conventions/` | Yes — git |
| Templates / boilerplate | `templates/` | Yes — git |
| Project-specific facts | The project's `CLAUDE.md` | Yes — project git |
| Local-only personal prefs (per-machine) | `~/.claude/.../memory/` | No |

When a convention in `conventions/` is mature, copy it into the relevant team repo's
`docs/conventions/` (or `CLAUDE.md`) so the team gets it. Templates under
`templates/docs-conventions/` are starting points for that promotion.

## Skills (symlinked)

Single-skill dirs (`skills/<name>/SKILL.md`) and multi-skill groups
(`skills/<group>/<name>/SKILL.md`, each linked individually) are both supported by
`install.sh`, which symlinks them into `~/.claude/skills/` (and `~/.cursor/skills-cursor/`).

## Plugins

Bundles of skills + commands installed through Claude Code's plugin system rather than as
loose symlinks. This repo doubles as a **local marketplace** via `.claude-plugin/marketplace.json`.

### `cmux-swarm` — orchestrate a team of Claude Code agents in [cmux](https://cmux.io)

Install (one-time, per machine):

```text
/plugin marketplace add ~/dev/agentic-kit
/plugin install cmux-swarm@agentic-kit
```

It provides two **skills** and one **command**, namespaced under `cmux-swarm:`:

| Component | Type | What it does |
|---|---|---|
| `cmux-swarm:create-swarm` | skill | Spin up a cmux agent team: this session orchestrates, spawns `W1…Wn` workers, dispatches tasks via brief files, monitors them (commit / footer-marker / anchored `DONE:`), isolates parallel edits with git worktrees. Mechanics in `skills/create-swarm/swarm.sh`. |
| `cmux-swarm:code-check` | skill | Run the project's checks (type/lint/test) and return **only** failures + a one-line "N passed" — the token-win for workers. Hands off to `/code-review` for adversarial diff review. |
| `cmux-swarm:visual-check` | skill | Direct-Playwright browser check: own headed Chromium + unique temp `user-data-dir` (safe for concurrent workers), screenshot + assert, return only pass/fail + failing screenshot. |
| `cmux-swarm:cmux-bootstrap` | command | Detect cmux and, if missing, offer `brew install --cask cmux` (or print the download link). Run before `create-swarm`. |

Because it ships as a plugin, `install.sh` deliberately **skips** any `skills/cmux-swarm/` —
the plugin is the single source, so the skills are never double-registered. Bundled scripts are
referenced via `${CLAUDE_PLUGIN_ROOT}`, so they resolve wherever the plugin is installed. The
namespaced names don't collide with `code-review`, `visual-e2e`, or `design-vision-ui-review`.

### `design-eng` — design-engineering skills (UI reverse-engineering, motion, Figma)

Install (one-time, per machine):

```text
/plugin marketplace add ~/dev/agentic-kit
/plugin install design-eng@agentic-kit
```

It bundles three **skills**, namespaced under `design-eng:`:

| Component | Type | What it does |
|---|---|---|
| `design-eng:ui-reverse-engineer` | skill | Turn a screenshot **or live URL** into a faithful, disassembled reconstruction + an extracted design-token system (`tokens.json`), components, composition, and skeleton. |
| `design-eng:motion-system` | skill | Design the **motion** layer for a design — motion tokens, choreography, per-state transitions, an animated specimen sheet — inferring it from the design's taste, or measuring real timing from a video/URL via the `motion-trace` plugin. |
| `design-eng:figma-export` | skill | Push the extracted `tokens.json` → Figma Variables/styles and `components.html` → a Figma component library (states as variants), via the Figma MCP. |

These three live **inside the plugin** rather than as loose `skills/` symlinks because the
Claude desktop (Cowork) app reliably surfaces *plugin-delivered* skills but does **not** reliably
auto-discover newly-symlinked `~/.claude/skills/` folders. Delivering them through the marketplace
is what makes them appear in the Cowork UI. `ui-reverse-engineer` moved here from `skills/` for the
same reason — if a stale `~/.claude/skills/ui-reverse-engineer` symlink remains from the old layout,
remove it so the plugin copy is the single source.

## Maintenance

`conventions/todo.md` tracks conventions I want to capture but haven't written up yet.
Pull it open when I notice "I keep telling Claude this — should write it down."
