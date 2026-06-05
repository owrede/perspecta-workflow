import { describe, it, expect } from "vitest";
import { validatePflow } from "../../src/pflow/validate.js";
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
