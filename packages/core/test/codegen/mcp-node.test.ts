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

// Regression test: mcp node downstream of a branch with non-empty arms must use
// the reconvergent result variable (not an arm-local var that only exists in one
// branch arm). Before the fix, `buildAgentCall` was called with `undefined` for
// portOverrides, causing the emitted prompt's inline token to call tokenInputSource
// which resolves to the arm-local var (e.g. `Condense_X`) that is only declared
// inside one if-arm → ReferenceError when the other arm or subsequent code runs.
//
// The doc has two non-empty arms so that `Check_N_result` is assigned to an
// arm-local node's variable inside each arm — and without the fix the mcp node's
// prompt would embed that arm-local var directly, causing a ReferenceError.
const BRANCH_DOC = parsePflow(JSON.stringify({
  pflowFormatVersion: 1,
  workflow: { name: "bwf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "topic", name: "topic", schema: { type: "string" } }] },
    { id: "gen", kind: "agent", label: "Gen", prompt: "Draft from {{in:topic}} as {{out:draft}}.",
      inputs: [{ id: "in:topic", name: "topic", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:draft", name: "draft", schema: { type: "string" } }] },
    { id: "chk", kind: "branch", label: "Check", prompt: "Examine {{in:draft}}; choose {{out:long}} or {{out:ok}}.",
      inputs: [{ id: "in:draft", name: "draft", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:long", name: "long", schema: { type: "string" } }, { id: "out:ok", name: "ok", schema: { type: "string" } }] },
    // arm nodes: one per branch path — their vars are arm-local (declared inside the if-arm)
    { id: "condense", kind: "agent", label: "Condense",
      prompt: "Condense {{in:text}} as {{out:short}}.",
      inputs: [{ id: "in:text", name: "text", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:short", name: "short", schema: { type: "string" } }] },
    { id: "expand", kind: "agent", label: "Expand",
      prompt: "Expand {{in:text}} as {{out:long}}.",
      inputs: [{ id: "in:text", name: "text", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:long", name: "long", schema: { type: "string" } }] },
    // mcp node downstream of the branch — its in:text must use Check_N_result
    { id: "fmt", kind: "mcp", label: "Format", prompt: "Use figma to render {{in:text}} as {{out:done}}.",
      inputs: [{ id: "in:text", name: "text", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:done", name: "done", schema: { type: "string" } }],
      config: { mcpServer: "figma" } },
    { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "done", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "topic" }, to: { nodeId: "gen", portId: "in:topic" } },
    { from: { nodeId: "gen", portId: "out:draft" }, to: { nodeId: "chk", portId: "in:draft" } },
    // long arm: draft → condense → fmt
    { from: { nodeId: "chk", portId: "out:long" }, to: { nodeId: "condense", portId: "in:text" } },
    { from: { nodeId: "condense", portId: "out:short" }, to: { nodeId: "fmt", portId: "in:text" } },
    // ok arm: draft → expand → fmt
    { from: { nodeId: "chk", portId: "out:ok" }, to: { nodeId: "expand", portId: "in:text" } },
    { from: { nodeId: "expand", portId: "out:long" }, to: { nodeId: "fmt", portId: "in:text" } },
    { from: { nodeId: "fmt", portId: "out:done" }, to: { nodeId: "end", portId: "in" } },
  ],
}));

describe("mcp node downstream of branch (reconvergence)", () => {
  it("emitted code references the reconvergent result var, not an arm-local var", () => {
    const code = generateClaudeCodeWorkflow(BRANCH_DOC);
    // The mcp node's prompt must interpolate Check_N_result (the hoisted branch
    // result var), NOT an arm-local var like Condense_X or Expand_X.
    // With the bug: the prompt embeds `${Condense_3}` or `${Expand_4}` (arm-local).
    // With the fix: the prompt embeds `${Check_2_result}` (hoisted, always defined).
    expect(code).toMatch(/Check_\d+_result/); // result var exists
    // The fmt agent call must NOT reference arm-local vars directly in the prompt
    const fmtLine = code.split("\n").find((l) => l.includes("bwf-fmt"));
    expect(fmtLine).toBeDefined();
    expect(fmtLine).toMatch(/Check_\d+_result/);
    expect(fmtLine).not.toMatch(/Condense_\d+/);
    expect(fmtLine).not.toMatch(/Expand_\d+/);
  });

  it("an mcp node downstream of a branch references the reconvergent var (no ReferenceError)", async () => {
    const code = generateClaudeCodeWorkflow(BRANCH_DOC);
    const body = code.slice(code.indexOf("  const "));
    // eslint-disable-next-line no-new-func
    const runEmitted = new Function("agent", "args", `return (async () => { ${body} })();`);
    // stub: branch returns a path marker; agent/mcp return a value. Should not throw.
    await expect(runEmitted(async () => "RESULT", { topic: "t" })).resolves.toBeDefined();
  });
});
