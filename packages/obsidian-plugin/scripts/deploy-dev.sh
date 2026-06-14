#!/usr/bin/env bash
# Copy this plugin's built release artifacts into the local test vault(s) so a
# reload picks up the fresh build. Assumes the plugin is already built (run via
# the `deploy` npm script, which builds first).
#
# By default it deploys to BOTH vaults the developer uses, so neither is ever
# left on a stale build:
#   - INIM-VM-TEST          (holds the real vault-memory contracts for smoke tests)
#   - Intelligence Impact   (the vault the plugin is actually exercised in)
#
# Overrides:
#   PERSPECTA_VAULT_ROOTS      — ':'-separated list of vault roots (replaces the
#                                default list). e.g. "/a/Vault1:/b/Vault2"
#   PERSPECTA_VAULT_ROOT       — a SINGLE vault root; when set it wins and only
#                                that vault is targeted (back-compat / one-off).
#   PERSPECTA_VAULT_PLUGIN_DIR — exact plugin dir; only honored together with the
#                                single-vault PERSPECTA_VAULT_ROOT override.
#
# A vault root that does not exist on this machine (CI, another dev) is skipped
# and the script still exits 0 so builds/pipelines never fail.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_ID="$(node -e "console.log(require('$ROOT/manifest.json').id)")"

# Default fleet of vaults to keep in sync. Add new vaults here.
DEFAULT_VAULT_ROOTS=(
  "/Users/wrede/Documents/Obsidian Vaults/INIM-VM-TEST"
  "/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact"
)

# Resolve which vaults to target (precedence: single override > list override > default).
EXPLICIT_PLUGIN_DIR=""
if [[ -n "${PERSPECTA_VAULT_ROOT:-}" ]]; then
  VAULT_ROOTS=("$PERSPECTA_VAULT_ROOT")
  EXPLICIT_PLUGIN_DIR="${PERSPECTA_VAULT_PLUGIN_DIR:-}" # only meaningful for a single vault
elif [[ -n "${PERSPECTA_VAULT_ROOTS:-}" ]]; then
  IFS=':' read -r -a VAULT_ROOTS <<< "$PERSPECTA_VAULT_ROOTS"
else
  VAULT_ROOTS=("${DEFAULT_VAULT_ROOTS[@]}")
fi

# Copy the built artifacts into one vault's plugin dir. Skips a missing vault.
deploy_to_vault() {
  local vault_root="$1"
  local dest="${EXPLICIT_PLUGIN_DIR:-$vault_root/.obsidian/plugins/$PLUGIN_ID}"

  if [[ ! -d "$vault_root/.obsidian" ]]; then
    echo "deploy-dev: vault not found at '$vault_root' — skipping."
    return 0
  fi

  mkdir -p "$dest"
  local count=0
  for f in main.js manifest.json styles.css versions.json preload.js mcp-server.mjs mcp-probe.mjs; do
    if [[ -f "$ROOT/$f" ]]; then
      # Remove the destination first so we replace any stale entry — including a
      # dangling symlink left by an older dev setup (cp would follow it and fail).
      rm -f "$dest/$f"
      cp "$ROOT/$f" "$dest/$f"
      count=$((count + 1))
    fi
  done
  echo "deploy-dev: copied $count artifact(s) for '$PLUGIN_ID' → $dest"
}

for vault in "${VAULT_ROOTS[@]}"; do
  deploy_to_vault "$vault"
done
