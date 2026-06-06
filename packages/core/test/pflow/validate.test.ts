import { describe, it, expect } from "vitest";
import { validatePflow } from "../../src/pflow/validate.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function base(): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "t", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
      { id: "ag", kind: "agent", label: "ag", prompt: "do", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "res", schema: { type: "string" } }] },
      { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "res", schema: { type: "string" }, required: true }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "i" } },
      { from: { nodeId: "ag", portId: "r" }, to: { nodeId: "out", portId: "i" } },
    ],
  };
}

describe("validatePflow", () => {
  it("passes a well-formed document", () => {
    expect(validatePflow(base()).ok).toBe(true);
  });
  it("flags a required input with no incoming wire", () => {
    const d = base();
    d.wires = d.wires.filter((w) => w.to.nodeId !== "ag");
    const r = validatePflow(d);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "required-input-unwired" && e.nodeId === "ag")).toBe(true);
  });
  it("flags a wire to a missing node", () => {
    const d = base();
    d.wires.push({ from: { nodeId: "ag", portId: "r" }, to: { nodeId: "ghost", portId: "i" } });
    expect(validatePflow(d).errors.some((e) => e.rule === "wire-missing-node")).toBe(true);
  });
  it("flags a wire to a missing port", () => {
    const d = base();
    d.wires.push({ from: { nodeId: "ag", portId: "nope" }, to: { nodeId: "out", portId: "i" } });
    expect(validatePflow(d).errors.some((e) => e.rule === "wire-missing-port")).toBe(true);
  });
  it("flags incompatible wired schemas", () => {
    const d = base();
    d.nodes[1].outputs[0].schema = { type: "number" };
    expect(validatePflow(d).errors.some((e) => e.rule === "wire-type-mismatch")).toBe(true);
  });
  it("rejects a branch node with no outgoing path", () => {
    const d: PflowDocument = {
      pflowFormatVersion: 1,
      workflow: { name: "b", description: "" },
      nodes: [
        { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
        { id: "br", kind: "branch", label: "br", prompt: "decide", inputs: [{ id: "i", name: "x", schema: { type: "string" }, required: true }], outputs: [{ id: "a", name: "a", schema: { type: "string" } }] },
      ],
      wires: [{ from: { nodeId: "in", portId: "o" }, to: { nodeId: "br", portId: "i" } }],
    };
    expect(validatePflow(d).errors.some((e) => e.rule === "branch-no-path" && e.nodeId === "br")).toBe(true);
  });

  it("rejects nested control-flow regions (a split inside a loop span)", () => {
    // loop span draft→review with a split also on the path → split entry is a
    // member of the loop region → nested-region-unsupported.
    const d: PflowDocument = {
      pflowFormatVersion: 1,
      workflow: { name: "nest", description: "" },
      nodes: [
        { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "array", items: { type: "string" } } }] },
        { id: "sp", kind: "split", label: "sp", inputs: [{ id: "i", name: "x", schema: { type: "array" }, required: true }, { id: "f", name: "fix", schema: { type: "string" } }], outputs: [{ id: "o", name: "item", schema: { type: "string" } }] },
        { id: "jn", kind: "join", label: "jn", inputs: [{ id: "i", name: "item", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "all", schema: { type: "array" } }] },
        { id: "review", kind: "loop", label: "review", prompt: "review; ALL_OWNED: yes|no", inputs: [{ id: "i", name: "all", schema: { type: "array" }, required: true }], outputs: [{ id: "o", name: "fix", schema: { type: "string" } }] },
        { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "all", schema: { type: "array" }, required: true }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "o" }, to: { nodeId: "sp", portId: "i" } },
        { from: { nodeId: "sp", portId: "o" }, to: { nodeId: "jn", portId: "i" } },
        { from: { nodeId: "jn", portId: "o" }, to: { nodeId: "review", portId: "i" } },
        { from: { nodeId: "review", portId: "o" }, to: { nodeId: "sp", portId: "f" } }, // back-edge → split is in the loop span
        { from: { nodeId: "jn", portId: "o" }, to: { nodeId: "out", portId: "i" } },
      ],
    };
    expect(validatePflow(d).errors.some((e) => e.rule === "nested-region-unsupported")).toBe(true);
  });

  it("rejects a script node with a downstream consumer (C2)", () => {
    const d: PflowDocument = {
      pflowFormatVersion: 1,
      workflow: { name: "s", description: "" },
      nodes: [
        { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
        { id: "s", kind: "script", label: "s", inputs: [{ id: "i", name: "topic", schema: { type: "string" } }], outputs: [{ id: "r", name: "res", schema: { type: "string" } }], config: { body: "const x = 1;" } },
        { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "res", schema: { type: "string" }, required: true }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "o" }, to: { nodeId: "s", portId: "i" } },
        { from: { nodeId: "s", portId: "r" }, to: { nodeId: "out", portId: "i" } },
      ],
    };
    const r = validatePflow(d);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "script-node-downstream-unsupported" && e.nodeId === "s")).toBe(true);
  });
});
