#!/usr/bin/env bash
# code-check.sh — run a project's checks and emit ONLY relevant signal.
#
# The token-win: a swarm worker (or you) shouldn't ingest a full passing test dump.
# This detects the project's check commands, runs them, and prints:
#   - PASS <label> — <one-line count>            (passing noise suppressed)
#   - FAIL <label> + the failing lines only      (test names/messages, tsc/eslint errors)
#   - a final overall PASS/FAIL line
#
# Usage:
#   code-check.sh [--dir <path>] [--only typecheck,lint,test,check] [--tail <n>] [--raw]
#   code-check.sh --cmd "<label>=<shell command>" [--cmd ...]   # explicit override
#
#   --dir <path>   project root (default: cwd)
#   --only <list>  run only these check kinds (comma-sep). Default: all detected.
#   --tail <n>     when a failure can't be pattern-filtered, show the last n lines (default 40)
#   --raw          don't filter — print full output (escape hatch)
#   --cmd k=cmd    run an arbitrary labelled command instead of auto-detection (repeatable)
#
# Detection order: package.json scripts → Cargo.toml → pyproject/pytest → go.mod.
set -uo pipefail   # NOT -e: check commands are expected to fail; we handle rc ourselves.

DIR="."
ONLY=""
TAIL=40
RAW=0
declare -a EXPLICIT=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)  DIR="$2"; shift 2 ;;
    --only) ONLY="$2"; shift 2 ;;
    --tail) TAIL="$2"; shift 2 ;;
    --raw)  RAW=1; shift ;;
    --cmd)  EXPLICIT+=("$2"); shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "code-check: unknown arg: $1" >&2; exit 2 ;;
  esac
done

cd "$DIR" || { echo "code-check: cannot cd to $DIR" >&2; exit 2; }

OVERALL=0   # 0 = pass, 1 = at least one failure
PASS_LINES=()
FAIL_BLOCKS=()

want() {  # want <kind> → 0 if this kind should run
  [[ -z "$ONLY" ]] && return 0
  [[ ",$ONLY," == *",$1,"* ]] && return 0 || return 1
}

# Extract a short "N passed" style summary from passing output.
pass_summary() {
  local out="$1" s
  s="$(grep -oiE '[0-9]+ (passed|passing)' <<<"$out" | tail -1)"
  [[ -z "$s" ]] && s="$(grep -iE 'Tests:.*passed|[0-9]+ tests? passed|all .*passed' <<<"$out" | tail -1 | sed 's/^[[:space:]]*//')"
  [[ -z "$s" ]] && s="ok"
  echo "$s"
}

# Filter failing output down to the signal, keyed by check kind.
filter_failure() {
  local kind="$1" out="$2" lines
  if [[ "$RAW" == "1" ]]; then printf '%s\n' "$out"; return; fi
  case "$kind" in
    typecheck)
      lines="$(grep -E 'error TS[0-9]+|: error' <<<"$out" | head -60)" ;;
    lint)
      # eslint default formatter: "  line:col  error  msg  rule" + "✖ N problems" summary.
      lines="$(grep -E '(^|[[:space:]])(error|warning)([[:space:]]|:)|✖|[0-9]+ problems?' <<<"$out" | head -80)" ;;
    test|check)
      # union of common runner failure markers (vitest/jest/mocha/tap) + final summary.
      lines="$(grep -E '✕|✗|✘|×|● |FAIL |not ok|AssertionError|Expected|Received|failed|[0-9]+ (failed|failing)' <<<"$out" | head -80)" ;;
    *)
      lines="" ;;
  esac
  if [[ -z "$lines" ]]; then
    # No pattern match — fall back to the tail (still far smaller than the full dump).
    lines="$(tail -n "$TAIL" <<<"$out")"
  fi
  printf '%s\n' "$lines"
}

# Run one labelled command; record PASS one-liner or FAIL block.
run_check() {
  local kind="$1" label="$2"; shift 2
  local out rc
  out="$("$@" 2>&1)"; rc=$?
  if [[ $rc -eq 0 ]]; then
    PASS_LINES+=("PASS  $label — $(pass_summary "$out")")
  else
    OVERALL=1
    FAIL_BLOCKS+=("FAIL  $label  (exit $rc)"$'\n'"$(filter_failure "$kind" "$out" | sed 's/^/    /')")
  fi
}

# package.json script present?
has_script() { node -e "process.exit(((require('./package.json').scripts||{})['$1'])?0:1)" 2>/dev/null; }
pkg_runner() { if [[ -f pnpm-lock.yaml ]]; then echo "pnpm"; elif [[ -f yarn.lock ]]; then echo "yarn"; else echo "npm run"; fi; }

# --- explicit override -------------------------------------------------------
if [[ ${#EXPLICIT[@]} -gt 0 ]]; then
  for spec in "${EXPLICIT[@]}"; do
    label="${spec%%=*}"; cmd="${spec#*=}"
    run_check "${label}" "${label}" bash -lc "$cmd"
  done
# --- auto-detection ----------------------------------------------------------
elif [[ -f package.json ]]; then
  RUN="$(pkg_runner)"
  want typecheck && has_script typecheck && run_check typecheck "typecheck" bash -lc "$RUN typecheck"
  want typecheck && ! has_script typecheck && [[ -f tsconfig.json ]] && \
    run_check typecheck "tsc --noEmit" bash -lc "npx --no-install tsc --noEmit"
  want lint  && has_script lint  && run_check lint  "lint"  bash -lc "$RUN lint"
  want test  && has_script test  && run_check test  "test"  bash -lc "$RUN test"
  want check && has_script check && run_check check "check" bash -lc "$RUN check"
elif [[ -f Cargo.toml ]]; then
  want check     && run_check check     "cargo check"  bash -lc "cargo check"
  want lint      && run_check lint       "cargo clippy" bash -lc "cargo clippy -- -D warnings"
  want test      && run_check test       "cargo test"   bash -lc "cargo test"
elif [[ -f pyproject.toml || -f setup.cfg || -f pytest.ini ]]; then
  want lint      && command -v ruff  >/dev/null && run_check lint      "ruff"  bash -lc "ruff check ."
  want typecheck && command -v mypy  >/dev/null && run_check typecheck "mypy"  bash -lc "mypy ."
  want test      && command -v pytest>/dev/null && run_check test      "pytest" bash -lc "pytest -q"
elif [[ -f go.mod ]]; then
  want lint      && run_check lint      "go vet"  bash -lc "go vet ./..."
  want test      && run_check test      "go test" bash -lc "go test ./..."
else
  echo "code-check: no recognised project (package.json / Cargo.toml / pyproject / go.mod) in $DIR." >&2
  echo "Pass explicit checks with --cmd 'label=command'." >&2
  exit 2
fi

# --- report ------------------------------------------------------------------
echo "──────── code-check ────────"
for l in "${PASS_LINES[@]:-}"; do [[ -n "$l" ]] && echo "$l"; done
for b in "${FAIL_BLOCKS[@]:-}"; do [[ -n "$b" ]] && { echo; echo "$b"; }; done
echo "────────────────────────────"
if [[ $OVERALL -eq 0 ]]; then echo "OVERALL: PASS"; else echo "OVERALL: FAIL"; fi
exit $OVERALL
