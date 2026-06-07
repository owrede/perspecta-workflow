import { describe, it, expect } from "vitest";
import { exportClaudeCodeWorkflowFile, type WorkflowWriteAdapter } from "../src/commands/exportWorkflow.js";
import type { PflowDocument } from "@perspecta/core";

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
    const path = await exportClaudeCodeWorkflowFile(adapter, DOC);
    expect(path).toBe(".claude/workflows/my-flow.js");
    expect(files.has(path)).toBe(true);
    expect(dirs.has(".claude")).toBe(true);
    expect(dirs.has(".claude/workflows")).toBe(true);
    // The written content is the generated workflow.
    expect(files.get(path)).toContain("export const meta");
    expect(files.get(path)).toContain('name: "my-flow"');
  });

  it("does not re-mkdir existing directories", async () => {
    const { adapter } = fakeAdapter();
    // pre-create dirs
    await adapter.mkdir(".claude");
    await adapter.mkdir(".claude/workflows");
    let mkdirCalls = 0;
    const counting: WorkflowWriteAdapter = { ...adapter, mkdir: (p) => { mkdirCalls++; return adapter.mkdir(p); } };
    await exportClaudeCodeWorkflowFile(counting, DOC);
    expect(mkdirCalls).toBe(0);
  });

  it("throws (without writing) when the document does not compile", async () => {
    const { adapter, files } = fakeAdapter();
    const broken = { ...DOC, nodes: [] } as unknown as PflowDocument;
    await expect(exportClaudeCodeWorkflowFile(adapter, broken)).rejects.toThrow();
    expect(files.size).toBe(0); // nothing written on failure
  });
});
