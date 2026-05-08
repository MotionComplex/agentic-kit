#!/usr/bin/env bash
# Idempotent setup for a new machine. Symlinks skills into ~/.claude/skills/.
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_SKILLS_DIR="$HOME/.claude/skills"

mkdir -p "$CLAUDE_SKILLS_DIR"

for skill_path in "$KIT_DIR"/skills/*/; do
  skill_name="$(basename "$skill_path")"
  target="$CLAUDE_SKILLS_DIR/$skill_name"

  if [[ -L "$target" ]]; then
    current="$(readlink "$target")"
    if [[ "$current" == "$skill_path"* ]] || [[ "$current" == "${skill_path%/}" ]]; then
      echo "ok   $skill_name (already linked)"
      continue
    fi
    echo "warn $skill_name: existing symlink points elsewhere ($current) — skipping"
    continue
  fi

  if [[ -e "$target" ]]; then
    echo "warn $skill_name: real file/dir exists at $target — skipping (move it manually)"
    continue
  fi

  ln -s "${skill_path%/}" "$target"
  echo "link $skill_name"
done

echo
echo "Done. Skills available in $CLAUDE_SKILLS_DIR."
echo "Conventions: $KIT_DIR/conventions/  (see todo.md for what to capture next)"
