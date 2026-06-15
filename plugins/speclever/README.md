# SpecLever

A local **review cockpit** for specifications and pull requests. SpecLever turns spec-readiness
audits and PR reviews into a tracked, repeatable loop: findings are **fingerprinted** so the same
issue keeps the same identity across rounds (new ones surface, fixed ones auto-resolve, and
regressions get caught when a closed issue reappears). You review and decide each finding in a
guided **stepper UI**, export **work orders**, and trigger jobs from the browser that the Claude
session executes.

It bundles a zero-dependency Node app (Node 24, no install) under `app/` plus a set of
`/speclever:*` skills that drive it via MCP (Confluence, Azure DevOps, Figma).

## Quick start

```
/speclever:start
```

Boots the dashboard (default **http://localhost:4173**) and starts the watch loop so UI-triggered
jobs run. With no data yet, seed an example with the demo, or run `/speclever:audit <feature>` to
populate a real one.

## Skills

| Skill | What it does |
| --- | --- |
| `/speclever:start` | Launch the cockpit dashboard + the UI-job watch loop. |
| `/speclever:audit <id>` | Fetch a feature's Confluence/ADO/Figma sources (read-only) and run a 7-dimension spec-readiness audit, ingesting fingerprinted findings. |
| `/speclever:track <id>` | Fast, local-only status read: score, gate, what's open, what moved since the last round. |
| `/speclever:rework <id>` | Draft fixes for open findings and apply them to the spec/work items — only on explicit confirmation. |
| `/speclever:brief <id>` | Compose an implementation-ready handoff brief once the readiness gate is green. |
| `/speclever:watch` | Session-side runner: drain the cockpit's UI request queue (PR reviews, applies). Usually run on a loop. |
| `/speclever:pr-review <prId>` | Load an ADO PR into a `pr-review` workspace, review against spec/ticket, step through findings, post kept comments back. |
| `/speclever:pr-respond <prId>` | Load reviewer feedback on your PR into a `pr-respond` workspace, draft replies/fixes, post them back. |

## Data location

Ledger state (features, findings, rounds, requests, briefs) lives **per-user** in `~/.speclever`,
so it's shared across repositories and kept out of the plugin. Override the location with the
`SPECLEVER_DATA` environment variable — every skill honors it.

## The bundled app

The cockpit app lives under `app/` (`app/src/cli.js`, `app/src/server.js`, `app/web/`, with
`app/docs/SCHEMA.md` and `app/docs/ARCHITECTURE.md` documenting the schema and design). Skills
invoke it via `${CLAUDE_PLUGIN_ROOT}/app/src/cli.js`. Run its tests with `cd app && node --test`.
