#!/usr/bin/env bash
set -euo pipefail

if [[ "${1:-}" == "--version" ]]; then
  node -e 'console.log(require("./package.json").version)'
  exit 0
fi

if [[ $# -ne 1 ]]; then
  echo "Usage: scripts/install-skills.sh /absolute/path/to/vault" >&2
  exit 2
fi

VAULT="$1"
if [[ ! -d "$VAULT" ]]; then
  echo "Vault does not exist: $VAULT" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/skills"
DEST="$VAULT/.claude/skills"

mkdir -p "$DEST"

count=0
for skill_dir in "$SRC"/*; do
  [[ -d "$skill_dir" ]] || continue
  name="$(basename "$skill_dir")"
  mkdir -p "$DEST/$name"
  cp -R "$skill_dir"/. "$DEST/$name"/
  count=$((count + 1))
done

echo "Installed $count Perspecta Workflow skill(s) into $DEST"
