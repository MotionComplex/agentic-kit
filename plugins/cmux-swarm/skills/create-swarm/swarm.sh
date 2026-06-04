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
#   swarm.sh spawn <n> <repo>                   → spawn worker W<n> as its own workspace (tab), launch claude, force PTY
#                                                 prints:  WORKSPACE=<ref>\nSURFACE=<ref>
#   swarm.sh spawn-split <n> <repo> [anchor-pane]
#                                               → spawn worker W<n> as a SPLIT PANE in the caller's workspace.
#                                                 No anchor: splits right of the workspace (first worker).
#                                                 With anchor (a pane ref from a previous spawn-split): splits below it.
#                                                 prints:  WORKSPACE=<ref>\nSURFACE=<ref>\nPANE=<ref>
#   swarm.sh refs <n>                           → re-resolve "WORKSPACE/SURFACE" for an existing W<n> (tab or split)
#   swarm.sh name-orchestrator [title]          → label the caller's TAB (default "🧠 Orchestrator", like the
#                                                 workers' 🤖 tabs) and rename the caller's WORKSPACE to
#                                                 "🐙 Team <constellation>" (first free name from TEAM_NAMES —
#                                                 Orion, Cygnus, Lyra, …; numbered fallback if exhausted)
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
# Refs of the session calling this script (the orchestrator), from `cmux identify`.
caller_field() {
  "$CMUX" identify 2>/dev/null \
    | awk -v k="\"$1\"" '/"caller"/{f=1} f && index($0,k){gsub(/[",]/,"",$3); print $3; exit}'
}
caller_ws()      { caller_field workspace_ref; }
caller_surface() { caller_field surface_ref; }
# Pane that holds a given surface within a workspace (exact-ref match, surface:4 ≠ surface:42).
pane_of_surface() {
  local ws="$1" surf="$2" p
  for p in $("$CMUX" list-panes --workspace "$ws" 2>/dev/null | grep -oE 'pane:[0-9]+'); do
    if "$CMUX" list-pane-surfaces --workspace "$ws" --pane "$p" 2>/dev/null \
       | grep -oE 'surface:[0-9]+' | grep -qx "$surf"; then
      echo "$p"; return 0
    fi
  done
  return 1
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

# Split-pane spawn: worker lives as a pane in the CALLER's workspace instead of its own tab.
# new-pane can't take --cwd/--command, so stage in a hidden temp workspace (which can),
# move the surface over, split it off, and close the empty shell.
cmd_spawn_split() {
  need_cmux
  local n="$1" repo="$2" anchor="${3:-}"
  local name="🤖 W${n}"
  local tmpname="⏳ spawn-W${n}"
  local claude_bin; claude_bin="$(find_claude)"
  local ws; ws="$(caller_ws)"
  [[ -n "$ws" ]] || die "could not identify caller workspace (spawn-split must run inside cmux)"
  "$CMUX" new-workspace \
    --name "$tmpname" \
    --cwd "$repo" \
    --command "$claude_bin --dangerously-skip-permissions" \
    --focus false >/dev/null
  local tmp_ws; tmp_ws="$(ws_ref_by_name "$tmpname")"
  [[ -n "$tmp_ws" ]] || die "could not resolve temp workspace '$tmpname' after new-workspace"
  local surf; surf="$(first_surface_of "$tmp_ws")"
  [[ -n "$surf" ]] || die "could not resolve surface ref for $tmp_ws"
  if [[ -n "$anchor" ]]; then
    # Stack below the previous worker: join its pane, then split downward.
    "$CMUX" move-surface --surface "$surf" --pane "$anchor" --focus false >/dev/null
    "$CMUX" split-off --surface "$surf" down --workspace "$ws" --focus false >/dev/null
  else
    # First worker: new column right of the orchestrator.
    "$CMUX" move-surface --surface "$surf" --workspace "$ws" --focus false >/dev/null
    "$CMUX" split-off --surface "$surf" right --workspace "$ws" --focus false >/dev/null
  fi
  "$CMUX" close-workspace --workspace "$tmp_ws" >/dev/null 2>&1 || true
  "$CMUX" rename-tab --workspace "$ws" --surface "$surf" "$name" >/dev/null 2>&1 || true
  # LAZY-PTY GOTCHA, split flavour: the PTY attaches when the pane first RENDERS. The caller's
  # workspace is normally visible, so this is near-instant — but if the user is viewing another
  # workspace, force a render by selecting the caller's workspace once.
  local waited=0
  until "$CMUX" read-screen --workspace "$ws" --surface "$surf" >/dev/null 2>&1; do
    (( waited == 5 )) && "$CMUX" select-workspace --workspace "$ws" >/dev/null 2>&1
    (( waited >= 15 )) && die "PTY did not attach for $surf after 15s"
    sleep 1; waited=$((waited+1))
  done
  local pane; pane="$(pane_of_surface "$ws" "$surf" || true)"
  echo "WORKSPACE=$ws"
  echo "SURFACE=$surf"
  echo "PANE=${pane:-unknown}"
}

cmd_refs() {
  need_cmux
  local n="$1"
  local name="🤖 W${n}"
  # Tab mode: the worker is its own workspace. (|| true: no match must not trip set -e —
  # split-mode workers have no workspace of their own, we fall through to the tree scan.)
  local ws; ws="$(ws_ref_by_name "$name" || true)"
  if [[ -n "$ws" ]]; then
    local surf; surf="$(first_surface_of "$ws")"
    echo "WORKSPACE=$ws"
    echo "SURFACE=$surf"
    return 0
  fi
  # Split mode: the worker is a surface labelled "🤖 W<n>" somewhere in the tree.
  # (Best effort — Claude may overwrite the tab title while working; record refs at spawn time.)
  local line
  line="$("$CMUX" tree --all 2>/dev/null \
    | awk -v label="\"${name}\"" '
        /workspace workspace:[0-9]+/ { match($0, /workspace:[0-9]+/); w=substr($0,RSTART,RLENGTH) }
        index($0, label) && /surface surface:[0-9]+/ {
          match($0, /surface:[0-9]+/); print w, substr($0,RSTART,RLENGTH); exit
        }')"
  [[ -n "$line" ]] || die "no workspace or surface named '$name'"
  echo "WORKSPACE=${line%% *}"
  echo "SURFACE=${line##* }"
}

# Team workspaces are named after constellations, claimed in this order.
TEAM_NAMES=(Orion Cygnus Lyra Andromeda Cassiopeia Pegasus Draco Aquila Phoenix
            Perseus Hydra Centaurus Gemini Leo Scorpius Taurus Corvus Vela Ara Lupus)

# Label the orchestrator so the swarm is legible: 🧠 = orchestrator tab, 🤖 = worker tabs,
# 🐙 Team <constellation> = the workspace holding the whole team.
cmd_name_orchestrator() {
  need_cmux
  local title="${1:-🧠 Orchestrator}"
  local ws; ws="$(caller_ws)"
  [[ -n "$ws" ]] || die "could not identify caller workspace (must run inside cmux)"
  local surf; surf="$(caller_surface)"
  [[ -n "$surf" ]] || die "could not identify caller surface"
  # Tab label — same mechanism as the workers' 🤖 W<n> labels.
  "$CMUX" rename-tab --workspace "$ws" --surface "$surf" "$title"
  # Workspace label — keep an existing 🐙 Team name (idempotent re-runs), else claim the
  # first constellation not already used by another workspace.
  if "$CMUX" list-workspaces 2>/dev/null | grep -E "${ws}[^0-9]" | grep -qF "🐙 Team "; then
    return 0
  fi
  local team="" t
  for t in "${TEAM_NAMES[@]}"; do
    if ! "$CMUX" list-workspaces 2>/dev/null | grep -qF "🐙 Team ${t}"; then team="$t"; break; fi
  done
  if [[ -z "$team" ]]; then
    # All constellations taken — fall back to a numbered team.
    local n=0
    while "$CMUX" list-workspaces 2>/dev/null | grep -qF "🐙 Team ${n}"; do n=$((n+1)); done
    team="${n}"
  fi
  "$CMUX" workspace-action --action rename --workspace "$ws" --title "🐙 Team ${team}"
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
  spawn-split)  cmd_spawn_split "$@" ;;
  name-orchestrator) cmd_name_orchestrator "$@" ;;
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
    sed -n '2,48p' "$0" ;;
  *) die "unknown subcommand: $sub (run: swarm.sh help)" ;;
esac
