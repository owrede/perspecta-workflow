import { describe, it, expect } from "vitest";
import { validatePflow } from "../../src/pflow/validate.js";
import { analyzeRegions } from "../../src/pflow/regions.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function withRegion(opts: { joinKind?: "join" | "output"; splitInput?: "array" | "string" }): PflowDocument {
  const splitInput = opts.splitInput ?? "array";
  return {
    pflowFormatVersion: 1,
    workflow: { name: "t", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "items", schema: { type: "array", items: { type: "string" } } }] },
      { id: "sp", kind: "split", label: "sp", inputs: [{ id: "i", name: "items", schema: splitInput === "array" ? { type: "array", items: { type: "string" } } : { type: "string" } }], outputs: [{ id: "item", name: "item", schema: { type: "string" } }] },
      { id: "work", kind: "agent", label: "work", prompt: "p", inputs: [{ id: "i", name: "item", schema: { type: "string" } }], outputs: [{ id: "r", name: "r", schema: { type: "string" } }] },
      { id: "jn", kind: opts.joinKind ?? "join", label: "jn", inputs: [{ id: "i", name: "r", schema: { type: "string" } }], outputs: [{ id: "all", name: "all", schema: { type: "array", items: { type: "string" } } }] },
      { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "all", schema: { type: "array", items: { type: "string" } } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "o" }, to: { nodeId: "sp", portId: "i" } },
      { from: { nodeId: "sp", portId: "item" }, to: { nodeId: "work", portId: "i" } },
      { from: { nodeId: "work", portId: "r" }, to: { nodeId: "jn", portId: "i" } },
      { from: { nodeId: "jn", portId: "all" }, to: { nodeId: "out", portId: "i" } },
    ],
  };
}

describe("split/join regions", () => {
  it("accepts a balanced region", () => {
    expect(validatePflow(withRegion({})).ok).toBe(true);
  });
  it("rejects a split whose input is not an array", () => {
    expect(validatePflow(withRegion({ splitInput: "string" })).errors.some((e) => e.rule === "split-needs-array" && e.nodeId === "sp")).toBe(true);
  });
  it("rejects an unbalanced split with no join", () => {
    expect(validatePflow(withRegion({ joinKind: "output" })).errors.some((e) => e.rule === "split-join-unbalanced")).toBe(true);
  });
});

// ---- analyzeRegions: region detection (consumed by codegen) --------------

// loop: draft -> review(loop), review's refine back-edge -> draft.
const LOOP_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "loopwf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
    { id: "draft", kind: "agent", label: "Draft", prompt: "draft", inputs: [{ id: "i", name: "x", schema: { type: "string" }, required: true }, { id: "r", name: "fix", schema: { type: "string" } }], outputs: [{ id: "o", name: "d", schema: { type: "string" } }] },
    { id: "review", kind: "loop", label: "Review", prompt: "review; emit ALL_OWNED: yes|no", inputs: [{ id: "i", name: "d", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "fix", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "d", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "draft", portId: "i" } },
    { from: { nodeId: "draft", portId: "o" }, to: { nodeId: "review", portId: "i" } },
    { from: { nodeId: "review", portId: "o" }, to: { nodeId: "draft", portId: "r" } }, // back-edge
    { from: { nodeId: "draft", portId: "o" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("analyzeRegions — loop", () => {
  it("detects a loop region spanning back-edge target through the loop node", () => {
    const { regions } = analyzeRegions(LOOP_DOC);
    const loop = regions.find((r) => r.kind === "loop");
    expect(loop).toBeDefined();
    expect(loop!.entryId).toBe("review");
    expect(new Set(loop!.kind === "loop" ? loop!.memberIds : [])).toEqual(new Set(["draft", "review"]));
    if (loop!.kind === "loop") {
      expect(loop!.backEdge).toMatchObject({ from: { nodeId: "review" }, to: { nodeId: "draft" } });
    }
  });
  it("absorbs span members, not upstream/downstream nodes", () => {
    const { absorbed } = analyzeRegions(LOOP_DOC);
    expect(absorbed.has("draft")).toBe(true);
    expect(absorbed.has("review")).toBe(true);
    expect(absorbed.has("in")).toBe(false);
    expect(absorbed.has("out")).toBe(false);
  });
});

// split -> work(agent) -> join.
const SPLITJOIN_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "sj", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "list", schema: { type: "array", items: { type: "string" } } }] },
    { id: "sp", kind: "split", label: "Split", inputs: [{ id: "i", name: "list", schema: { type: "array" }, required: true }], outputs: [{ id: "o", name: "item", schema: { type: "string" } }] },
    { id: "work", kind: "agent", label: "Work", prompt: "process item", inputs: [{ id: "i", name: "item", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "done", schema: { type: "string" } }] },
    { id: "jn", kind: "join", label: "Join", inputs: [{ id: "i", name: "done", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "results", schema: { type: "array" } }] },
    { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "results", schema: { type: "array" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "sp", portId: "i" } },
    { from: { nodeId: "sp", portId: "o" }, to: { nodeId: "work", portId: "i" } },
    { from: { nodeId: "work", portId: "o" }, to: { nodeId: "jn", portId: "i" } },
    { from: { nodeId: "jn", portId: "o" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("analyzeRegions — split/join", () => {
  it("detects a splitjoin region with the work node between split and join", () => {
    const { regions } = analyzeRegions(SPLITJOIN_DOC);
    const sj = regions.find((r) => r.kind === "splitjoin");
    expect(sj).toBeDefined();
    expect(sj!.entryId).toBe("sp");
    if (sj!.kind === "splitjoin") {
      expect(sj!.joinId).toBe("jn");
      expect(sj!.memberIds).toEqual(["work"]);
    }
  });
});

// branch with two labelled output ports (approve/reject).
const BRANCH_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "br", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
    { id: "br", kind: "branch", label: "Branch", prompt: "decide", inputs: [{ id: "i", name: "x", schema: { type: "string" }, required: true }], outputs: [{ id: "approve", name: "approve", schema: { type: "string" } }, { id: "reject", name: "reject", schema: { type: "string" } }] },
    { id: "ap", kind: "agent", label: "Approve", prompt: "handle approve", inputs: [{ id: "i", name: "approve", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "r", schema: { type: "string" } }] },
    { id: "rj", kind: "agent", label: "Reject", prompt: "handle reject", inputs: [{ id: "i", name: "reject", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "r", schema: { type: "string" } }] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "br", portId: "i" } },
    { from: { nodeId: "br", portId: "approve" }, to: { nodeId: "ap", portId: "i" } },
    { from: { nodeId: "br", portId: "reject" }, to: { nodeId: "rj", portId: "i" } },
  ],
};

describe("analyzeRegions — branch", () => {
  it("detects a branch region with one path per labelled output port", () => {
    const { regions } = analyzeRegions(BRANCH_DOC);
    const br = regions.find((r) => r.kind === "branch");
    expect(br).toBeDefined();
    if (br!.kind === "branch") {
      expect(br!.paths.map((p) => p.label).sort()).toEqual(["approve", "reject"]);
      expect(br!.paths.find((p) => p.label === "approve")!.memberIds).toEqual(["ap"]);
      expect(br!.paths.find((p) => p.label === "reject")!.memberIds).toEqual(["rj"]);
    }
  });
});

export { LOOP_DOC, SPLITJOIN_DOC, BRANCH_DOC };


describe("control-flow detection is port-name-agnostic", () => {
  it("detects a loop back-edge regardless of port name", () => {
    // a 2-node loop: body 'work' -> loop 'rev'; rev's output (named 'verdict',
    // NOT 'fix') wires back to work. The cycle, not the name, marks the loop.
    const doc: PflowDocument = {
      pflowFormatVersion: 1,
      workflow: { name: "t", description: "" },
      nodes: [
        { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "seed", schema: { type: "string" } }] },
        { id: "work", kind: "agent", label: "work", prompt: "p", inputs: [{ id: "in:seed", name: "seed", schema: { type: "string" } }, { id: "in:back", name: "back", schema: { type: "string" } }], outputs: [{ id: "out:draft", name: "draft", schema: { type: "string" } }] },
        { id: "rev", kind: "loop", label: "rev", prompt: "Emit {{in:draft}} -> {{out:verdict}}", inputs: [{ id: "in:draft", name: "draft", schema: { type: "string" } }], outputs: [{ id: "out:verdict", name: "verdict", schema: { type: "string" } }] },
        { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "r", schema: { type: "string" } }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "o" }, to: { nodeId: "work", portId: "in:seed" } },
        { from: { nodeId: "work", portId: "out:draft" }, to: { nodeId: "rev", portId: "in:draft" } },
        { from: { nodeId: "rev", portId: "out:verdict" }, to: { nodeId: "work", portId: "in:back" } },
        { from: { nodeId: "rev", portId: "out:verdict" }, to: { nodeId: "out", portId: "i" } },
      ],
      editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
    };
    const { regions } = analyzeRegions(doc);
    expect(regions.filter((r) => r.kind === "loop")).toHaveLength(1);
  });

  it("detects a branch with arbitrary output (path) names", () => {
    const doc: PflowDocument = {
      pflowFormatVersion: 1,
      workflow: { name: "t", description: "" },
      nodes: [
        { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
        { id: "br", kind: "branch", label: "br", prompt: "decide", inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }], outputs: [{ id: "out:pathA", name: "pathA", schema: { type: "string" } }, { id: "out:pathB", name: "pathB", schema: { type: "string" } }] },
        { id: "a", kind: "agent", label: "a", prompt: "A", inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }], outputs: [{ id: "out:r", name: "r", schema: { type: "string" } }] },
        { id: "b", kind: "agent", label: "b", prompt: "B", inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }], outputs: [{ id: "out:r", name: "r", schema: { type: "string" } }] },
        { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "r", schema: { type: "string" } }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "o" }, to: { nodeId: "br", portId: "in:x" } },
        { from: { nodeId: "br", portId: "out:pathA" }, to: { nodeId: "a", portId: "in:x" } },
        { from: { nodeId: "br", portId: "out:pathB" }, to: { nodeId: "b", portId: "in:x" } },
        { from: { nodeId: "a", portId: "out:r" }, to: { nodeId: "out", portId: "i" } },
        { from: { nodeId: "b", portId: "out:r" }, to: { nodeId: "out", portId: "i" } },
      ],
      editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
    };
    const { regions } = analyzeRegions(doc);
    const branch = regions.find((r) => r.kind === "branch");
    expect(branch).toBeTruthy();
    if (branch && branch.kind === "branch") {
      expect(branch.paths.map((p) => p.label).sort()).toEqual(["pathA", "pathB"]);
    }
  });
});
