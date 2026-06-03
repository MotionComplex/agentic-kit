---
name: code-check
description: >-
  Run a project's functional + type + lint checks and return ONLY the relevant
  signal — overall pass/fail, the failing test names and messages, type/lint
  errors, and a one-line "N passed" summary — suppressing the passing noise.
  Built for swarm workers and tight loops where ingesting a full suite dump wastes
  tokens. Use when the user says "code-check", "run checks", "verify the code",
  "run the tests and tell me what failed", or "do the checks pass?". For an
  adversarial diff review, hand off to /code-review (don't duplicate it here).
compatibility: "Auto-detects package.json / Cargo.toml / pyproject / go.mod. Filtering is best-effort, runner-aware (tsc, eslint, vitest/jest, cargo, pytest, go); use --raw to see full output. Mechanics live in code-check.sh alongside this file."
allowed-tools: Bash, Read
---

# Code Check

Run the project's checks, return **only what failed** plus a one-line pass summary. The point
is signal density: a worker reporting back to an orchestrator, or you in a fix loop, should
not re-read thousands of lines of green output.

The mechanics live in `code-check.sh` (alongside this file — installed at
`~/.claude/skills/code-check/code-check.sh`).

## Step 1 — Run it

```bash
bash ~/.claude/skills/code-check/code-check.sh --dir <project-root>
```

It auto-detects the ecosystem and runs the checks it finds:

| Ecosystem | Detected from | Runs (when present) |
|---|---|---|
| Node | `package.json` | `typecheck` (or `tsc --noEmit`), `lint`, `test`, `check` scripts |
| Rust | `Cargo.toml` | `cargo check`, `cargo clippy -D warnings`, `cargo test` |
| Python | `pyproject.toml` / `pytest.ini` | `ruff`, `mypy`, `pytest -q` |
| Go | `go.mod` | `go vet ./...`, `go test ./...` |

Useful flags:
- `--only typecheck,lint` — run a subset (e.g. skip slow tests in a quick loop).
- `--cmd "e2e=npm run test:e2e"` — run an explicit labelled command (repeatable); bypasses detection.
- `--tail 60` — when a failure can't be pattern-matched, how many trailing lines to show.
- `--raw` — disable filtering (full output) when you genuinely need it.

## Step 2 — Read the filtered report

Output is bracketed and minimal:

```
──────── code-check ────────
PASS  typecheck — ok
PASS  lint — ok

FAIL  test  (exit 1)
    ✕ parses ISO date > rejects empty string
      Expected: throw; Received: undefined  (src/date.test.ts:21)
────────────────────────────
OVERALL: FAIL
```

- `PASS <label> — <N passed>` for each green check (noise dropped).
- `FAIL <label>` followed by the **failing lines only** — test names + assertion messages,
  `error TS…` lines, eslint `error` rows + the `✖ N problems` summary.
- A final `OVERALL: PASS|FAIL`. The script's **exit code** mirrors it (0 pass / 1 fail), so it
  composes in scripts and swarm monitoring.

**Report back to the user/orchestrator using only this filtered block** — don't paste the raw
run. If `OVERALL: PASS`, a single line ("checks pass: typecheck, lint, test") is enough.

## Step 3 — Optional: adversarial diff review

The script checks **correctness mechanically** (does it compile / lint / pass tests). It does
**not** review the diff for logic bugs, edge cases, or design. When the user wants that too,
invoke the existing **`/code-review`** skill on the working tree — do not reimplement its
adversarial logic here. Keep the two concerns separate: `code-check` = does it pass;
`/code-review` = is the change actually right.

## When NOT to use this

- You need the full, unfiltered output to debug a gnarly failure → run the underlying command
  directly, or pass `--raw`.
- Pure design/logic review with no runnable checks → that's `/code-review`.

## Pitfalls

- **Filtering is heuristic.** It's tuned for common runners; an exotic reporter may slip
  failing lines into the tail fallback rather than a clean list. If a `FAIL` block looks empty
  or wrong, re-run with `--raw`.
- **Detection picks the first marker found.** In a polyglot repo, scope with `--dir` or drive
  it explicitly with `--cmd`.
- **`test` scripts that watch.** Ensure the project's `test` script runs once and exits (CI
  mode), not in watch mode, or the check will hang.
