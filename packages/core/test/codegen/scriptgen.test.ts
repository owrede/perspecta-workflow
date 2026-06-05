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
    // research's input is sourced from the input node, so its prompt is a
    // template literal that weaves `${args}` in as labelled context (C1).
    expect(code).toContain("Research the topic thoroughly.");
    expect(code).toContain('<context name="topic">');
    expect(code).toContain("${args}");
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

// C1: multi-agent chains must thread upstream dataflow into the downstream prompt.
const CHAIN: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "chain", description: "Two-agent chain" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "a1", kind: "agent", label: "A1", prompt: "Do step one.", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "draft", schema: { type: "string" } }] },
    { id: "a2", kind: "agent", label: "A2", prompt: "Do step two.", inputs: [{ id: "i", name: "draft", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "final", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Output", inputs: [{ id: "i", name: "final", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "a1", portId: "i" } },
    { from: { nodeId: "a1", portId: "r" }, to: { nodeId: "a2", portId: "i" } },
    { from: { nodeId: "a2", portId: "r" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("C1: agent dataflow threading", () => {
  it("weaves a1's result variable into a2's agent call", () => {
    const code = generateClaudeCodeWorkflow(CHAIN);
    // Isolate a2's agent call block (the agent call is a multiline template literal).
    const a2Block = code.slice(code.indexOf("const A2_"), code.indexOf('label: "A2"'));
    // a1's varName is A1_<index>; assert a2's agent call interpolates it.
    expect(a2Block).toMatch(/\$\{A1_\d+\}/);
    // labelled with the input port name "draft"
    expect(a2Block).toContain('<context name="draft">');
  });
  it("is byte-identical across two emissions", () => {
    expect(generateClaudeCodeWorkflow(CHAIN)).toBe(generateClaudeCodeWorkflow(CHAIN));
  });
});

// I1: nodes whose sanitized ids would collapse to the same identifier must
// still emit distinct const declarations.
const COLLISION: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "collide", description: "varName collision" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "n_1", kind: "agent", label: "X", prompt: "first", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "a", schema: { type: "string" } }] },
    { id: "n-1", kind: "agent", label: "X", prompt: "second", inputs: [{ id: "i", name: "a", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "b", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Output", inputs: [{ id: "i", name: "b", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "n_1", portId: "i" } },
    { from: { nodeId: "n_1", portId: "r" }, to: { nodeId: "n-1", portId: "i" } },
    { from: { nodeId: "n-1", portId: "r" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("I1: varName collisions", () => {
  it("emits distinct identifiers for nodes whose ids sanitize alike", () => {
    const code = generateClaudeCodeWorkflow(COLLISION);
    const constLines = code.split("\n").filter((l) => /^\s*const /.test(l));
    const names = constLines.map((l) => l.match(/const (\w+) =/)![1]);
    expect(new Set(names).size).toBe(names.length);
  });
});
