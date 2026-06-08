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
 * running in the vault. It instructs the agent to import EVERY MCP server it has
 * configured — across all its config scopes — into the vault's `.mcp.json`, and
 * to ensure the bundled perspecta-workflow server is among them. The plugin's MCP
 * tab reads `.mcp.json`, so after the agent runs this the tab can see and manage
 * all of the agent's servers, not just perspecta-workflow.
 *
 * The agent owns the file edit; we state intent, the merge policy, the secret
 * policy, the node/PATH caveat for the one server the plugin spawns itself, and
 * a final validation step.
 *
 * @param serverAbsPath absolute disk path to the bundled mcp-server.mjs
 */
export function buildMcpSetupPrompt(serverAbsPath: string): string {
  return [
    `Goal: register every MCP server you (this coding agent) have configured into this Obsidian vault's \`.mcp.json\`, so the Perspecta Workflow plugin can see and manage them — including the bundled Perspecta Workflow server itself.`,
    ``,
    `Work carefully and idempotently. Do exactly this:`,
    ``,
    `1. Enumerate your MCP servers. List every MCP server configured for you across ALL scopes — user/global, this project, and any managed/enterprise config. Prefer a CLI if you have one (Claude Code: run \`claude mcp list\`, and \`claude mcp get <name>\` for details); otherwise read your own MCP config files. For each server capture: its name, transport (stdio vs http/sse), and launch details — \`command\` + \`args\` for stdio, or \`url\` for http/sse.`,
    ``,
    `2. Ensure the Perspecta Workflow server is included. It must be a stdio server named exactly \`${MCP_SERVER_NAME}\`. Because the Obsidian plugin launches this one itself (outside a shell, where \`node\` may not be on PATH), use an ABSOLUTE path to the node binary as its \`command\`: run \`which node\` (or \`command -v node\`) and use that full path; set \`args\` to the single element \`${serverAbsPath}\`. If a \`${MCP_SERVER_NAME}\` entry already exists, update its \`command\`/\`args\` to match. Example shape:`,
    `   "${MCP_SERVER_NAME}": { "command": "/absolute/path/to/node", "args": ["${serverAbsPath}"] }`,
    ``,
    `3. Write \`.mcp.json\` at the vault root (create it if absent) under the \`mcpServers\` key. MERGE — do not replace the file: add servers that are missing, update entries whose config differs, and DO NOT delete or modify any existing entry you do not recognize. Other servers keep their commands as-is (bare commands like \`npx\`/\`uvx\` are fine; only \`${MCP_SERVER_NAME}\` needs the absolute node path).`,
    ``,
    `4. Never write secrets in cleartext. A secret is any API key, token, password, or credential — commonly in a server's \`env\` (e.g. values for keys named like \`*_API_KEY\`, \`*_TOKEN\`, \`*_SECRET\`, \`AUTH*\`). Replace each secret VALUE with an environment-variable reference of the form \`\${VAR_NAME}\` (keep the key; reference the value), so the file is safe to commit/sync. Leave non-secret env values (paths, flags, IDs) as they are. If you are unsure whether a value is secret, treat it as secret.`,
    ``,
    `5. Validate and report. Re-read \`.mcp.json\`, confirm it is valid JSON and that \`${MCP_SERVER_NAME}\` is present with an absolute node command. Report: which servers you added, which you updated, which you left untouched, and any env values you converted to \`\${...}\` references.`,
  ].join("\n");
}
