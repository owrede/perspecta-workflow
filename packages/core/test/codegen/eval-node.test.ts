import { describe, it, expect } from "vitest";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function evalDoc(blockOnFail: boolean): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "gate_wf", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "out:x", name: "x", schema: { type: "string" } }] },
      { id: "gen", kind: "agent", label: "Gen", prompt: "Write a draft of {{in:x}}.",
        inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }],
        outputs: [{ id: "out:draft", name: "draft", schema: { type: "string" } }] },
      { id: "ev", kind: "eval", label: "Gate",
        prompt: "Evaluate {{in:candidate}} against the rubric. Route {{out:pass}} or {{out:fail}}.",
        inputs: [{ id: "in:candidate", name: "candidate", schema: { type: "string" } }],
        outputs: [{ id: "out:pass", name: "pass", schema: { type: "string" } }, { id: "out:fail", name: "fail", schema: { type: "string" } }],
        config: { mode: "criteria", blockOnFail } },
      { id: "okOut", kind: "output", label: "ok", inputs: [{ id: "in:y", name: "y", schema: { type: "string" } }], outputs: [] },
      { id: "badOut", kind: "output", label: "bad", inputs: [{ id: "in:z", name: "z", schema: { type: "string" } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "gen", portId: "in:x" } },
      { from: { nodeId: "gen", portId: "out:draft" }, to: { nodeId: "ev", portId: "in:candidate" } },
      { from: { nodeId: "ev", portId: "out:pass" }, to: { nodeId: "okOut", portId: "in:y" } },
      { from: { nodeId: "ev", portId: "out:fail" }, to: { nodeId: "badOut", portId: "in:z" } },
    ],
  };
}

describe("codegen — eval node", () => {
  it("emits an EVAL verdict instruction and a pass/fail dispatch", () => {
    const code = generateClaudeCodeWorkflow(evalDoc(false));
    expect(code).toContain("EVAL: pass");
    expect(code).toContain("EVAL: fail");
    expect(code).toContain("EVAL:");
    expect(code).not.toContain("BRANCH:");
  });

  it("omits a block-on-fail throw when blockOnFail is false", () => {
    const code = generateClaudeCodeWorkflow(evalDoc(false));
    expect(code).not.toContain("Quality gate failed");
  });

  it("emits a throw when blockOnFail is true", () => {
    const code = generateClaudeCodeWorkflow(evalDoc(true));
    expect(code).toContain("Quality gate failed");
    expect(code).toContain("throw new Error");
  });

  it("treats a missing blockOnFail flag as no gate", () => {
    const doc = evalDoc(false);
    // strip the blockOnFail key entirely from the eval node's config
    const ev = doc.nodes.find((n) => n.id === "ev")!;
    ev.config = { mode: "criteria" };
    const code = generateClaudeCodeWorkflow(doc);
    expect(code).not.toContain("Quality gate failed");
  });
});
