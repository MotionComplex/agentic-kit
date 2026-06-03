#!/usr/bin/env bash
# swarm.sh — deterministic CMUX agent-team primitives for the create-swarm skill.
#
# CMUX object model:  window → workspace → pane → surface.
# A "worker" here is its own workspace (tab) named "🤖 W<n>", running one Claude
# Code session. The orchestrator is the current session; it drives workers by
# writing to their surfaces and reading their screens.
#
# Usage:
#   swarm.sh check-cmux                         → prints cmux path, or "MISSING"
#   swarm.sh install-cmux                       → brew install --cask cmux (asks nothing; caller confirms)
#   swarm.sh find-claude                        → prints the claude binary path
#   swarm.sh spawn <n> <repo>                   → spawn worker W<n> in <repo>, launch claude, force PTY
#                                                 prints:  WORKSPACE=<ref>\nSURFACE=<ref>
#   swarm.sh refs <n>                           → re-resolve "WORKSPACE/SURFACE" for an existing W<n>
#   swarm.sh rename <ws> <surf> <title>         → relabel the worker's tab (call as its task changes)
#   swarm.sh dispatch <ws> <surf> <brief> <gist>→ send "Read <brief> in full and execute. <gist>" + Enter
#   swarm.sh send <ws> <surf> <text>            → send raw text + Enter (no brief-file wrapping)
#   swarm.sh reset <ws> <surf>                  → /clear + Enter (fresh context between tasks)
#   swarm.sh read <ws> <surf> [lines]           → read-screen (last [lines], default full)
#   swarm.sh status <ws> <surf>                 → WORKING | IDLE | UNKNOWN  (footer-marker heuristic)
#   swarm.sh wait-idle <ws> <surf> [timeout]    → block until idle PERSISTS (re-checked after 6s); 0=ok 1=timeout
#   swarm.sh wait-commit <repo> <old_sha> [to]  → block until HEAD moves off <old_sha>; prints new sha; 0=ok 1=timeout
#   swarm.sh head <repo>                        → prints current HEAD sha (use before dispatch to arm wait-commit)
#   swarm.sh worktree <repo> <branch> <dir> <base>
#                                               → git worktree add + symlink node_modules + copy .env* (parallel edits)
#
# Monitoring philosophy (most robust → least):
#   1. commit-aware  (wait-commit)  — best signal for code tasks.
#   2. footer marker (status/wait-idle) — "esc to interrupt"=working, "for agents"=idle.
#   3. anchored DONE:/BLOCKED: <task-id> in the final screen line (caller greps `read`).
set -euo pipefail

# --- binary resolution -------------------------------------------------------
CMUX_APP_BIN="/Applications/cmux.app/Contents/Resources/bin/cmux"
cmux_bin() {
  if command -v cmux >/dev/null 2>&1; then command -v cmux
  elif [[ -x "$CMUX_APP_BIN" ]]; then echo "$CMUX_APP_BIN"
  else return 1; fi
}
CLAUDE_APP_BIN="/Applications/cmux.app/Contents/Resources/bin/claude"
find_claude() {
  if command -v claude >/dev/null 2>&1; then command -v claude
  elif [[ -x "$HOME/.local/bin/claude" ]]; then echo "$HOME/.local/bin/claude"
  elif [[ -x "$CLAUDE_APP_BIN" ]]; then echo "$CLAUDE_APP_BIN"
  else echo "claude"; fi   # last resort: assume on PATH at runtime
}
CMUX="$(cmux_bin || true)"

die() { echo "swarm.sh: $*" >&2; exit 2; }
need_cmux() { [[ -n "$CMUX" ]] || die "cmux not found (run: swarm.sh check-cmux)"; }

# --- parsing helpers ---------------------------------------------------------
# list-workspaces line:  "* workspace:3  🤖 W1  [selected]"  /  "  workspace:1  ▶️ App"
# Extract the workspace:<n> ref whose label contains the given (literal) name.
ws_ref_by_name() {
  local name="$1"
  "$CMUX" list-workspaces 2>/dev/null | grep -F "$name" | grep -oE 'workspace:[0-9]+' | head -1
}
# list-pane-surfaces line: "* surface:7  W2 · ...  [selected]" → first surface ref in the workspace.
first_surface_of() {
  local ws="$1"
  "$CMUX" list-pane-surfaces --workspace "$ws" 2>/dev/null | grep -oE 'surface:[0-9]+' | head -1
}

# --- commands ----------------------------------------------------------------
cmd_check_cmux() {
  if [[ -n "$CMUX" ]]; then echo "$CMUX"; else echo "MISSING"; fi
}

cmd_install_cmux() {
  if command -v brew >/dev/null 2>&1; then
    brew install --cask cmux
  else
    echo "Homebrew not found. Install cmux from https://cmux.io (or https://github.com/cmux)." >&2
    return 1
  fi
}

cmd_find_claude() { find_claude; }

cmd_head() {
  local repo="$1"
  git -C "$repo" rev-parse HEAD
}

cmd_spawn() {
  need_cmux
  local n="$1" repo="$2"
  local name="🤖 W${n}"
  local claude_bin; claude_bin="$(find_claude)"
  # Create the worker workspace and launch Claude inside it (skip-permissions = unattended worker).
  "$CMUX" new-workspace \
    --name "$name" \
    --cwd "$repo" \
    --command "$claude_bin --dangerously-skip-permissions" \
    --focus false >/dev/null
  local ws; ws="$(ws_ref_by_name "$name")"
  [[ -n "$ws" ]] || die "could not resolve workspace ref for '$name' after new-workspace"
  # LAZY-PTY GOTCHA: a fresh workspace has no PTY until rendered. Force it once so
  # read-screen works (else: "Terminal surface not found").
  "$CMUX" select-workspace --workspace "$ws" >/dev/null
  local surf; surf="$(first_surface_of "$ws")"
  [[ -n "$surf" ]] || die "could not resolve surface ref for $ws"
  echo "WORKSPACE=$ws"
  echo "SURFACE=$surf"
}

cmd_refs() {
  need_cmux
  local n="$1"
  local name="🤖 W${n}"
  local ws; ws="$(ws_ref_by_name "$name")"
  [[ -n "$ws" ]] || die "no workspace named '$name'"
  local surf; surf="$(first_surface_of "$ws")"
  echo "WORKSPACE=$ws"
  echo "SURFACE=$surf"
}

cmd_rename() {
  need_cmux
  local ws="$1" surf="$2" title="$3"
  "$CMUX" rename-tab --workspace "$ws" --surface "$surf" "$title"
}

cmd_dispatch() {
  need_cmux
  local ws="$1" surf="$2" brief="$3" gist="$4"
  [[ -f "$brief" ]] || die "brief file not found: $brief"
  # Send a SHORT pointer to the brief file, then Enter as a separate key event.
  # Pasting a long multi-line prompt directly auto-submits early — the brief file avoids that.
  "$CMUX" send --workspace "$ws" --surface "$surf" "Read $brief in full and execute. $gist"
  "$CMUX" send-key --workspace "$ws" --surface "$surf" enter
}

cmd_send() {
  need_cmux
  local ws="$1" surf="$2" text="$3"
  "$CMUX" send --workspace "$ws" --surface "$surf" "$text"
  "$CMUX" send-key --workspace "$ws" --surface "$surf" enter
}

cmd_reset() {
  need_cmux
  local ws="$1" surf="$2"
  "$CMUX" send --workspace "$ws" --surface "$surf" "/clear"
  "$CMUX" send-key --workspace "$ws" --surface "$surf" enter
}

cmd_read() {
  need_cmux
  local ws="$1" surf="$2" lines="${3:-}"
  if [[ -n "$lines" ]]; then
    "$CMUX" read-screen --workspace "$ws" --surface "$surf" --lines "$lines"
  else
    "$CMUX" read-screen --workspace "$ws" --surface "$surf"
  fi
}

# Footer-marker heuristic. Claude Code in cmux shows:
#   "esc to interrupt"  → actively working
#   "for agents"        → idle / awaiting input  (the "← for agents" hint)
cmd_status() {
  need_cmux
  local ws="$1" surf="$2" screen
  screen="$("$CMUX" read-screen --workspace "$ws" --surface "$surf" 2>/dev/null || true)"
  if grep -qiF "esc to interrupt" <<<"$screen"; then echo "WORKING"
  elif grep -qiF "for agents"     <<<"$screen"; then echo "IDLE"
  else echo "UNKNOWN"; fi
}

cmd_wait_idle() {
  need_cmux
  local ws="$1" surf="$2" timeout="${3:-600}"
  local waited=0
  while (( waited < timeout )); do
    if [[ "$(cmd_status "$ws" "$surf")" == "IDLE" ]]; then
      # Require idle to PERSIST — a single idle frame is flaky mid-stream.
      sleep 6; waited=$((waited+6))
      if [[ "$(cmd_status "$ws" "$surf")" == "IDLE" ]]; then
        echo "IDLE"; return 0
      fi
    fi
    sleep 4; waited=$((waited+4))
  done
  echo "TIMEOUT" >&2; return 1
}

cmd_wait_commit() {
  local repo="$1" old="$2" timeout="${3:-1800}"
  local waited=0 cur
  while (( waited < timeout )); do
    cur="$(git -C "$repo" rev-parse HEAD 2>/dev/null || echo "$old")"
    if [[ "$cur" != "$old" ]]; then echo "$cur"; return 0; fi
    sleep 8; waited=$((waited+8))
  done
  echo "TIMEOUT" >&2; return 1
}

cmd_worktree() {
  local repo="$1" branch="$2" dir="$3" base="$4"
  git -C "$repo" worktree add -b "$branch" "$dir" "$base"
  # Heavy/ignored dirs aren't copied by worktree — link node_modules, copy env files.
  if [[ -d "$repo/node_modules" && ! -e "$dir/node_modules" ]]; then
    ln -s "$repo/node_modules" "$dir/node_modules"
  fi
  local f
  for f in "$repo"/.env "$repo"/.env.*; do
    [[ -e "$f" ]] && cp "$f" "$dir/" 2>/dev/null || true
  done
  echo "WORKTREE=$dir"
  echo "BRANCH=$branch"
}

# --- dispatch ----------------------------------------------------------------
sub="${1:-}"; shift || true
case "$sub" in
  check-cmux)   cmd_check_cmux "$@" ;;
  install-cmux) cmd_install_cmux "$@" ;;
  find-claude)  cmd_find_claude "$@" ;;
  head)         cmd_head "$@" ;;
  spawn)        cmd_spawn "$@" ;;
  refs)         cmd_refs "$@" ;;
  rename)       cmd_rename "$@" ;;
  dispatch)     cmd_dispatch "$@" ;;
  send)         cmd_send "$@" ;;
  reset)        cmd_reset "$@" ;;
  read)         cmd_read "$@" ;;
  status)       cmd_status "$@" ;;
  wait-idle)    cmd_wait_idle "$@" ;;
  wait-commit)  cmd_wait_commit "$@" ;;
  worktree)     cmd_worktree "$@" ;;
  ""|-h|--help|help)
    sed -n '2,40p' "$0" ;;
  *) die "unknown subcommand: $sub (run: swarm.sh help)" ;;
esac
