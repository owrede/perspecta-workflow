import { describe, it, expect } from "vitest";
import { exportClaudeCodeWorkflowFile, type WorkflowWriteAdapter } from "../src/commands/exportWorkflow.js";
import type { PflowDocument } from "@perspecta/core";
import type { McpRegistry } from "@perspecta/core";

// Minimal valid workflow: input → agent(save via write_note) → output.
const DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "my-flow", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "topic", name: "topic", schema: { type: "string" } }] },
    { id: "ag", kind: "agent", label: "Do", prompt: "Use {{in:topic}} and return the {{out:result}}.",
      inputs: [{ id: "in:topic", name: "topic", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:result", name: "result", schema: { type: "string" } }] },
    { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "result", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "topic" }, to: { nodeId: "ag", portId: "in:topic" } },
    { from: { nodeId: "ag", portId: "out:result" }, to: { nodeId: "end", portId: "in" } },
  ],
  editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
};

const MCP_DOC = {
  pflowFormatVersion: 1, workflow: { name: "wf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "url", name: "url", schema: { type: "string" } }] },
    { id: "fig", kind: "mcp", label: "Fetch", prompt: "Use figma {{in:url}} {{out:design}}",
      inputs: [{ id: "in:url", name: "url", schema: { type: "string" }, required: true }],
      outputs: [{ id: "out:design", name: "design", schema: { type: "string" } }],
      config: { mcpServer: "figma" } },
    { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "design", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "url" }, to: { nodeId: "fig", portId: "in:url" } },
    { from: { nodeId: "fig", portId: "out:design" }, to: { nodeId: "end", portId: "in" } },
  ],
} as unknown as PflowDocument;

const REG: McpRegistry = { figma: { whitelisted: true, probe: { status: "hot" }, tools: {
  get_design: { group: "read", groupSource: "heuristic", permission: "allow" },
} } };

function fakeAdapter() {
  const dirs = new Set<string>();
  const files = new Map<string, string>();
  const adapter: WorkflowWriteAdapter = {
    exists: (p) => Promise.resolve(dirs.has(p) || files.has(p)),
    mkdir: (p) => { dirs.add(p); return Promise.resolve(); },
    write: (p, d) => { files.set(p, d); return Promise.resolve(); },
  };
  return { adapter, dirs, files };
}

describe("exportClaudeCodeWorkflowFile", () => {
  it("writes .claude/workflows/<name>.js and returns the path", async () => {
    const { adapter, files, dirs } = fakeAdapter();
    const { workflowPath } = await exportClaudeCodeWorkflowFile(adapter, DOC, {});
    expect(workflowPath).toBe(".claude/workflows/my-flow.js");
    expect(files.has(workflowPath)).toBe(true);
    expect(dirs.has(".claude")).toBe(true);
    expect(dirs.has(".claude/workflows")).toBe(true);
    // The written content is the generated workflow.
    expect(files.get(workflowPath)).toContain("export const meta");
    expect(files.get(workflowPath)).toContain('name: "my-flow"');
  });

  it("does not re-mkdir existing directories", async () => {
    const { adapter } = fakeAdapter();
    // pre-create dirs
    await adapter.mkdir(".claude");
    await adapter.mkdir(".claude/workflows");
    let mkdirCalls = 0;
    const counting: WorkflowWriteAdapter = { ...adapter, mkdir: (p) => { mkdirCalls++; return adapter.mkdir(p); } };
    await exportClaudeCodeWorkflowFile(counting, DOC, {});
    expect(mkdirCalls).toBe(0);
  });

  it("throws (without writing) when the document does not compile", async () => {
    const { adapter, files } = fakeAdapter();
    const broken = { ...DOC, nodes: [] } as unknown as PflowDocument;
    await expect(exportClaudeCodeWorkflowFile(adapter, broken, {})).rejects.toThrow();
    expect(files.size).toBe(0); // nothing written on failure
  });

  it("writes the workflow js AND a subagent .md for each mcp node", async () => {
    const { adapter, files } = fakeAdapter();
    const res = await exportClaudeCodeWorkflowFile(adapter, MCP_DOC, REG);
    expect(files.has(".claude/workflows/wf.js")).toBe(true);
    expect(files.has(".claude/agents/wf-fig.md")).toBe(true);
    expect(files.get(".claude/agents/wf-fig.md")).toContain("mcp__figma__get_design");
    expect(res.subagentPaths).toContain(".claude/agents/wf-fig.md");
    expect(res.workflowPath).toBe(".claude/workflows/wf.js");
  });
});
