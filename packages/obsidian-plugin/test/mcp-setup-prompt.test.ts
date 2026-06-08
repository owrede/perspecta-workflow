import { describe, it, expect } from "vitest";
import { buildMcpSetupPrompt, MCP_SERVER_ARTIFACT, MCP_SERVER_NAME } from "../src/mcp/setupPrompt.js";

describe("buildMcpSetupPrompt", () => {
  const ABS = "/Users/me/Vault/.obsidian/plugins/perspecta-workflow/mcp-server.mjs";

  it("targets the vault's .mcp.json", () => {
    expect(buildMcpSetupPrompt(ABS)).toContain(".mcp.json");
  });

  it("instructs importing ALL the agent's servers across every config scope", () => {
    const prompt = buildMcpSetupPrompt(ABS).toLowerCase();
    // The whole point: every server the agent has, not just one.
    expect(prompt).toContain("every mcp server");
    expect(prompt).toContain("scope"); // user/project/managed scopes
  });

  it("ensures the perspecta-workflow server is included, with its node path", () => {
    const prompt = buildMcpSetupPrompt(ABS);
    expect(prompt).toContain(MCP_SERVER_NAME); // "perspecta-workflow"
    expect(prompt).toContain("node");
    expect(prompt).toContain(ABS); // the exact bundled-server path
  });

  it("instructs a merge that never deletes unknown entries", () => {
    const prompt = buildMcpSetupPrompt(ABS);
    expect(prompt.toLowerCase()).toContain("merge");
    expect(prompt.toLowerCase()).toContain("do not delete");
  });

  it("instructs keeping secrets as env-var references, not cleartext", () => {
    const prompt = buildMcpSetupPrompt(ABS);
    expect(prompt.toLowerCase()).toContain("secret");
    expect(prompt).toContain("${"); // an ${ENV_VAR}-style placeholder example
  });

  it("directs an ABSOLUTE node path for perspecta-workflow (plugin spawns it, no PATH)", () => {
    const prompt = buildMcpSetupPrompt(ABS);
    expect(prompt.toLowerCase()).toContain("absolute");
    expect(prompt).toContain("which node"); // how the agent resolves it
  });

  it("tells the agent to enumerate via the Claude Code CLI", () => {
    expect(buildMcpSetupPrompt(ABS)).toContain("claude mcp list");
  });

  it("includes a final validate-and-report step", () => {
    const prompt = buildMcpSetupPrompt(ABS).toLowerCase();
    expect(prompt).toContain("valid json");
    expect(prompt).toContain("report");
  });

  it("exposes the artifact filename constant", () => {
    expect(MCP_SERVER_ARTIFACT).toBe("mcp-server.mjs");
  });
});
