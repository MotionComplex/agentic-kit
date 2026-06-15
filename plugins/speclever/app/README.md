# SpecLever 🎚️

**A spec-readiness cockpit.** Stop drowning in the back-and-forth of getting features ready
to build. SpecLever links each feature's **Confluence spec + Azure DevOps work items + Figma
designs**, runs a multi-dimension audit, and tracks every flagged issue in a **fingerprinted
ledger that survives re-validation rounds** — so you never lose track of what was flagged,
what got fixed, and what quietly came back.

> Built for the pain of *"I keep validating, reworking, and re-validating specs, and I can't
> keep track of everything that's been discovered."* SpecLever makes that loop a tracked,
> scored pipeline instead of a tiring memory game.

---

## The loop

```
        ┌─────────────┐     findings (fingerprinted)
        │ /lever:audit│ ───────────────────────────────┐
        └─────────────┘                                 ▼
              ▲                                  ┌───────────────┐
              │ re-audit verifies fixes,         │  LEDGER       │  score · gate ·
              │ auto-resolves, catches           │  open→reworking  coverage matrix ·
              │ regressions                      │  →resolved|waived│  round history
              │                                  └───────┬───────┘
        ┌─────────────┐                                  │
        │ /lever:rework│ ◄────── blockers/majors ────────┤
        └─────────────┘                                  ▼
              │ gate turns green             ┌────────────────────┐
              └────────────────────────────► │ /lever:brief → ship │
                                             └────────────────────┘
```

Watch it on the dashboard the whole way: **http://localhost:4173**

---

## 60-second quickstart

```bash
node src/cli.js demo      # seed a realistic 3-round example feature
node src/server.js        # start the cockpit
# open http://localhost:4173
```

You'll see the `checkout-redesign` feature: readiness climbing **0 → 33 → 53** across three
audit rounds, a findings board (open / reworking / resolved / waived), a coverage matrix with
an uncovered section and an orphan work item, and a timeline that flags a **regression** in
round 3 (a fixed finding that crept back).

Run the tests: `node --test` (16 passing).

---

## Why the ledger is the whole point

Every finding gets a **fingerprint**: `sha1(featureId | dimension | normalizedTitle | locus)`.
That identity is stable across audit runs, so when you re-audit:

- a **new** issue is inserted,
- one that's **still flagged** is refreshed (not duplicated),
- one that's **gone** is auto-resolved,
- and one that was resolved/waived but **reappears** is flagged as a **regression**.

This is the cure for the tiring part of spec work: the system remembers what was discovered
and what happened to it, round after round — you don't have to. Findings carry a full
lifecycle (`open → reworking → resolved | waived`), history, pins (never auto-resolve), and
waivers (reason required).

**Readiness** = `100 − (Σ open-finding severity weights, scaled)`, with a hard gate: any open
**blocker** ⇒ `not-ready`, regardless of score. Weights: blocker 10, major 5, minor 2, info 0.5.

---

## Skills (the part that touches your real tools)

The CLI and dashboard are **offline-pure** (zero network). The fetching and analysis live in
Claude Code skills, which run inside your session where the Confluence / ADO / Figma MCP auth
already exists. Clean seam, fully testable core.

| Skill | What it does |
| --- | --- |
| **`/lever:audit`** | Fetch spec + tickets + designs, run the 7-dimension audit, ingest findings into the ledger (reconciled). |
| **`/lever:rework`** | Draft concrete spec/ticket fixes per open finding; apply only on your confirmation; mark them reworking. |
| **`/lever:brief`** | Once the gate is green, compose an implementation-ready handoff brief from the spec, designs, and settled decisions. |
| **`/lever:track`** | Fast, read-only status: score, what's open, what moved since last round, stale & pinned findings. |

The **7 audit dimensions**: consistency · completeness · testability · design-match · dor ·
ambiguity · feasibility.

---

## CLI cheatsheet

```
node src/cli.js feature add <id> --title "..."        create a workspace
node src/cli.js feature list [--json]                 list features + readiness
node src/cli.js feature show <id> [--json]
node src/cli.js source add <id> --type confluence|ado|figma --id <id> [--title ...] [--url ...]
node src/cli.js ingest <id> --file findings.json [--note "..."] [--reopen-resolved]
node src/cli.js finding list <id> [--status open] [--dimension x] [--severity y] [--json]
node src/cli.js finding set <id> <fp> --status resolved|waived|reworking|open [--reason "..."] [--pin|--unpin]
node src/cli.js readiness <id> [--json]
node src/cli.js report <id> [--out report.md]
node src/cli.js coverage set <id> --file coverage.json
node src/cli.js demo
```

Severity glyphs: ◆ blocker · ▲ major · ● minor · ○ info

---

## Data layout

Plain JSON on disk (override the location with `SPECLEVER_DATA`):

```
data/
  config.json              severity weights, gates
  features/<id>.json        workspace: sources, specSections, coverage
  ledger/<id>.json          findings with fingerprints + lifecycle + history
  rounds/<id>.json          audit round history with stats + readiness snapshots
```

Full contract: [`docs/SCHEMA.md`](docs/SCHEMA.md). Architecture: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## What's local vs. what needs your session

- **Local, no network:** the ledger, scoring, reconciliation, CLI, dashboard, report. Runs
  anywhere Node 24 runs. **Zero runtime dependencies.**
- **Needs your Claude Code session (MCP auth):** the `/lever:*` skills that read Confluence,
  Azure DevOps, and Figma, and (only on your explicit confirmation) write fixes back.

Built overnight as a "surprise lever." The engine is tested; the skills are wired to real
tools. Seed the demo and open the cockpit. 🎚️
