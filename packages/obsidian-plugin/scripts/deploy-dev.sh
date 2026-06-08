#!/usr/bin/env bash
# Copy this plugin's built release artifacts into the Perspecta-Dev vault so a
# reload picks up the fresh build. Assumes the plugin is already built (run via
# the `deploy` npm script, which builds first).
#
# Vault location is overridable:
#   PERSPECTA_VAULT_ROOT       — vault root (default: Perspecta-Dev below)
#   PERSPECTA_VAULT_PLUGIN_DIR — exact plugin dir (overrides the computed path)
#
# If the vault root does not exist (CI, another machine), the copy is skipped
# and the script still exits 0 so builds/pipelines never fail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

VAULT_ROOT="${PERSPECTA_VAULT_ROOT:-/Users/wrede/Documents/Obsidian Vaults/Perspecta-Dev}"
PLUGIN_ID="$(node -e "console.log(require('$ROOT/manifest.json').id)")"
DEST="${PERSPECTA_VAULT_PLUGIN_DIR:-$VAULT_ROOT/.obsidian/plugins/$PLUGIN_ID}"

# Skip gracefully when the vault isn't present on this machine.
if [[ ! -d "$VAULT_ROOT/.obsidian" ]]; then
  echo "deploy-dev: vault not found at '$VAULT_ROOT' — skipping."
  exit 0
fi

mkdir -p "$DEST"

count=0
for f in main.js manifest.json styles.css versions.json preload.js mcp-server.mjs; do
  if [[ -f "$ROOT/$f" ]]; then
    # Remove the destination first so we replace any stale entry — including a
    # dangling symlink left by an older dev setup (cp would follow it and fail).
    rm -f "$DEST/$f"
    cp "$ROOT/$f" "$DEST/$f"
    count=$((count + 1))
  fi
done

echo "deploy-dev: copied $count artifact(s) for '$PLUGIN_ID' → $DEST"
