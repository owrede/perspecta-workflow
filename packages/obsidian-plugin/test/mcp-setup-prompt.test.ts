import { describe, it, expect } from "vitest";
import { buildMcpSetupPrompt, MCP_SERVER_ARTIFACT } from "../src/mcp/setupPrompt.js";

describe("buildMcpSetupPrompt", () => {
  it("embeds the absolute server path and the server name", () => {
    const prompt = buildMcpSetupPrompt("/Users/me/Vault/.obsidian/plugins/perspecta-workflow/mcp-server.mjs");
    expect(prompt).toContain("/Users/me/Vault/.obsidian/plugins/perspecta-workflow/mcp-server.mjs");
    expect(prompt).toContain("perspecta-workflow");
    expect(prompt).toContain(".mcp.json");
  });

  it("instructs node as the command", () => {
    const prompt = buildMcpSetupPrompt("/abs/mcp-server.mjs");
    expect(prompt).toContain("node");
  });

  it("instructs preserving existing servers", () => {
    const prompt = buildMcpSetupPrompt("/abs/mcp-server.mjs");
    expect(prompt.toLowerCase()).toContain("preserve");
  });

  it("exposes the artifact filename constant", () => {
    expect(MCP_SERVER_ARTIFACT).toBe("mcp-server.mjs");
  });
});
