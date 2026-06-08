import { describe, it, expect } from "vitest";
import { mcpSubagentMarkdown } from "../../src/codegen/scriptgen.js";
import type { McpRegistryServer } from "../../src/pflow/mcp-registry.js";

const figma: McpRegistryServer = {
  whitelisted: true, probe: { status: "hot" }, tools: {
    get_design:  { group: "read",  groupSource: "heuristic", permission: "allow" },
    get_view:    { group: "read",  groupSource: "heuristic", permission: "ask" },
    create_file: { group: "write", groupSource: "heuristic", permission: "blocked" },
  },
};

describe("mcpSubagentMarkdown", () => {
  it("emits frontmatter granting the server with allow/disallow tool sets", () => {
    const md = mcpSubagentMarkdown("natebjones-delta-fig", "figma", figma, "Fetch a Figma design");
    expect(md).toContain("name: natebjones-delta-fig");
    expect(md).toContain("mcpServers:");
    expect(md).toContain('- "figma"');
    expect(md).toContain("mcp__figma__get_design");       // allow → allowedTools
    expect(md).toContain("disallowedTools:");
    expect(md).toContain("mcp__figma__create_file");      // blocked → disallowedTools
    // ask tool (get_view) is NEITHER allowed nor disallowed (prompts at runtime)
    expect(md).not.toContain("mcp__figma__get_view");
  });
  it("is deterministic", () => {
    expect(mcpSubagentMarkdown("a", "figma", figma, "x")).toBe(mcpSubagentMarkdown("a", "figma", figma, "x"));
  });
  it("includes the JSON-quoted description in the frontmatter", () => {
    const md = mcpSubagentMarkdown("a", "figma", figma, "Fetch a Figma design");
    expect(md).toContain('description: "Fetch a Figma design"');
  });
  it("omits both tool sections when every tool is ask", () => {
    const allAsk: McpRegistryServer = {
      whitelisted: true, probe: { status: "hot" }, tools: {
        get_a: { group: "read", groupSource: "heuristic", permission: "ask" },
        get_b: { group: "read", groupSource: "heuristic", permission: "ask" },
      },
    };
    const md = mcpSubagentMarkdown("a", "figma", allAsk, "x");
    expect(md).not.toContain("allowedTools:");
    expect(md).not.toContain("disallowedTools:");
    expect(md).toContain("mcpServers:"); // server still granted
  });
});
