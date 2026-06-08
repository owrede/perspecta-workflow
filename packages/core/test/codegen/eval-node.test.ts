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
    // The hard gate must precede the dispatch arms (else it would be dead code).
    const throwIdx = code.indexOf("Quality gate failed");
    const dispatchIdx = code.indexOf("EVAL:\\s*pass");
    expect(throwIdx).toBeGreaterThanOrEqual(0);
    expect(dispatchIdx).toBeGreaterThanOrEqual(0);
    expect(throwIdx).toBeLessThan(dispatchIdx);
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

describe("codegen — eval comparison mode + reconvergence", () => {
  const doc: PflowDocument = {
    pflowFormatVersion: 1,
    workflow: { name: "cmp_wf", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "out:x", name: "x", schema: { type: "string" } }] },
      { id: "cand", kind: "agent", label: "Cand", prompt: "Draft {{in:x}}.",
        inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }],
        outputs: [{ id: "out:c", name: "c", schema: { type: "string" } }] },
      { id: "ref", kind: "agent", label: "Ref", prompt: "Gold answer for {{in:x}}.",
        inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }],
        outputs: [{ id: "out:r", name: "r", schema: { type: "string" } }] },
      { id: "ev", kind: "eval", label: "Compare",
        prompt: "Compare {{in:candidate}} against {{in:reference}}. Route {{out:pass}} or {{out:fail}}.",
        inputs: [{ id: "in:candidate", name: "candidate", schema: { type: "string" } }, { id: "in:reference", name: "reference", schema: { type: "string" } }],
        outputs: [{ id: "out:pass", name: "pass", schema: { type: "string" } }, { id: "out:fail", name: "fail", schema: { type: "string" } }],
        config: { mode: "comparison", blockOnFail: false } },
      { id: "use", kind: "agent", label: "Use", prompt: "Polish {{in:winner}}.",
        inputs: [{ id: "in:winner", name: "winner", schema: { type: "string" } }],
        outputs: [{ id: "out:w", name: "w", schema: { type: "string" } }] },
      { id: "out", kind: "output", label: "out", inputs: [{ id: "in:o", name: "o", schema: { type: "string" } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "cand", portId: "in:x" } },
      { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "ref", portId: "in:x" } },
      { from: { nodeId: "cand", portId: "out:c" }, to: { nodeId: "ev", portId: "in:candidate" } },
      { from: { nodeId: "ref", portId: "out:r" }, to: { nodeId: "ev", portId: "in:reference" } },
      { from: { nodeId: "ev", portId: "out:pass" }, to: { nodeId: "use", portId: "in:winner" } },
      { from: { nodeId: "use", portId: "out:w" }, to: { nodeId: "out", portId: "in:o" } },
    ],
  };

  it("weaves both candidate and reference inputs into the eval call", () => {
    const code = generateClaudeCodeWorkflow(doc);
    expect(code).toContain("EVAL: pass");
    // both upstream agents' result vars must appear in the emitted code (no dropped input)
    expect(code).toMatch(/cand/i);
    expect(code).toMatch(/ref/i);
  });

  it("a consumer downstream of the pass arm references defined variables only", () => {
    const code = generateClaudeCodeWorkflow(doc);
    expect(code).toContain("Polish");
    // The emitted artifact is an ES module: a `// Generated...` header, an
    // `export const meta = {...}` block, then the executable workflow body
    // (await agent(...) calls + the pass/fail dispatch). Only the body is a
    // legal function body, so strip the module preamble up to and including
    // the meta export's closing brace, then compile-check the body in strict
    // mode WITHOUT executing it. A dangling arm-local var (ReferenceError-
    // shaped bug) is a scope/syntax error that strict parsing surfaces; the
    // runtime helper names are provided as params so they are defined.
    const metaEnd = code.indexOf("\n}\n", code.indexOf("export const meta"));
    expect(metaEnd).toBeGreaterThanOrEqual(0);
    const body = code.slice(metaEnd + 3);
    const wrap = `"use strict"; return (async (agent, log, parallel, pipeline, args) => {\n${body}\n});`;
    expect(() => Function(wrap)).not.toThrow();
  });
});
