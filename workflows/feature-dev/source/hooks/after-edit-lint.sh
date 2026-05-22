#!/usr/bin/env bash
# Post-edit lint (portable). Cursor afterFileEdit passes JSON on stdin.
# CLI users: ./hooks/after-edit-lint.sh path/to/file.ts
set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" ]] && [[ ! -t 0 ]]; then
  INPUT=$(cat)
  FILE=$(echo "$INPUT" | jq -r '.file_path // .path // .file // empty' 2>/dev/null || true)
fi

[[ -z "$FILE" || ! -f "$FILE" ]] && exit 0

case "$FILE" in
  *.ts|*.tsx|*.js|*.jsx)
    if [[ -f package.json ]]; then
      npx eslint --fix "$FILE" 2>/dev/null || npx eslint "$FILE" 2>/dev/null || true
    fi
    ;;
esac
