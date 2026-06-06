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
#   swarm.sh spawn-dashboard [interval] [autofit 1|0]
#                                               → sticky team-status pane above the orchestrator (auto-fits its
#                                                 height; animated spinner on working workers; repo@branch header)
#   swarm.sh dashboard [ws] [icon]              → render the team overview once (one line per worker)
#   swarm.sh dashboard-loop [interval] [autofit] [ws] [surf]
#                                               → self-refreshing dashboard; runs INSIDE the dashboard pane
#   swarm.sh queue <done> <total>               → record shipped/total task progress (header shows "shipped d/t")
#   swarm.sh retire <ws> <surf>                 → close a worker (split pane or tab) + drop it from the dashboard
#
# Team state: spawn/dispatch/reset record workers in ${TMPDIR}/cmux-swarm-<orchestrator-ws>.state
# (rows "W|n|ws|surf|repo|task|dispatch_epoch|base_sha", one "Q|done|total"). The dashboard
# reads it; workers spawned without swarm.sh won't appear.
#
# Monitoring philosophy (most robust → least):
#   1. commit-aware  (wait-commit)  — best signal for code tasks.
#   2. footer marker (status/wait-idle) — "esc to interrupt"=working, "for agents"=idle.
#   3. anchored DONE:/BLOCKED: <task-id> in the final screen line (caller greps `read`).
set -euo pipefail
# Char-based (not byte-based) string lengths — the dashboard's border math measures
# strings containing multibyte glyphs, and the dashboard pane may run with locale C.
export LC_ALL=en_US.UTF-8

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

# --- team state (powers the dashboard) ----------------------------------------
# One file per team, keyed by the ORCHESTRATOR's workspace ref (spawn/dispatch/reset all
# run from the orchestrator session, and the dashboard pane lives in its workspace, so
# they all resolve the same file). Rows:
#   W|<n>|<ws>|<surf>|<repo>|<task>|<dispatch_epoch>|<base_sha>
#   Q|<done>|<total>
#   T|<team label>
#   R|<team repo>   (the orchestrator's cwd, recorded by name-orchestrator)
# Pinned to /tmp (not $TMPDIR): the dashboard pane is launched by the cmux app and may
# carry a different TMPDIR than the orchestrator's shell — both must resolve one file.
# Optional $1 = explicit workspace ref (the dashboard pane passes it; `cmux identify`
# inside that pane falls back to the FOCUSED surface, so it must not rely on it).
state_file() {
  local ws="${1:-}"
  [[ -n "$ws" ]] || ws="$(caller_ws || true)"
  [[ -n "$ws" ]] || return 1
  echo "/tmp/cmux-swarm-${ws//:/-}.state"
}
state_set_row() {  # <tag> <value> — replace the single row with this tag
  local f; f="$(state_file)" || return 0
  local tmp="${f}.tmp"
  awk -F'|' -v t="$1" '$1!=t' "$f" 2>/dev/null > "$tmp" || true
  echo "$1|${2//|/ }" >> "$tmp"
  mv "$tmp" "$f"
}
state_row() {  # <tag> [ws] — read the single row with this tag
  local f; f="$(state_file "${2:-}")" || return 1
  [[ -f "$f" ]] || return 1
  grep "^$1|" "$f" 2>/dev/null | tail -1 | cut -d'|' -f2-
}
state_set_team() { state_set_row T "$1"; }
state_team() {  # [ws]
  local f; f="$(state_file "${1:-}")" || return 1
  [[ -f "$f" ]] || return 1
  grep '^T|' "$f" 2>/dev/null | tail -1 | cut -d'|' -f2
}
state_register() {  # <n> <ws> <surf> <repo>
  local f; f="$(state_file)" || return 0
  local tmp="${f}.tmp"
  awk -F'|' -v n="$1" '!($1=="W" && $2==n)' "$f" 2>/dev/null > "$tmp" || true
  echo "W|$1|$2|$3|$4||0|" >> "$tmp"
  mv "$tmp" "$f"
}
state_on_dispatch() {  # <ws> <surf> <task>
  local f; f="$(state_file)" || return 0
  [[ -f "$f" ]] || return 0
  local task="${3//|/ }" now repo sha=""
  now="$(date +%s)"
  repo="$(awk -F'|' -v w="$1" -v s="$2" '$1=="W" && $3==w && $4==s {print $5; exit}' "$f")"
  if [[ -n "$repo" ]]; then sha="$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)"; fi
  local tmp="${f}.tmp"
  awk -F'|' -v OFS='|' -v w="$1" -v s="$2" -v t="$task" -v e="$now" -v b="$sha" '
    $1=="W" && $3==w && $4==s { $6=t; $7=e; $8=b } { print }' "$f" > "$tmp" && mv "$tmp" "$f"
}
state_on_reset() {  # <ws> <surf>
  local f; f="$(state_file)" || return 0
  [[ -f "$f" ]] || return 0
  local tmp="${f}.tmp"
  awk -F'|' -v OFS='|' -v w="$1" -v s="$2" '
    $1=="W" && $3==w && $4==s { $6=""; $7=0; $8="" } { print }' "$f" > "$tmp" && mv "$tmp" "$f"
}
state_remove() {  # <ws> <surf>
  local f; f="$(state_file)" || return 0
  [[ -f "$f" ]] || return 0
  local tmp="${f}.tmp"
  awk -F'|' -v w="$1" -v s="$2" '!($1=="W" && $3==w && $4==s)' "$f" > "$tmp" && mv "$tmp" "$f"
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
  state_register "$n" "$ws" "$surf" "$repo"
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
  state_register "$n" "$ws" "$surf" "$repo"
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
  state_set_row R "$PWD"   # team repo — shown as repo@branch in the dashboard header
  # Workspace label — keep an existing 🐙 Team name (idempotent re-runs), else claim the
  # first constellation not already used by another workspace. cmux auto-titles can
  # overwrite the workspace label, so the claimed name is also persisted in the state
  # file (T row) — that's what the dashboard displays and what re-runs reuse.
  local team="" t
  team="$(state_team || true)"
  if [[ -n "$team" ]]; then
    "$CMUX" workspace-action --action rename --workspace "$ws" --title "$team"
    return 0
  fi
  team="$("$CMUX" list-workspaces 2>/dev/null | grep -E "${ws}[^0-9]" | grep -oE "🐙 Team [[:alnum:]]+" | head -1 || true)"
  if [[ -n "$team" ]]; then
    state_set_team "$team"   # workspace already labelled — persist it for the dashboard
    return 0
  fi
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
  state_set_team "🐙 Team ${team}"
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
  state_on_dispatch "$ws" "$surf" "$gist"
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
  state_on_reset "$ws" "$surf"
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

# --- dashboard ----------------------------------------------------------------
# The machine's LAN address — what a phone on the same network dials. macOS-only
# (this plugin is macOS-only anyway); en0 is Wi-Fi/primary, en1 the fallback.
lan_ip() {
  ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true
}

# One snapshot of every listening TCP server on the box: "cwd|port|bind" lines.
# Two lsof calls total (listeners, then their cwds) — taken ONCE per dashboard
# render, then filtered per worker, so cost doesn't scale with team size.
ports_snapshot() {
  command -v lsof >/dev/null 2>&1 || return 0
  local listen pids cwds
  listen="$(lsof -nP -iTCP -sTCP:LISTEN -Fpn 2>/dev/null || true)"
  [[ -n "$listen" ]] || return 0
  pids="$(awk '/^p/{print substr($0,2)}' <<<"$listen" | sort -u | paste -sd, -)"
  [[ -n "$pids" ]] || return 0
  cwds="$(lsof -a -p "$pids" -d cwd -Fn 2>/dev/null || true)"
  awk '
    NR==FNR { if (/^p/) pid=substr($0,2); else if (/^n/) cwd[pid]=substr($0,2); next }
    /^p/ { pid=substr($0,2); next }
    /^n/ {
      if (!(pid in cwd)) next
      addr=substr($0,2)
      port=addr; sub(/^.*:/,"",port)
      if (port !~ /^[0-9]+$/) next
      bind=addr; sub(/:[0-9]+$/,"",bind)
      print cwd[pid] "|" port "|" bind
    }
  ' <(printf '%s\n' "$cwds") <(printf '%s\n' "$listen")
}

# Filter the snapshot to one worker's repo/worktree (cwd == repo or inside it).
# Prints deduped "port|*" (bound on all interfaces → reachable over LAN) or
# "port|local" lines, lowest port first. v4+v6 dual-binds collapse to one row.
repo_ports() {  # <repo> <snapshot>
  [[ -n "$1" && -n "${2:-}" ]] || return 0
  awk -F'|' -v repo="$1" '
    $1 == repo || index($1, repo "/") == 1 {
      seen[$2] = 1
      if ($3 == "*" || $3 == "0.0.0.0" || $3 == "[::]") exposed[$2] = 1
    }
    END { for (p in seen) print p "|" (p in exposed ? "*" : "local") }
  ' <<<"$2" | sort -t'|' -k1,1n
}

fmt_age() {
  local s="$1"
  if   (( s < 60 ));   then echo "${s}s"
  elif (( s < 3600 )); then echo "$((s/60))m"
  else                      echo "$((s/3600))h"; fi
}

cmd_queue() {  # <done> <total> — or "clear"/no args to remove the counter from the header
  local f; f="$(state_file)" || die "must run inside cmux"
  local tmp="${f}.tmp"
  awk -F'|' '$1!="Q"' "$f" 2>/dev/null > "$tmp" || true
  if [[ -n "${1:-}" && "$1" != "clear" ]]; then
    echo "Q|$1|$2" >> "$tmp"
  fi
  mv "$tmp" "$f"
}

# Render the team overview once. Layout — a dim rounded box; the top border carries the
# bold team name (left) and the team overview (right): repo@branch · busy · queue.
# Inside: a blank spacer, bold column labels, then one row per worker:
#    ╭─ 🐙 Team Orion ───────────────────────────────── agentic-kit@main · busy 1/2 · shipped 2/5 ─╮
#    │                                                                                             │
#    │       TASK                      WORKTREE      PORT    NETWORK           STATUS         AGE │
#    │ W0  ⠧  fix-auth                 agentic-kit   :5173   192.168.1.7:5173  +2 ahead        4m │
#    │ W1  ✓  dark-mode                ak-w1         :5174   -                 merged         12m │
#    ╰─────────────────────────────────────────────────────────────────────────────────────────────╯
# PORT/NETWORK are auto-detected per refresh (lsof): listening TCP servers whose process
# cwd is inside the worker's repo/worktree. NETWORK shows the LAN ip:port (green) when the
# server is bound on all interfaces — i.e. reachable from phones on the same network.
# STATUS is the task's git lifecycle (open → wip → +n ahead → +n pushed → merged), derived
# from the worker's worktree against the team repo's HEAD; see the legend in cmd_dashboard.
# If the overview can't fit the top border (long branch names), it falls back to a
# right-aligned interior line.
# Right-border alignment: every interior line is padded to a fixed inner width; the
# plain (escape-free) width is tracked alongside each colored string, and worker/header
# rows have constant width by construction (ASCII-only printf-padded fields).
# Worker rows use single-width glyphs and ASCII-only padded fields (printf pads by
# bytes, double-width emoji and multibyte chars are what broke alignment in v1).
# $1 = the team's (orchestrator's) workspace ref; defaults to the caller's.
# $2 = icon for WORKING rows (default ⠿). The dashboard-loop passes a \x01 placeholder
#      and substitutes rotating spinner frames per tick without re-fetching the data.
cmd_dashboard() {
  need_cmux
  local ws="${1:-}" spin="${2:-⠿}"
  [[ -n "$ws" ]] || ws="$(caller_ws)"
  local f; f="$(state_file "$ws")" || die "must run inside cmux"
  local now; now="$(date +%s)"
  local dim=$'\e[2m' off=$'\e[0m' grn=$'\e[32m' ylw=$'\e[33m' red=$'\e[31m' bld=$'\e[1m' cyn=$'\e[36m'
  # Team label: prefer the persisted T row (cmux auto-titles can overwrite the
  # workspace label), fall back to the workspace's current title.
  local team
  team="$(state_team "$ws" || true)"
  if [[ -z "$team" ]]; then
    team="$("$CMUX" list-workspaces 2>/dev/null | grep -E "${ws}([^0-9]|\$)" | head -1 \
      | sed -E 's/^[*[:space:]]*workspace:[0-9]+[[:space:]]+//; s/[[:space:]]*\[selected\][[:space:]]*$//')"
  fi
  [[ -n "$team" ]] || team="(team)"
  # repo@branch — the team repo from the R row, else the first worker's repo.
  local trepo tbranch=""
  trepo="$(state_row R "$ws" || true)"
  if [[ -z "$trepo" && -f "$f" ]]; then
    trepo="$(grep '^W|' "$f" 2>/dev/null | head -1 | cut -d'|' -f5 || true)"
  fi
  if [[ -n "$trepo" ]]; then
    tbranch="$(git -C "$trepo" branch --show-current 2>/dev/null || true)"
    [[ -n "$tbranch" ]] || tbranch="$(git -C "$trepo" rev-parse --short HEAD 2>/dev/null || true)"
  fi
  # ----- box helpers. Interior width WIN; table row width is 103 by construction:
  # " %-3s  %s  %-28s  %-14s  %-6s  %-21s  %-10s  %5s" = 1+3+2+1+2+28+2+14+2+6+2+21+2+10+2+5.
  local WIN=104
  local tdw=${#team}
  if [[ "$team" == *"🐙"* ]]; then tdw=$((tdw+1)); fi   # emoji renders double-width
  local bbot=" ${dim}╰$(printf '─%.0s' $(seq "$WIN"))╯${off}"
  local bblank=" ${dim}│${off}$(printf '%*s' "$WIN" '')${dim}│${off}"
  box() {  # <colored content> <plain width> → one bordered interior line
    local pad=$(( WIN - $2 ))
    if (( pad < 0 )); then pad=0; fi
    printf ' %s│%s%s%*s%s│%s\n' "$dim" "$off" "$1" "$pad" '' "$dim" "$off"
  }
  # Team overview (repo@branch · busy · queue) — embedded in the TOP BORDER, right of
  # the team name, so it reads as box chrome rather than competing with the table's
  # alignment. If it can't fit (long branch names), it falls back to a right-aligned
  # interior line instead.
  local info="" infop="" isep="${dim} · ${off}" isepp=" · "
  if [[ -n "$trepo" ]]; then
    local rb; rb="$(basename "$trepo")"
    info+="${rb}${dim}@${off}${tbranch:-?}"
    infop+="${rb}@${tbranch:-?}"
  fi
  local btop="" info_inside=""
  box_top() {  # assemble btop once `info`/`infop` are complete
    local idw=${#infop} fill
    if (( idw > 0 )); then fill=$(( WIN - tdw - idw - 6 )); else fill=$(( WIN - tdw - 3 )); fi
    if (( idw > 0 && fill >= 1 )); then
      btop=" ${dim}╭─${off} ${bld}${team}${off} ${dim}$(printf '─%.0s' $(seq "$fill"))${off} ${info} ${dim}─╮${off}"
      info_inside=""
    else
      fill=$(( WIN - tdw - 3 )); if (( fill < 1 )); then fill=1; fi
      btop=" ${dim}╭─${off} ${bld}${team}${off} ${dim}$(printf '─%.0s' $(seq "$fill"))╮${off}"
      info_inside="$infop"
    fi
  }
  box_info_inside() {  # fallback: right-aligned overview line inside the box
    local ipad=$(( WIN - ${#infop} - 1 ))
    if (( ipad < 0 )); then ipad=0; fi
    box "$(printf '%*s' "$ipad" '')${info}" $(( ipad + ${#infop} ))
  }
  local colhdr=" ${bld}$(printf '%-3s  %s  %-28s  %-14s  %-6s  %-21s  %-10s  %5s' '' ' ' 'TASK' 'WORKTREE' 'PORT' 'NETWORK' 'STATUS' 'AGE')${off}"
  # Dev-server detection: one lsof snapshot per render, filtered per worker row.
  local psnap lan
  psnap="$(ports_snapshot || true)"
  lan="$(lan_ip || true)"
  if [[ ! -f "$f" ]] || ! grep -q '^W|' "$f"; then
    box_top
    printf '%s\n' "$btop"
    if [[ -n "$info_inside" ]]; then box_info_inside; fi
    box " ${dim}no workers yet${off}" 15
    printf '%s\n' "$bbot"
    return 0
  fi
  local rows="" busy=0 gone=0 count=0
  local tag n wws wsurf repo task epoch sha icon screen wt age tcol
  while IFS='|' read -r tag n wws wsurf repo task epoch sha; do
    [[ "$tag" == "W" ]] || continue
    count=$((count+1))
    local working=0
    if screen="$("$CMUX" read-screen --workspace "$wws" --surface "$wsurf" 2>/dev/null)"; then
      if   grep -qiF "esc to interrupt" <<<"$screen"; then icon="${ylw}${spin}${off}"; busy=$((busy+1)); working=1
      elif grep -qiF "for agents"       <<<"$screen"; then icon="${grn}✓${off}"
      else icon="${dim}?${off}"; fi
    else icon="${red}✖${off}"; gone=$((gone+1)); fi
    # STATUS — the task's git lifecycle, auto-derived from the worker's worktree:
    #   -          no task dispatched
    #   open       dispatched, nothing landed yet
    #   wip        uncommitted changes, no commits yet
    #   +n ahead   n commits since dispatch, not merged into the team repo's HEAD
    #   +n pushed  those commits are also up on the branch's upstream
    #   merged     worker HEAD is an ancestor of the team repo's HEAD
    # A trailing * marks uncommitted changes on top of the shown state.
    # (Pad plain ASCII first, colorize after — escape bytes and multibyte glyphs
    #  would skew printf's byte-based padding.)
    local scell stxt scol="$dim" cnum=0 dirty=""
    if [[ -z "$task" ]]; then
      stxt="-"
    else
      if [[ -n "$repo" && -n "$sha" ]]; then
        cnum="$(git -C "$repo" rev-list --count "${sha}..HEAD" 2>/dev/null || echo 0)"
      fi
      if [[ -n "$repo" ]] && [[ -n "$(git -C "$repo" status --porcelain 2>/dev/null | head -1)" ]]; then
        dirty="*"
      fi
      if (( cnum > 0 )); then
        local whead=""
        whead="$(git -C "$repo" rev-parse HEAD 2>/dev/null || true)"
        if [[ -n "$whead" && -n "$trepo" ]] \
           && git -C "$trepo" merge-base --is-ancestor "$whead" HEAD 2>/dev/null; then
          stxt="merged${dirty}"; scol="$grn"
        elif [[ -z "$(git -C "$repo" rev-list "@{u}..HEAD" 2>/dev/null | head -1)" ]] \
             && git -C "$repo" rev-parse "@{u}" >/dev/null 2>&1; then
          stxt="+${cnum} pushed${dirty}"; scol="$cyn"
        else
          stxt="+${cnum} ahead${dirty}"; scol="$ylw"
        fi
      elif [[ -n "$dirty" ]]; then
        stxt="wip"; scol="$ylw"
      else
        stxt="open"; scol="$dim"
      fi
    fi
    scell="$(printf '%-10s' "${stxt:0:10}")"; scell="${scol}${scell}${off}"
    age="$(printf '%5s' '-')"
    if [[ "$epoch" =~ ^[0-9]+$ && "$epoch" -gt 0 ]]; then age="$(printf '%5s' "$(fmt_age $((now - epoch)))")"; fi
    age="${dim}${age}${off}"
    # Hierarchy: the ACTIVE task is the loudest cell on the row; finished/idle tasks dim.
    task="${task:--}"; tcol="$(printf '%-28s' "${task:0:28}")"
    if (( working )); then tcol="${tcol}"; else tcol="${dim}${tcol}${off}"; fi
    wt="$(basename "${repo:--}")"; wt="$(printf '%-14s' "${wt:0:14}")"
    # Dev server: PORT = the worker's listening port(s); NETWORK = the LAN URL a
    # phone on the same network can open (green = bound on all interfaces).
    local pline port="" nport="" extra=0 pcell ncell ptxt
    pline="$(repo_ports "${repo:-}" "$psnap")"
    if [[ -n "$pline" ]]; then
      extra=$(( $(wc -l <<<"$pline") - 1 ))
      port="$(head -1 <<<"$pline" | cut -d'|' -f1)"                        # lowest port
      nport="$(grep '|\*$' <<<"$pline" | head -1 | cut -d'|' -f1 || true)" # first LAN-exposed port
    fi
    pcell="$(printf '%-6s' '-')"; pcell="${dim}${pcell}${off}"
    ncell="$(printf '%-21s' '-')"; ncell="${dim}${ncell}${off}"
    if [[ -n "$port" ]]; then
      ptxt=":${port}"; (( extra > 0 )) && ptxt+="+"
      pcell="$(printf '%-6s' "${ptxt:0:6}")"
    fi
    if [[ -n "$nport" ]]; then
      ncell="$(printf '%-21s' "${lan:-0.0.0.0}:${nport}")"; ncell="${grn}${ncell}${off}"
    fi
    rows+="$(box " $(printf '%-3s' "W$n")  ${icon}  ${tcol}  ${dim}${wt}${off}  ${pcell}  ${ncell}  ${scell}  ${age}" 103)"$'\n'
  done < <(grep '^W|' "$f" | sort -t'|' -k2,2n)
  if [[ -n "$infop" ]]; then info+="$isep"; infop+="$isepp"; fi
  info+="${dim}busy${off} ${busy}/${count}"
  infop+="busy ${busy}/${count}"
  if (( gone > 0 )); then
    info+="${isep}${red}${gone} gone${off}"
    infop+="${isepp}${gone} gone"
  fi
  local qline; qline="$(grep '^Q|' "$f" 2>/dev/null | tail -1 || true)"
  if [[ -n "$qline" ]]; then
    local qv; qv="$(cut -d'|' -f2 <<<"$qline")/$(cut -d'|' -f3 <<<"$qline")"
    # Label is "shipped", not "queue": the counter is <done>/<total>, and "queue 3/6"
    # misreads as "3 still waiting" when it means "3 of 6 shipped".
    info+="${isep}${dim}shipped${off} ${qv}"
    infop+="${isepp}shipped ${qv}"
  fi
  box_top
  printf '%s\n' "$btop"
  if [[ -n "$info_inside" ]]; then box_info_inside; fi
  printf '%s\n' "$bblank"
  box "$colhdr" 103
  printf '%s' "$rows"
  printf '%s\n' "$bbot"
}

# Auto-fit the dashboard pane's height to its content (runs inside the pane, so
# `tput lines` is its own height). One adjustment per refresh → converges in a cycle or two.
# cmux resize-pane semantics (verified): the direction picks which border to move, the
# amount is in PIXELS, and a move always GROWS the pane (amount must be > 0). So:
# grow the dashboard = its own bottom border down (-D); shrink it = grow the pane
# directly BELOW it upward (-U on that neighbor).
# Echoes "1" on stdout iff it issued a real resize this call — the loop uses that to do a
# one-shot full clear (the resize reflows the grid async; see cmd_dashboard_loop).
# Back-off state lives in a file (this runs in a $(...) subshell, so shell globals here
# would not survive to the next call): if our last resize toward the same target left the
# pane's actual rows unchanged, the pane is pinned (neighbour at min height) and hammering
# it every cycle just churns the layout — wait for the content to change instead.
autofit_pane() {  # <content> <ws> <surf>
  local content="$1" ws="$2" surf="$3" want rows delta pane
  [[ -n "$ws" && -n "$surf" ]] || return 0
  want=$(( $(wc -l <<<"$content") + 1 ))
  (( want >= 3 )) || want=3
  pane="$(pane_of_surface "$ws" "$surf" || true)"; [[ -n "$pane" ]] || return 0
  # Per-pane geometry "ref|x|y|cell_h|rows" from the pretty-printed rpc JSON
  # (alphabetical keys: cell_height_px … pixel_frame{height,width,x,y} … ref … rows;
  # exact-match $1 so selected_surface_ref/surface_refs lines don't hit the "ref" rule).
  # The pane's CURRENT rows come from here too — NOT from `tput lines`: the PTY of a
  # staged-then-moved surface keeps the 80x24 default winsize and never learns its
  # real size, so tput reports 24 regardless of the actual grid.
  local geom
  geom="$("$CMUX" rpc pane.list "{\"workspace\":\"$ws\"}" 2>/dev/null | awk '
    function v(s) { gsub(/[",]/, "", s); sub(/\..*$/, "", s); return s }
    $1 == "\"cell_height_px\"" { cell = v($3) }
    $1 == "\"pixel_frame\""    { pf = 1 }
    pf && $1 == "\"x\""        { x = v($3) }
    pf && $1 == "\"y\""        { y = v($3) }
    $1 == "\"ref\""            { ref = v($3); pf = 0 }
    $1 == "\"rows\""           { print ref "|" x "|" y "|" cell "|" v($3) }
  ')"
  local self_x="" self_y="" cell=17 ref x y c r
  rows=0
  while IFS='|' read -r ref x y c r; do
    if [[ "$ref" == "$pane" ]]; then self_x="$x"; self_y="$y"; cell="${c:-17}"; rows="${r:-0}"; fi
  done <<<"$geom"
  [[ -n "$self_y" ]] || return 0
  (( rows > 0 )) || return 0
  delta=$(( want - rows ))
  # Back-off bookkeeping (see header comment).
  local fitf="/tmp/cmux-swarm-${ws//:/-}.dashfit" lw=-1 lr=-1
  [[ -f "$fitf" ]] && read -r lw lr <"$fitf" 2>/dev/null
  if (( delta == 0 )); then printf '%s %s' "$want" "$rows" >"$fitf" 2>/dev/null || true; return 0; fi
  # Pinned: same target as last time and the pane didn't budge → stop hammering it.
  if (( want == lw && rows == lr )); then return 0; fi
  printf '%s %s' "$want" "$rows" >"$fitf" 2>/dev/null || true
  local px=$(( (delta < 0 ? -delta : delta) * cell ))
  if (( delta > 0 )); then
    "$CMUX" resize-pane --pane "$pane" --workspace "$ws" -D --amount "$px" >/dev/null 2>&1 || true
  else
    # Nearest pane below in the same column.
    local below="" below_y=999999
    while IFS='|' read -r ref x y c r; do
      if [[ "$ref" != "$pane" && "$x" == "$self_x" ]] && (( y > self_y && y < below_y )); then
        below="$ref"; below_y="$y"
      fi
    done <<<"$geom"
    [[ -n "$below" ]] || return 0
    "$CMUX" resize-pane --pane "$below" --workspace "$ws" -U --amount "$px" >/dev/null 2>&1 || true
  fi
  printf 1
}

# The loop that runs inside the dashboard pane. Args: [interval] [autofit 1|0] [ws] [surf]
# ws/surf = the pane's own refs, passed explicitly by spawn-dashboard: `cmux identify`
# inside this pane falls back to the FOCUSED surface (its spawn-time env points at the
# closed staging workspace), so self-resolution must not go through identify.
# Data is fetched once per interval; while any worker is WORKING the \x01 icon
# placeholder is re-rendered with rotating spinner frames at 4 fps. Frames live in an
# array (not a sliced string) so a C-locale pane can't split the multibyte glyphs.
cmd_dashboard_loop() {
  local interval="${1:-5}" autofit="${2:-1}" ws="${3:-}" surf="${4:-}"
  local frames=(⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏) idx=0 steps raw out k lead did
  set +e   # the loop is a daemon — render errors must not kill it
  tput civis 2>/dev/null || true
  trap 'tput cnorm 2>/dev/null || true' EXIT
  steps=$(( interval * 4 )); (( steps >= 1 )) || steps=1
  # Single-renderer lock: only ONE loop may drive a given workspace's pane. If the skill
  # is re-run, a second dashboard is spawned, or a stale loop survives a reload, the newest
  # loop's PID wins the lock and older loops step aside next tick — two loops both printing
  # at \033[H and both autofitting is itself a cause of stacked headers + resize thrash.
  local lock=""
  if [[ -n "$ws" ]]; then lock="/tmp/cmux-swarm-${ws//:/-}.dashlock"; echo $$ >"$lock"; fi
  while true; do
    [[ -n "$lock" && "$(cat "$lock" 2>/dev/null)" != "$$" ]] && exit 0
    raw="$(cmd_dashboard "$ws" $'\x01' 2>&1 || true)"
    did=0
    if [[ "$autofit" == "1" ]]; then
      [[ "$(autofit_pane "$raw" "$ws" "$surf")" == 1 ]] && did=1
    fi
    # A real resize reflows the PTY grid asynchronously; drawing into the still-small grid
    # scrolls the frame's top into scrollback, which reappears as stacked headers once the
    # pane grows. After a resize: settle briefly, then draw with a full screen+scrollback
    # clear so nothing stale survives. Steady state keeps the cheap no-flicker path.
    lead=$'\033[H'
    if (( did )); then lead=$'\033[H\033[2J\033[3J'; sleep 0.15; fi
    if [[ "$raw" == *$'\x01'* ]]; then
      for (( k = 0; k < steps; k++ )); do
        out="${raw//$'\x01'/${frames[idx % 10]}}"; idx=$((idx+1))
        out="${out//$'\n'/$'\e[K\n'}"                 # clear-to-EOL per line: no flicker,
        printf '%s%s\033[K\033[J' "$lead" "$out"       # full clear only on the post-resize frame
        lead=$'\033[H'
        sleep 0.25
      done
    else
      out="${raw//$'\n'/$'\e[K\n'}"
      printf '%s%s\033[K\033[J' "$lead" "$out"
      sleep "$interval"
    fi
  done
}

# Spawn the sticky status pane: split UP from the orchestrator's own pane, running
# dashboard-loop. Stage-and-move like spawn-split, but with a PLAIN shell — the loop
# command is sent AFTER the split, so the pane's own ws/surf refs can be passed as args
# (identify is focus-fallback-unreliable inside the pane; see cmd_dashboard_loop).
cmd_spawn_dashboard() {
  need_cmux
  local interval="${1:-5}" autofit="${2:-1}"
  local ws surf pane
  ws="$(caller_ws)";       [[ -n "$ws" ]] || die "spawn-dashboard must run inside cmux"
  surf="$(caller_surface)"; [[ -n "$surf" ]] || die "could not identify caller surface"
  pane="$(pane_of_surface "$ws" "$surf")" || die "could not find caller pane"
  local script; script="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
  local tmpname="⏳ spawn-dash"
  "$CMUX" new-workspace \
    --name "$tmpname" \
    --cwd "${TMPDIR:-/tmp}" \
    --focus false >/dev/null
  local tws; tws="$(ws_ref_by_name "$tmpname")"
  [[ -n "$tws" ]] || die "could not resolve temp workspace '$tmpname'"
  local dsurf; dsurf="$(first_surface_of "$tws")"
  [[ -n "$dsurf" ]] || die "could not resolve surface ref for $tws"
  "$CMUX" move-surface --surface "$dsurf" --pane "$pane" --focus false >/dev/null
  "$CMUX" split-off --surface "$dsurf" up --workspace "$ws" --focus false >/dev/null
  "$CMUX" close-workspace --workspace "$tws" >/dev/null 2>&1 || true
  "$CMUX" rename-tab --workspace "$ws" --surface "$dsurf" "📊 Swarm" >/dev/null 2>&1 || true
  # Force the orchestrator's own workspace to render — a cmux pane only attaches its PTY
  # once its workspace is the rendered/active one. When Claude starts up, the active tab
  # is often some OTHER workspace, so this dashboard pane never renders and read-screen
  # below times out (same failure as Pitfall #1 "Skipping the PTY force" for `spawn`).
  "$CMUX" select-workspace --workspace "$ws" >/dev/null 2>&1 || true
  local waited=0
  until "$CMUX" read-screen --workspace "$ws" --surface "$dsurf" >/dev/null 2>&1; do
    (( waited >= 30 )) && die "PTY did not attach for $dsurf after 30s"
    sleep 1; waited=$((waited+1))
  done
  # Launch the loop with the pane's own refs baked in.
  "$CMUX" send --workspace "$ws" --surface "$dsurf" \
    "exec bash '$script' dashboard-loop $interval $autofit $ws $dsurf"
  "$CMUX" send-key --workspace "$ws" --surface "$dsurf" enter
  # split-off can steal focus despite --focus false — give it back to the caller.
  "$CMUX" focus-pane --pane "$pane" --workspace "$ws" >/dev/null 2>&1 || true
  echo "WORKSPACE=$ws"
  echo "SURFACE=$dsurf"
}

cmd_retire() {  # <ws> <surf> — close a worker pane/tab and drop it from the dashboard
  need_cmux
  local ws="$1" surf="$2"
  local ows; ows="$(caller_ws || true)"
  if [[ "$ws" == "$ows" ]]; then
    "$CMUX" close-surface --surface "$surf" --workspace "$ws" >/dev/null   # split mode
  else
    "$CMUX" close-workspace --workspace "$ws" >/dev/null                   # tab mode
  fi
  state_remove "$ws" "$surf"
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
  spawn-dashboard) cmd_spawn_dashboard "$@" ;;
  dashboard)       cmd_dashboard "$@" ;;
  dashboard-loop)  cmd_dashboard_loop "$@" ;;
  queue)           cmd_queue "$@" ;;
  retire)          cmd_retire "$@" ;;
  ""|-h|--help|help)
    awk 'NR>1 { if (!/^#/) exit; print }' "$0" ;;
  *) die "unknown subcommand: $sub (run: swarm.sh help)" ;;
esac
