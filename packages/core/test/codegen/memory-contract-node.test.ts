import { describe, it, expect } from "vitest";
import { generateClaudeCodeWorkflow, buildWorkflowArtifacts } from "../../src/codegen/scriptgen.js";
import { parsePflow } from "../../src/pflow/schema.js";
import type { McpRegistry } from "../../src/pflow/mcp-registry.js";

/** A meeting-prep-flow with one Memory (vault-memory contract) node:
 *  - `vault` pinned to "inim" (config.contractInputs), port required:false;
 *  - `meeting_path` + `context_doc_ids` wired from the input node;
 *  - output ports from a code-review-brief-shaped snapshot, incl. the
 *    `doc_id` projection port (write_back.doc_id). */
const DOC = parsePflow(JSON.stringify({
  pflowFormatVersion: 1,
  workflow: { name: "wf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [
      { id: "meeting_path", name: "meeting_path", schema: { type: "string" } },
      { id: "ids", name: "context_doc_ids", schema: { type: "array", items: { type: "string" } } },
    ] },
    { id: "mem", kind: "mcp", label: "Memory",
      inputs: [
        { id: "in:vault", name: "vault", schema: { type: "string" }, required: false },
        { id: "in:meeting_path", name: "meeting_path", schema: { type: "string" }, required: true },
        { id: "in:context_doc_ids", name: "context_doc_ids", schema: { type: "array", items: { type: "string" } }, required: true },
      ],
      outputs: [
        { id: "out:steps", name: "steps", schema: { type: "object" }, projection: "steps" },
        { id: "out:write_back", name: "write_back", schema: { type: "object" }, projection: "write_back" },
        { id: "out:doc_id", name: "doc_id", schema: { type: "string" }, projection: "write_back.doc_id" },
      ],
      config: {
        mcpServer: "vault-memory",
        contract: "meeting-prep",
        contractInputs: { vault: "inim" },
      } },
    { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "doc_id", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "meeting_path" }, to: { nodeId: "mem", portId: "in:meeting_path" } },
    { from: { nodeId: "in", portId: "ids" }, to: { nodeId: "mem", portId: "in:context_doc_ids" } },
    { from: { nodeId: "mem", portId: "out:doc_id" }, to: { nodeId: "end", portId: "in" } },
  ],
}));

describe("memory contract node codegen", () => {
  it("emits the deterministic vm_<contract> call with sorted-key JSON args", () => {
    const code = generateClaudeCodeWorkflow(DOC);
    expect(code).toContain("vm_meeting_prep"); // slugified tool name
    expect(code).toMatch(/agentType: "wf-mem"/);
    // sorted keys: context_doc_ids < meeting_path < vault
    const ctx = code.indexOf('"context_doc_ids"');
    const mp = code.indexOf('"meeting_path"');
    const va = code.indexOf('"vault"');
    expect(ctx).toBeGreaterThan(-1);
    expect(mp).toBeGreaterThan(ctx);
    expect(va).toBeGreaterThan(mp);
    // pinned literal lands as a JSON literal; wired inputs as runtime JSON
    expect(code).toContain('"vault": "inim"');
    expect(code).toContain("${JSON.stringify(args.meeting_path)}");
    expect(code).toContain("${JSON.stringify(args.context_doc_ids)}");
    // the node's free-text prompt path is NOT used
    expect(code).toContain("EXACTLY these arguments");
  });

  it("is byte-identical across two emissions", () => {
    expect(generateClaudeCodeWorkflow(DOC)).toBe(generateClaudeCodeWorkflow(DOC));
  });

  it("compiles a downstream read of the doc_id projection port to an optional-chained access", () => {
    const code = generateClaudeCodeWorkflow(DOC);
    expect(code).toContain("Memory_1?.write_back?.doc_id");
  });

  it("parses the connector agent's JSON (with or without code fences) and projects from it", async () => {
    const code = generateClaudeCodeWorkflow(DOC);
    const body = code.slice(code.indexOf("  const "));
    // Established emitted-code harness (see person-brief-migration.test.ts /
    // mcp-node.test.ts): run the generated body with a stub agent. new Function
    // is intentional and approved for this test suite — it executes only the
    // deterministic code this test itself just generated.
    // eslint-disable-next-line no-new-func
    const runEmitted = new Function("agent", "args", `return (async () => { ${body} })();`);
    const bundle = '{"steps":{"compiled":{"ok":true,"doc_id":"D1"}},"write_back":{"doc_id":"D1"}}';
    await expect(runEmitted(async () => bundle, { meeting_path: "m.md", context_doc_ids: ["a"] })).resolves.toBe("D1");
    await expect(runEmitted(async () => "```json\n" + bundle + "\n```", { meeting_path: "m.md", context_doc_ids: ["a"] })).resolves.toBe("D1");
  });

  it("the stub agent receives the pre-bound args JSON with runtime values woven in", async () => {
    const code = generateClaudeCodeWorkflow(DOC);
    const body = code.slice(code.indexOf("  const "));
    let prompt = "";
    // Same approved harness pattern as above.
    // eslint-disable-next-line no-new-func
    const runEmitted = new Function("agent", "args", `return (async () => { ${body} })();`);
    await runEmitted(async (p: string) => { prompt = p; return "{}"; }, { meeting_path: "m.md", context_doc_ids: ["a", "b"] });
    expect(prompt).toContain("vm_meeting_prep");
    expect(prompt).toContain('"meeting_path": "m.md"');
    expect(prompt).toContain('"context_doc_ids": ["a","b"]');
    expect(prompt).toContain('"vault": "inim"');
  });

  it("emits one companion subagent .md granting vault-memory", () => {
    const registry: McpRegistry = {
      "vault-memory": {
        whitelisted: true, probe: { status: "hot" },
        tools: { vm_meeting_prep: { group: "interactive", groupSource: "heuristic", permission: "allow" } },
      },
    };
    const artifacts = buildWorkflowArtifacts(DOC, registry);
    expect(artifacts.subagents).toHaveLength(1);
    expect(artifacts.subagents[0].path).toBe(".claude/agents/wf-mem.md");
    expect(artifacts.subagents[0].content).toContain('- "vault-memory"');
    expect(artifacts.subagents[0].content).toContain("mcp__vault-memory__vm_meeting_prep");
  });

  it("leaves a non-vault-memory mcp node on the prompt-driven path (regression guard)", () => {
    const generic = parsePflow(JSON.stringify({
      pflowFormatVersion: 1,
      workflow: { name: "wf2", description: "d" },
      nodes: [
        { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "url", name: "url", schema: { type: "string" } }] },
        { id: "fig", kind: "mcp", label: "Fetch",
          prompt: "Use figma to fetch {{in:url}}; return {{out:design}}.",
          inputs: [{ id: "in:url", name: "url", schema: { type: "string" }, required: true }],
          outputs: [{ id: "out:design", name: "design", schema: { type: "string" } }],
          // a "contract" on a non-vault-memory server is ignored
          config: { mcpServer: "figma", contract: "meeting-prep" } },
        { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "design", schema: { type: "string" }, required: true }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "url" }, to: { nodeId: "fig", portId: "in:url" } },
        { from: { nodeId: "fig", portId: "out:design" }, to: { nodeId: "end", portId: "in" } },
      ],
    }));
    const code = generateClaudeCodeWorkflow(generic);
    expect(code).not.toContain("vm_");
    expect(code).not.toContain("EXACTLY these arguments");
    expect(code).toContain("Use figma to fetch");
  });

  it("a vault-memory mcp node WITHOUT a contract stays prompt-driven", () => {
    const noContract = parsePflow(JSON.stringify({
      pflowFormatVersion: 1,
      workflow: { name: "wf3", description: "d" },
      nodes: [
        { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "q", name: "q", schema: { type: "string" } }] },
        { id: "mem", kind: "mcp", label: "Recall",
          prompt: "Search vault memory for {{in:q}}; return {{out:hits}}.",
          inputs: [{ id: "in:q", name: "q", schema: { type: "string" }, required: true }],
          outputs: [{ id: "out:hits", name: "hits", schema: { type: "string" } }],
          config: { mcpServer: "vault-memory" } },
        { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "hits", schema: { type: "string" }, required: true }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "q" }, to: { nodeId: "mem", portId: "in:q" } },
        { from: { nodeId: "mem", portId: "out:hits" }, to: { nodeId: "end", portId: "in" } },
      ],
    }));
    const code = generateClaudeCodeWorkflow(noContract);
    expect(code).not.toContain("EXACTLY these arguments");
    expect(code).toContain("Search vault memory for");
  });

  it("a contract output port without a projection falls back to the whole bundle var", () => {
    const handAuthored = parsePflow(JSON.stringify({
      pflowFormatVersion: 1,
      workflow: { name: "wf4", description: "d" },
      nodes: [
        { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "p", name: "p", schema: { type: "string" } }] },
        { id: "mem", kind: "mcp", label: "Memory",
          inputs: [{ id: "in:p", name: "p", schema: { type: "string" }, required: true }],
          outputs: [{ id: "out:bundle", name: "bundle", schema: { type: "any" } }], // no projection field
          config: { mcpServer: "vault-memory", contract: "smoketest-trivial" } },
        { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "bundle", schema: { type: "any" }, required: true }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "p" }, to: { nodeId: "mem", portId: "in:p" } },
        { from: { nodeId: "mem", portId: "out:bundle" }, to: { nodeId: "end", portId: "in" } },
      ],
    }));
    const code = generateClaudeCodeWorkflow(handAuthored);
    expect(code).toContain("vm_smoketest_trivial");
    expect(code).toMatch(/return Memory_1;/);
  });
});
