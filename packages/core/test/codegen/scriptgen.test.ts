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
    // template literal that weaves the SPECIFIC arg `${args.topic}` (not the
    // whole `args` object) in as labelled context (C1).
    expect(code).toContain("Research the topic thoroughly.");
    expect(code).toContain('<context name="topic">');
    expect(code).toContain("${args.topic}");
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

// ---- new node kinds ------------------------------------------------------

import { LOOP_DOC, SPLITJOIN_DOC, BRANCH_DOC } from "../pflow/regions.test.js";

// verify: input -> verify -> output.
const VERIFY_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "verifywf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
    { id: "v", kind: "verify", label: "Check", prompt: "Check the claim is supported.", inputs: [{ id: "i", name: "x", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "x", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "v", portId: "i" } },
    { from: { nodeId: "v", portId: "o" }, to: { nodeId: "out", portId: "i" } },
  ],
};

// synthesize: two inputs -> synthesize -> output.
const SYNTH_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "synthwf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "a1", kind: "agent", label: "A1", prompt: "one", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "a", schema: { type: "string" } }] },
    { id: "a2", kind: "agent", label: "A2", prompt: "two", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "b", schema: { type: "string" } }] },
    { id: "syn", kind: "synthesize", label: "Merge", prompt: "Merge a and b.", inputs: [{ id: "ia", name: "a", schema: { type: "string" }, required: true }, { id: "ib", name: "b", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "merged", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "merged", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "a1", portId: "i" } },
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "a2", portId: "i" } },
    { from: { nodeId: "a1", portId: "o" }, to: { nodeId: "syn", portId: "ia" } },
    { from: { nodeId: "a2", portId: "o" }, to: { nodeId: "syn", portId: "ib" } },
    { from: { nodeId: "syn", portId: "o" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("verify + synthesize", () => {
  it("verify emits a VERIFY sentinel instruction and logs the verdict", () => {
    const code = generateClaudeCodeWorkflow(VERIFY_DOC);
    expect(code).toContain("VERIFY: pass");
    expect(code).toMatch(/log\(\w+\)/);
  });
  it("synthesize weaves multiple inputs as labelled context blocks", () => {
    const code = generateClaudeCodeWorkflow(SYNTH_DOC);
    expect(code).toContain('<context name="a">');
    expect(code).toContain('<context name="b">');
  });
});

describe("loop region", () => {
  it("emits a bounded for-loop with a sentinel break", () => {
    const code = generateClaudeCodeWorkflow(LOOP_DOC);
    expect(code).toMatch(/for \(let pass = 0; pass < 3; pass\+\+\)/);
    expect(code).toContain("break;");
    expect(code).toMatch(/ALL_OWNED/);
  });
});

describe("split/join region", () => {
  it("emits a pipeline over the split array", () => {
    const code = generateClaudeCodeWorkflow(SPLITJOIN_DOC);
    expect(code).toContain("await pipeline(");
  });
  it("fans out over the SPECIFIC array arg, not the whole args object", () => {
    // SPLITJOIN_DOC's split is fed by the input node's `list` output port, so
    // the pipeline must iterate args.list — not bare args (the args object).
    const code = generateClaudeCodeWorkflow(SPLITJOIN_DOC);
    expect(code).toMatch(/pipeline\(\s*args\.list,/);
    expect(code).not.toMatch(/pipeline\(\s*args,/);
  });
});

describe("branch region", () => {
  it("emits BRANCH sentinel dispatch with an if / else-if chain", () => {
    const code = generateClaudeCodeWorkflow(BRANCH_DOC);
    expect(code).toContain("BRANCH:");
    expect(code).toContain("} else if (");
  });
});

describe("new-kind determinism", () => {
  it("region + verify/synthesize docs are byte-identical across emissions", () => {
    for (const d of [VERIFY_DOC, SYNTH_DOC, LOOP_DOC, SPLITJOIN_DOC, BRANCH_DOC]) {
      expect(generateClaudeCodeWorkflow(d)).toBe(generateClaudeCodeWorkflow(d));
    }
  });
});

// The loop body re-runs nodes; a variable produced inside the loop but read
// earlier in the same iteration (the refine back-edge) must be hoisted to a
// `let` before the loop, else the first read throws a temporal-dead-zone
// ReferenceError. Shape assertions miss this — so EXECUTE the emitted body with
// stubbed primitives and assert it runs. (Controlled test-only evaluation of
// our own deterministic codegen output; no external input.)
describe("loop body executes without a temporal-dead-zone error", () => {
  it("hoists loop-carried vars so the back-edge reference is safe", async () => {
    const code = generateClaudeCodeWorkflow(LOOP_DOC);
    const body = code.slice(code.indexOf("  let "));
    const agent = async () => "ALL_OWNED: yes";
    const log = () => {};
    const args = "topic";
    const runEmitted = new Function("agent", "log", "args", `return (async () => { ${body} })();`);
    await expect(runEmitted(agent, log, args)).resolves.toBeDefined();
  });
});
