#!/usr/bin/env bash
# Idempotent setup for a new machine. Symlinks skills into ~/.claude/skills/
# (and ~/.cursor/skills-cursor/ if Cursor is present).
#
# Handles two layouts under skills/:
#   skills/<name>/SKILL.md              → linked as <name>
#   skills/<repo>/<name>/SKILL.md       → each sub-skill linked individually
#                                         (for multi-skill upstream repos like greptile)
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"
CURSOR_SKILLS_DIR="$HOME/.cursor/skills-cursor"

mkdir -p "$CLAUDE_SKILLS_DIR"

# Build target list. Each line: "<skill_name>\t<absolute_skill_path>"
targets=()
for entry in "$KIT_DIR"/skills/*/; do
  entry="${entry%/}"
  name="$(basename "$entry")"

  # cmux-swarm ships as a standalone plugin (plugins/cmux-swarm), installed via
  #   /plugin marketplace add <this-repo>  →  /plugin install cmux-swarm@agentic-kit
  # Do NOT also symlink it as loose skills, or create-swarm/code-check/visual-check
  # would be registered twice. Skip it here regardless of where it lives.
  if [[ "$name" == "cmux-swarm" ]]; then
    echo "skip $name: provided by the cmux-swarm plugin (see plugins/cmux-swarm)"
    continue
  fi

  if [[ -f "$entry/SKILL.md" ]]; then
    targets+=("$name"$'\t'"$entry")
    continue
  fi

  # Multi-skill repo: look one level deeper for SKILL.md files.
  found_subskill=0
  for sub in "$entry"/*/; do
    [[ -d "$sub" ]] || continue
    sub="${sub%/}"
    if [[ -f "$sub/SKILL.md" ]]; then
      targets+=("$(basename "$sub")"$'\t'"$sub")
      found_subskill=1
    fi
  done

  if [[ "$found_subskill" -eq 0 ]]; then
    echo "warn $name: no SKILL.md at top level or one level down — skipping"
  fi
done

link_into() {
  local dest_dir="$1" skill_name="$2" skill_path="$3"
  local target="$dest_dir/$skill_name"
  local label="${dest_dir/#$HOME/~}"

  if [[ -L "$target" ]]; then
    local current
    current="$(readlink "$target")"
    if [[ "$current" == "$skill_path" ]]; then
      echo "ok   $skill_name → $label (already linked)"
      return
    fi
    echo "warn $skill_name: $label symlink points elsewhere ($current) — skipping"
    return
  fi

  if [[ -e "$target" ]]; then
    echo "warn $skill_name: real file/dir exists at $target — skipping (move it manually)"
    return
  fi

  ln -s "$skill_path" "$target"
  echo "link $skill_name → $label"
}

for row in "${targets[@]}"; do
  skill_name="${row%%$'\t'*}"
  skill_path="${row#*$'\t'}"

  link_into "$CLAUDE_SKILLS_DIR" "$skill_name" "$skill_path"
  if [[ -d "$CURSOR_SKILLS_DIR" ]]; then
    link_into "$CURSOR_SKILLS_DIR" "$skill_name" "$skill_path"
  fi
done

echo
echo "Done. Skills available in $CLAUDE_SKILLS_DIR."
if [[ -d "$CURSOR_SKILLS_DIR" ]]; then
  echo "Also linked into $CURSOR_SKILLS_DIR."
fi
echo "Conventions: $KIT_DIR/conventions/  (see todo.md for what to capture next)"
