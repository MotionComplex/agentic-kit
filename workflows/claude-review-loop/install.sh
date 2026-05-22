#!/usr/bin/env bash
# Install the claude-review-loop workflow into a target git repo.
# Idempotent: identical files are skipped, modified files show a diff and prompt.
#
# Usage:
#   install.sh <target-repo-path> [--yes]
#
#   --yes   Overwrite modified files without prompting (use for scripted updates).
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

if [[ -z "$TARGET" ]]; then
  echo "usage: install.sh <target-repo-path> [--yes]" >&2; exit 2
fi
if [[ ! -d "$TARGET/.git" ]]; then
  echo "error: $TARGET is not a git repository" >&2; exit 1
fi

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
  diff -u "$dest" "$src" | sed 's/^/    /' || true
  if prompt_overwrite "$relpath"; then
    cp "$src" "$dest"
    echo "  updated $relpath"
  else
    echo "  kept    $relpath (existing version retained)"
  fi
}

echo "Installing claude-review-loop into $TARGET"
echo

echo "Workflow files:"
while IFS= read -r -d '' src; do
  rel="${src#"$SRC_DIR"/}"
  [[ "$rel" == "AGENTS-snippet.md" ]] && continue
  copy_file "$src" "$TARGET/$rel" "$rel"
done < <(find "$SRC_DIR" -type f -print0)
echo

agents_target=""
for candidate in AGENTS.md CLAUDE.md; do
  if [[ -f "$TARGET/$candidate" ]]; then
    agents_target="$TARGET/$candidate"
    break
  fi
done
if [[ -z "$agents_target" ]]; then
  agents_target="$TARGET/AGENTS.md"
  touch "$agents_target"
  echo "AGENTS.md not found — created empty $agents_target"
fi

snippet="$SRC_DIR/AGENTS-snippet.md"
echo "Documentation snippet → ${agents_target#"$TARGET"/}:"
if grep -q '<!-- claude-review-loop:begin -->' "$agents_target"; then
  awk -v snip="$snippet" '
    BEGIN { while ((getline line < snip) > 0) replacement = replacement line ORS }
    /<!-- claude-review-loop:begin -->/ { print replacement; skip=1; next }
    /<!-- claude-review-loop:end -->/   { skip=0; next }
    !skip { print }
  ' "$agents_target" > "$agents_target.tmp" && mv "$agents_target.tmp" "$agents_target"
  echo "  updated existing claude-review-loop block"
else
  { printf '\n'; cat "$snippet"; printf '\n'; } >> "$agents_target"
  echo "  appended claude-review-loop block"
fi
echo

cat <<'EOF'
Done. Post-install checklist:

  1. Set repo secret `CLAUDE_CODE_OAUTH_TOKEN`
       Generate with:   claude setup-token
       Add under:       Settings -> Secrets and variables -> Actions

  2. Create the opt-out label `no-claude-loop`
       gh label create no-claude-loop \
         --description "Skip the automated Claude review loop on this PR" \
         --color cccccc

  3. Commit and push the new files
       git add .github/ AGENTS.md
       git commit -m "ci: install claude review loop"
       git push

  4. Open a test PR and watch the Actions tab.

To uninstall: delete `.github/workflows/claude-code-review.yml`,
`.github/workflows/claude-loop.yml`, `.github/PR-REVIEW-RUBRIC.md`, and remove the
`<!-- claude-review-loop:begin/end -->` block from your AGENTS.md / CLAUDE.md.
EOF
