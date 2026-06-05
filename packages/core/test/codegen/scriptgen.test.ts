import { describe, it, expect } from "vitest";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

const LINEAR: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "summarize", description: "Summarize a topic" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "research", kind: "agent", label: "Research", phase: "Research", prompt: "Research the topic thoroughly.", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "notes", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Output", inputs: [{ id: "i", name: "notes", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "research", portId: "i" } },
    { from: { nodeId: "research", portId: "r" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("generateClaudeCodeWorkflow", () => {
  it("emits a runnable linear workflow", () => {
    const code = generateClaudeCodeWorkflow(LINEAR);
    expect(code).toContain("export const meta = {");
    expect(code).toContain("await agent(");
    expect(code).toContain('"Research the topic thoroughly."');
    expect(code).toContain("return");
  });
  it("is deterministic — identical output across two emissions", () => {
    expect(generateClaudeCodeWorkflow(LINEAR)).toBe(generateClaudeCodeWorkflow(LINEAR));
  });
  it("passes its own emit-lint (does not throw)", () => {
    expect(() => generateClaudeCodeWorkflow(LINEAR)).not.toThrow();
  });
  it("throws a clear error when a required input is unwired", () => {
    const bad = structuredClone(LINEAR);
    bad.wires = bad.wires.filter((w) => w.to.nodeId !== "research");
    expect(() => generateClaudeCodeWorkflow(bad)).toThrow(/validation/i);
  });
});
