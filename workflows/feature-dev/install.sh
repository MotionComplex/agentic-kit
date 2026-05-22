#!/usr/bin/env bash
# Install feature-dev workflow into a target git repo.
# Usage: install.sh <target-repo-path> [--yes]
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$KIT_DIR/source"

TARGET=""
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --yes) ASSUME_YES=1 ;;
    -*) echo "unknown flag: $arg" >&2; exit 2 ;;
    *) TARGET="${arg%/}" ;;
  esac
done

[[ -z "$TARGET" ]] && { echo "usage: install.sh <target-repo-path> [--yes]" >&2; exit 2; }
[[ ! -d "$TARGET/.git" ]] && { echo "error: not a git repo: $TARGET" >&2; exit 1; }

prompt_overwrite() {
  local relpath="$1"
  [[ "$ASSUME_YES" -eq 1 ]] && return 0
  read -r -p "  overwrite $relpath? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]]
}

copy_file() {
  local src="$1" dest="$2" relpath="$3"
  mkdir -p "$(dirname "$dest")"
  if [[ ! -e "$dest" ]]; then
    cp "$src" "$dest"
    echo "  added   $relpath"
    return
  fi
  if cmp -s "$src" "$dest"; then
    echo "  ok      $relpath (identical)"
    return
  fi
  echo "  differs $relpath"
  if prompt_overwrite "$relpath"; then
    cp "$src" "$dest"
    echo "  updated $relpath"
  else
    echo "  kept    $relpath"
  fi
}

append_snippet() {
  local target_file="$1" marker_begin="$2" marker_end="$3" snippet="$4"
  if grep -q "$marker_begin" "$target_file" 2>/dev/null; then
    awk -v begin="$marker_begin" -v end="$marker_end" -v snip="$snippet" '
      BEGIN { while ((getline line < snip) > 0) replacement = replacement line ORS }
      $0 == begin { print replacement; skip=1; next }
      $0 == end { skip=0; next }
      !skip { print }
    ' "$target_file" > "$target_file.tmp" && mv "$target_file.tmp" "$target_file"
    echo "  updated $marker_begin block in ${target_file#"$TARGET"/}"
  else
    { printf '\n'; cat "$snippet"; printf '\n'; } >> "$target_file"
    echo "  appended ${snippet##*/} to ${target_file#"$TARGET"/}"
  fi
}

echo "Installing feature-dev into $TARGET"
echo

mkdir -p "$TARGET/.cursor/rules" "$TARGET/.cursor/hooks"

copy_file "$SRC_DIR/.cursor/rules/feature-workflow.mdc" \
  "$TARGET/.cursor/rules/feature-workflow.mdc" \
  ".cursor/rules/feature-workflow.mdc"

copy_file "$SRC_DIR/hooks/after-edit-lint.sh" \
  "$TARGET/.cursor/hooks/after-edit-lint.sh" \
  ".cursor/hooks/after-edit-lint.sh"
chmod +x "$TARGET/.cursor/hooks/after-edit-lint.sh"

# Merge hooks.json (project root or .cursor/hooks/hooks.json)
HOOKS_JSON=""
for candidate in "$TARGET/.cursor/hooks.json" "$TARGET/.cursor/hooks/hooks.json"; do
  [[ -f "$candidate" ]] && HOOKS_JSON="$candidate" && break
done
[[ -z "$HOOKS_JSON" ]] && HOOKS_JSON="$TARGET/.cursor/hooks.json"

if [[ ! -f "$HOOKS_JSON" ]]; then
  cat > "$HOOKS_JSON" <<'EOF'
{
  "version": 1,
  "hooks": {}
}
EOF
  echo "  added   ${HOOKS_JSON#"$TARGET"/}"
fi

python3 - <<'PY' "$HOOKS_JSON" "$SRC_DIR/.cursor/hooks/hooks.fragment.json"
import json, sys
hooks_path, frag_path = sys.argv[1], sys.argv[2]
with open(hooks_path) as f:
    data = json.load(f)
if "version" not in data:
    data = {"version": 1, "hooks": data.get("hooks", data)}
hooks = data.setdefault("hooks", {})
with open(frag_path) as f:
    frag = json.load(f)
for key, entries in frag.items():
    existing = hooks.setdefault(key, [])
    cmd = entries[0]["command"] if entries else None
    if cmd and not any(e.get("command") == cmd for e in existing):
        existing.append(entries[0])
with open(hooks_path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
print(f"  merged  afterFileEdit into {hooks_path.split('/')[-2]}/{hooks_path.split('/')[-1]}")
PY

agents_target=""
for candidate in AGENTS.md CLAUDE.md; do
  [[ -f "$TARGET/$candidate" ]] && agents_target="$TARGET/$candidate" && break
done
[[ -z "$agents_target" ]] && agents_target="$TARGET/AGENTS.md" && touch "$agents_target"

claude_target=""
[[ -f "$TARGET/CLAUDE.md" ]] && claude_target="$TARGET/CLAUDE.md"
[[ -z "$claude_target" && -f "$TARGET/AGENTS.md" ]] && claude_target="$TARGET/AGENTS.md"
[[ -z "$claude_target" ]] && claude_target="$TARGET/CLAUDE.md" && touch "$claude_target"

append_snippet "$agents_target" "<!-- feature-dev:begin -->" "<!-- feature-dev:end -->" \
  "$SRC_DIR/AGENTS-snippet.md"
if [[ "$claude_target" != "$agents_target" ]]; then
  append_snippet "$claude_target" "<!-- feature-dev:begin -->" "<!-- feature-dev:end -->" \
    "$SRC_DIR/CLAUDE-snippet.md"
fi

echo
echo "Checking labels..."
cd "$TARGET"
for spec in "human-gate:Hold auto-merge for review:FBCA04"; do
  name="${spec%%:*}"
  rest="${spec#*:}"
  desc="${rest%%:*}"
  color="${rest##*:}"
  if gh label list 2>/dev/null | awk -F'\t' '{print $1}' | grep -qx "$name"; then
    echo "  ok      label $name"
  else
    echo "  todo    gh label create $name --description \"$desc\" --color $color"
  fi
done

REVIEW_INSTALLED=0
[[ -f .github/workflows/claude-loop.yml ]] && REVIEW_INSTALLED=1
if [[ $REVIEW_INSTALLED -eq 0 ]]; then
  echo
  echo "  warn    claude-review-loop not detected — install it for CI automation:"
  echo "          ~/dev/agentic-kit/workflows/claude-review-loop/install.sh $TARGET"
fi

cat <<'EOF'

Done. You can work from Cursor, Claude CLI, or GitHub Issues — see workflows/feature-dev/README.md.

Optional: gh variable set HUMAN_GATE_NOTIFY --body "your-github-username"
EOF
