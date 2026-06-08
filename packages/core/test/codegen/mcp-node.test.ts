import { describe, it, expect } from "vitest";
import { mcpSubagentMarkdown, generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import type { McpRegistryServer } from "../../src/pflow/mcp-registry.js";
import { parsePflow } from "../../src/pflow/schema.js";

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

const DOC = parsePflow(JSON.stringify({
  pflowFormatVersion: 1,
  workflow: { name: "wf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "url", name: "url", schema: { type: "string" } }] },
    { id: "fig", kind: "mcp", label: "Fetch design",
      prompt: "Use figma to fetch {{in:url}}; return {{out:design}}.",
      inputs: [{ id: "in:url", name: "url", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:design", name: "design", schema: { type: "string" } }],
      config: { mcpServer: "figma" } },
    { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "design", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "url" }, to: { nodeId: "fig", portId: "in:url" } },
    { from: { nodeId: "fig", portId: "out:design" }, to: { nodeId: "end", portId: "in" } },
  ],
}));

describe("mcp node codegen", () => {
  it("emits an agent call carrying agentType for the node", () => {
    const code = generateClaudeCodeWorkflow(DOC);
    expect(code).toMatch(/agentType: "wf-fig"/);
    expect(code).toContain("await agent(");
  });
  it("runs without a ReferenceError using a stub agent (same harness as person-brief-migration.test.ts)", async () => {
    // Use the SAME emitted-code execution harness used in
    // packages/core/test/codegen/person-brief-migration.test.ts — open that file,
    // copy how it compiles the workflow body and invokes it with a stub `agent`,
    // and apply it here. The stub agent returns "DESIGN"; assert the workflow
    // resolves to "DESIGN" (the output node returns the design value).
    // (person-brief-migration shows the exact slice/Function pattern to reuse.)
    const code = generateClaudeCodeWorkflow(DOC);
    const body = code.slice(code.indexOf("  const "));
    // NOTE: new Function is the established harness pattern in this test suite
    // (see person-brief-migration.test.ts) for executing generated workflow code
    // with a stub agent — intentional and approved for this test suite.
    // eslint-disable-next-line no-new-func
    const runEmitted = new Function("agent", "args", `return (async () => { ${body} })();`);
    await expect(runEmitted(async () => "DESIGN", { url: "u" })).resolves.toBe("DESIGN");
  });
});
