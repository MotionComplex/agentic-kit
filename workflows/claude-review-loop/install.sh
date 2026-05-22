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

echo "Checking prerequisites in $TARGET..."
echo

cd "$TARGET"

GH_OK=0; SECRET_OK=0; CLAUDE_YML_OK=0; LABEL_OK=0

gh auth status >/dev/null 2>&1 && GH_OK=1
[[ -f ".github/workflows/claude.yml" ]] && CLAUDE_YML_OK=1
if [[ $GH_OK -eq 1 ]]; then
  gh secret list 2>/dev/null | awk -F'\t' '{print $1}' \
    | grep -qx CLAUDE_CODE_OAUTH_TOKEN && SECRET_OK=1
  gh label list 2>/dev/null | awk -F'\t' '{print $1}' \
    | grep -qx no-claude-loop && LABEL_OK=1
fi

mark() { [[ $1 -eq 1 ]] && echo "ok  " || echo "todo"; }

cat <<EOF
  [$(mark $GH_OK)] gh CLI authenticated
  [$(mark $CLAUDE_YML_OK)] .github/workflows/claude.yml present
  [$(mark $SECRET_OK)] CLAUDE_CODE_OAUTH_TOKEN secret set
  [$(mark $LABEL_OK)] no-claude-loop label exists

EOF

GATE_OK=0
if [[ $GH_OK -eq 1 ]]; then
  gh label list 2>/dev/null | awk -F'\t' '{print $1}' | grep -qx human-gate && GATE_OK=1
fi
echo "  [$( [[ $GATE_OK -eq 1 ]] && echo ok || echo todo )] human-gate label (optional merge hold)"
echo

NEED_ACTION=0

if [[ $GH_OK -eq 0 ]]; then
  cat <<'EOF'
Next: authenticate the gh CLI
  gh auth login

EOF
  NEED_ACTION=1
fi

if [[ $CLAUDE_YML_OK -eq 0 || $SECRET_OK -eq 0 ]]; then
  cat <<'EOF'
Next: install the Claude GitHub App + OAuth secret (interactive)
  claude          # then inside claude run: /install-github-app

  This adds .github/workflows/claude.yml and sets the
  CLAUDE_CODE_OAUTH_TOKEN repo secret. Required for the loop to run.

EOF
  NEED_ACTION=1
fi

if [[ $GH_OK -eq 1 ]]; then
  if [[ $LABEL_OK -eq 0 ]]; then
    cat <<'EOF'
Next: create labels
  gh label create no-claude-loop \
    --description "Skip the automated Claude review loop on this PR" \
    --color cccccc

EOF
    NEED_ACTION=1
  fi
  if [[ $GATE_OK -eq 0 ]]; then
    cat <<'EOF'
Next: create human gate label (optional but recommended)
  gh label create human-gate \
    --description "Hold auto-merge; human reviews before merge" \
    --color FBCA04

  Optional: gh variable set HUMAN_GATE_NOTIFY --body "your-github-username"

EOF
    NEED_ACTION=1
  fi
fi

cat <<'EOF'
Next: commit and push
  git add .github/ AGENTS.md
  git commit -m "ci: install claude review loop"
  git push

Then open a test PR and watch the Actions tab.

To uninstall: delete .github/workflows/claude-code-review.yml,
.github/workflows/claude-loop.yml, .github/PR-REVIEW-RUBRIC.md, and remove the
<!-- claude-review-loop:begin/end --> block from AGENTS.md / CLAUDE.md.
EOF

if [[ $NEED_ACTION -eq 1 ]]; then
  echo
  echo "(Some prerequisites are missing — see TODOs above before opening a PR.)"
fi
