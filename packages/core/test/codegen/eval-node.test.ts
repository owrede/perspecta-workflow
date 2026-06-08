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
    // Extract the eval node's OWN agent call (label "Compare") and assert BOTH
    // upstream result vars are interpolated INSIDE it — a dropped input would
    // remove one of these from the call body, failing the test. (Asserting on
    // the whole `code` is vacuous: the upstream agents declare cand/ref vars
    // regardless of whether the eval weaves them.)
    //
    // The match MUST anchor at the Compare declaration (`const Compare_N = await
    // agent(`), not the first `await agent(` in the file. A non-anchored capture
    // would swallow the upstream `const Ref_N = await agent(...)` declaration
    // line, so `Ref_\d` would match even if the eval prompt dropped reference —
    // re-introducing the very vacuousness this test exists to kill.
    const m = code.match(/const Compare_\d+ = await agent\(([\s\S]*?)\{ label: "Compare"[^)]*\)/);
    expect(m, "could not locate the Compare eval agent call in generated code").not.toBeNull();
    const evalCall = m![1];
    expect(evalCall).toMatch(/Cand_\d/);
    expect(evalCall).toMatch(/Ref_\d/);
  });

  it("executes end-to-end with stub helpers (no dangling arm-local var)", async () => {
    const code = generateClaudeCodeWorkflow(doc);
    // Strip the ES-module preamble (header comment + `export const meta = {...}`)
    // so the remaining body is a legal async-function body. The meta object ends
    // with the first `\n}\n` after `export const meta`. NOTE: this assumes meta is
    // a FLAT object (no nested `}` on its own line) — true today because `phases`
    // emits empty. If meta ever nests an object, anchor the strip more defensively.
    const metaStart = code.indexOf("export const meta");
    const metaEnd = code.indexOf("\n}\n", metaStart);
    expect(metaEnd).toBeGreaterThan(metaStart);
    const body = code.slice(metaEnd + 3); // skip past "\n}\n"
    // Build an async function FROM the body and EXECUTE it with stub helpers.
    // The AsyncFunction constructor wraps `body` in an async function, so we pass
    // the workflow statements (incl. the final `return`) directly. agent() always
    // returns a passing verdict so the `pass` arm and its reconvergent consumer
    // ("Use"/"Polish") actually run — a dangling arm-local var would throw a
    // ReferenceError here, which parse-only checking (Function(...) without
    // calling) cannot surface.
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      ...args: string[]
    ) => (...a: unknown[]) => Promise<unknown>;
    const run = new AsyncFunction("agent", "log", "parallel", "pipeline", "args", body);
    const agent = async () => "EVAL: pass";
    const log = () => {};
    const parallel = async (thunks: Array<() => Promise<unknown>>) =>
      Promise.all(thunks.map((t) => t()));
    const pipeline = async (
      items: unknown[],
      ...stages: Array<(x: unknown) => Promise<unknown>>
    ) => {
      const out: unknown[] = [];
      for (const it of items) {
        let v: unknown = it;
        for (const s of stages) v = await s(v);
        out.push(v);
      }
      return out;
    };
    // Should run to completion without a ReferenceError. We only care that
    // execution does not throw; the resolved value is the workflow output.
    await expect(run(agent, log, parallel, pipeline, { x: "topic" })).resolves.toBeDefined();
  });
});

describe("codegen — eval verdict as a loop sentinel (Karpathy)", () => {
  it("a loop node configured with an EVAL sentinel emits a matching break", () => {
    const doc: PflowDocument = {
      pflowFormatVersion: 1,
      workflow: { name: "karpathy_wf", description: "" },
      // A valid loop region needs a refine back-edge: the loop node's output
      // must feed an upstream member that then forward-reaches the loop again
      // (see regions.ts findLoopRegions). So we add a "draft" refine agent that
      // the loop's output cycles back into. The EVAL sentinel config stays on
      // the loop node — that is what this smoke test guards.
      nodes: [
        { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "out:x", name: "x", schema: { type: "string" } }] },
        { id: "draft", kind: "agent", label: "Draft", prompt: "Draft {{in:x}}, applying {{in:fix}}.",
          inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }, { id: "in:fix", name: "fix", schema: { type: "string" } }],
          outputs: [{ id: "out:d", name: "d", schema: { type: "string" } }] },
        { id: "loop", kind: "loop", label: "Refine", prompt: "Refine {{in:d}} until good. End with EVAL: pass when done.",
          inputs: [{ id: "in:d", name: "d", schema: { type: "string" } }],
          outputs: [{ id: "out:r", name: "r", schema: { type: "string" } }],
          config: { maxPasses: 3, sentinel: "EVAL:\\s*pass" } },
        { id: "out", kind: "output", label: "out", inputs: [{ id: "in:o", name: "o", schema: { type: "string" } }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "draft", portId: "in:x" } },
        { from: { nodeId: "draft", portId: "out:d" }, to: { nodeId: "loop", portId: "in:d" } },
        { from: { nodeId: "loop", portId: "out:r" }, to: { nodeId: "draft", portId: "in:fix" } }, // back-edge
        { from: { nodeId: "draft", portId: "out:d" }, to: { nodeId: "out", portId: "in:o" } },
      ],
    };
    const code = generateClaudeCodeWorkflow(doc);
    // The loop's break condition uses the EVAL sentinel.
    expect(code).toContain("EVAL:");
    expect(code).toContain("for (let pass");
    expect(code).toContain("break");
  });
});
