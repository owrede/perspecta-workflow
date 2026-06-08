/** Filename of the bundled MCP server artifact shipped inside the plugin folder.
 *  Emitted as ESM (.mjs): the server entry uses top-level await + import.meta.url,
 *  which CJS cannot host. Node runs a .mjs file as ESM regardless of package type. */
export const MCP_SERVER_ARTIFACT = "mcp-server.mjs";

/** Filename of the bundled MCP probe helper shipped inside the plugin folder.
 *  Spawned as a Node child process to list another server's tools, so the
 *  renderer never imports the MCP SDK directly. Same ESM rationale as above. */
export const MCP_PROBE_ARTIFACT = "mcp-probe.mjs";

/** Name the perspecta-workflow server is registered under in the agent's .mcp.json. */
export const MCP_SERVER_NAME = "perspecta-workflow";

/**
 * Natural-language prompt the user pastes into a coding agent (e.g. Claude Code)
 * running in the vault. It instructs the agent to mirror EVERY MCP server it has
 * configured — across all its scopes — into the vault's `.mcp.json`, ensuring the
 * bundled perspecta-workflow server is among them, so the plugin's MCP tab can
 * see and manage them.
 *
 * Hardened version (see docs/specs/2026-06-08-mcp-mirror-all-servers-setup-prompt.md):
 * the agent must CLASSIFY servers before writing, because "every configured
 * server" mixes three incompatible kinds:
 *   - local-reproducible (stdio command+args, or plain http/sse) → writable
 *   - cloud-OAuth (claude.ai connectors) and plugin/dynamic → NOT launchable
 *     from a plain .mcp.json (URLs hidden, need interactive auth)
 * A naive "write them all" prompt makes the agent stall or emit dead entries.
 * Secrets hide not only in `env` but in url query strings, args, and headers.
 *
 * CAPTURE_CLOUD is true here: cloud/plugin connectors are recorded best-effort
 * (secrets masked, marked auth-required) so .mcp.json is a full inventory — the
 * agent is already authenticated to them in its own environment. Such entries are
 * reference/inventory and may not probe in the plugin without that client's auth.
 *
 * We additionally direct an ABSOLUTE node path for perspecta-workflow, since the
 * plugin spawns that one itself outside a shell (no PATH), and pass the resolved
 * absolute .mjs path rather than asking the agent to derive it.
 *
 * @param serverAbsPath absolute disk path to the bundled mcp-server.mjs
 */
export function buildMcpSetupPrompt(serverAbsPath: string): string {
  return [
    `Goal: Record the MCP servers I (this coding agent) have configured into this vault's \`.mcp.json\`, so the Perspecta Workflow Obsidian plugin can see and launch them. Be idempotent — running this twice produces the same file.`,
    ``,
    `## 1. Enumerate`,
    `List every MCP server configured for me across ALL scopes: user/global, project, dynamic/command-line, plugin, managed/enterprise, and cloud (claude.ai) connectors. Use \`claude mcp list\` plus \`claude mcp get <name>\` for detail; fall back to reading the config files directly (~/.claude.json, managed config paths) for full transport, command, args, url, env, and headers. Note each server's SCOPE and KIND.`,
    ``,
    `## 2. Classify each server into one of three kinds`,
    `- LOCAL-REPRODUCIBLE: has a concrete launch spec (stdio command+args, or a plain http/sse url with no auth handshake). → WRITE these.`,
    `- CLOUD-OAUTH (claude.ai scope) or PLUGIN/DYNAMIC: launch details are managed/hidden or require interactive auth. → CAPTURE_CLOUD = true, so record a best-effort entry for these too (an http url if you can recover one from the CLI output, otherwise note what's known), and MARK each as "auth-required (reference only)". They will not launch in the plugin without that client's OAuth.`,
    ``,
    `## 3. Ensure perspecta-workflow is present`,
    `It must be a stdio server named exactly \`${MCP_SERVER_NAME}\`. Because the Obsidian plugin launches this one itself (outside a shell, where \`node\` may not be on PATH), use an ABSOLUTE path to the node binary as its \`command\`: run \`which node\` (or \`command -v node\`) and use that full path. Set \`args\` to the single element "${serverAbsPath}". If a \`${MCP_SERVER_NAME}\` entry already exists, update its \`command\`/\`args\` to match. Example shape:`,
    `   "${MCP_SERVER_NAME}": { "command": "/absolute/path/to/node", "args": ["${serverAbsPath}"] }`,
    ``,
    `## 4. Merge into <vault root>/.mcp.json (create if missing), under "mcpServers"`,
    `- ADD servers that are missing.`,
    `- For servers I own/recognize whose live config differs: UPDATE to match live config.`,
    `- For entries I do NOT recognize, or that look manually edited: LEAVE UNTOUCHED (do not reorder, reformat, or drop).`,
    `- Normalize every written entry to: {type, command, args, env} for stdio, or {type, url, headers?} for http/sse. Preserve existing key order for untouched entries.`,
    ``,
    `## 5. Never write secrets in cleartext — anywhere`,
    `Scan env values, url query strings, args, and headers. If a value looks like an API key, token, password, or secret, replace it with an env-var reference like \`\${SERVER_NAME_API_KEY}\` and note the original lives outside the file. Keep non-secret values (paths, namespaces, ids, flags) as-is. If unsure, treat it as secret.`,
    ``,
    `## 6. Validate and report`,
    `- Confirm the file is valid JSON and contains no plaintext secret patterns.`,
    `- Report a table: ADDED / UPDATED / LEFT-UNTOUCHED / CAPTURED-AS-REFERENCE (cloud/plugin, auth-required), with a reason per entry.`,
    `- Confirm \`${MCP_SERVER_NAME}\` is present with an absolute node command.`,
    `- Note that the Perspecta Workflow plugin must be reloaded to pick up the changes.`,
  ].join("\n");
}
