/** Filename of the bundled MCP server artifact shipped inside the plugin folder.
 *  Emitted as ESM (.mjs): the server entry uses top-level await + import.meta.url,
 *  which CJS cannot host. Node runs a .mjs file as ESM regardless of package type. */
export const MCP_SERVER_ARTIFACT = "mcp-server.mjs";

/** Name the perspecta-workflow server is registered under in the agent's .mcp.json. */
export const MCP_SERVER_NAME = "perspecta-workflow";

/**
 * Natural-language prompt the user pastes into a coding agent running in the
 * vault. The agent edits .mcp.json itself — we state intent and the exact
 * command/path, and let the agent own the file format and merge.
 *
 * @param serverAbsPath absolute disk path to the bundled mcp-server.mjs
 */
export function buildMcpSetupPrompt(serverAbsPath: string): string {
  return [
    `Add an MCP server to this project so the agent can run Perspecta workflows.`,
    `Edit (or create) \`.mcp.json\` at the vault root and add a server entry named`,
    `\`${MCP_SERVER_NAME}\` that runs the command \`node\` with the single argument`,
    `\`${serverAbsPath}\`. Preserve any existing servers already declared in the`,
    `file. After editing, confirm the \`${MCP_SERVER_NAME}\` server is registered.`,
  ].join(" ");
}
