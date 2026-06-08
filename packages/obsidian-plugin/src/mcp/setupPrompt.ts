/** Filename of the bundled MCP server artifact shipped inside the plugin folder.
 *  Emitted as ESM (.mjs): the server entry uses top-level await + import.meta.url,
 *  which CJS cannot host. Node runs a .mjs file as ESM regardless of package type. */
export const MCP_SERVER_ARTIFACT = "mcp-server.mjs";

/** Name the perspecta-workflow server is registered under in the agent's .mcp.json. */
export const MCP_SERVER_NAME = "perspecta-workflow";

/**
 * Natural-language prompt the user pastes into a coding agent (e.g. Claude Code)
 * running in the vault. It instructs the agent to import EVERY MCP server it has
 * configured — across all its config scopes — into the vault's `.mcp.json`, and
 * to make sure the bundled perspecta-workflow server is among them. The plugin's
 * MCP tab reads `.mcp.json`, so after the agent runs this the tab can see and
 * manage all of the agent's servers, not just perspecta-workflow.
 *
 * The agent owns the file edit; we state intent, the merge policy, the secret
 * policy, and the one concrete path (perspecta-workflow's bundled server).
 *
 * @param serverAbsPath absolute disk path to the bundled mcp-server.mjs
 */
export function buildMcpSetupPrompt(serverAbsPath: string): string {
  return [
    `Goal: make every MCP server you (this coding agent) have configured visible to the Perspecta Workflow Obsidian plugin by recording them in this vault's \`.mcp.json\`.`,
    ``,
    `Do the following:`,
    ``,
    `1. List every MCP server currently configured for you, across ALL of your configuration scopes (e.g. user/global config, this project's config, and any managed/enterprise config). If you have a CLI for this (for Claude Code: \`claude mcp list\`), use it; otherwise read your own MCP configuration files. Include each server's transport and launch details (command + args, or url).`,
    ``,
    `2. Make sure the Perspecta Workflow server itself is in that set. If it is not already present, add a stdio server named \`${MCP_SERVER_NAME}\` that runs the command \`node\` with the single argument \`${serverAbsPath}\`.`,
    ``,
    `3. Write all of these servers into \`.mcp.json\` at the root of this vault (create the file if it does not exist) under the \`mcpServers\` key. MERGE, do not replace: add servers that are missing and update ones whose config differs, but DO NOT delete or alter any pre-existing entry that you do not recognize.`,
    ``,
    `4. Do not write secrets in cleartext. For any server whose \`env\` contains an API key, token, or other secret, write the value as an environment-variable reference like \`\${MY_API_KEY}\` rather than the literal secret, so this file is safe to sync. Keep non-secret env values as-is.`,
    ``,
    `5. When done, report which servers you added, which you updated, and which you left untouched, and confirm \`${MCP_SERVER_NAME}\` is present.`,
  ].join("\n");
}
