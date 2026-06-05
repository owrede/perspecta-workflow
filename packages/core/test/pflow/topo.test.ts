import { describe, it, expect } from "vitest";
import { topoOrder, nodeById, outWires, inWires } from "../../src/pflow/topo.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function doc(nodes: string[], wires: [string, string][]): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "t", description: "" },
    nodes: nodes.map((id) => ({ id, kind: "agent", label: id, inputs: [{ id: "i", name: "i", schema: { type: "any" } }], outputs: [{ id: "o", name: "o", schema: { type: "any" } }] })),
    wires: wires.map(([f, t]) => ({ from: { nodeId: f, portId: "o" }, to: { nodeId: t, portId: "i" } })),
  } as PflowDocument;
}

describe("topoOrder", () => {
  it("orders a linear chain", () => {
    expect(topoOrder(doc(["a", "b", "c"], [["a", "b"], ["b", "c"]]))).toEqual(["a", "b", "c"]);
  });
  it("breaks ties by declared node order", () => {
    expect(topoOrder(doc(["a", "b", "c"], [["a", "b"], ["a", "c"]]))).toEqual(["a", "b", "c"]);
  });
  it("throws on a cycle", () => {
    expect(() => topoOrder(doc(["a", "b"], [["a", "b"], ["b", "a"]]))).toThrow(/cycle/i);
  });
});

describe("graph helpers", () => {
  const d = doc(["a", "b"], [["a", "b"]]);
  it("nodeById finds a node", () => { expect(nodeById(d, "a")?.label).toBe("a"); });
  it("outWires returns outgoing wires", () => { expect(outWires(d, "a")).toHaveLength(1); });
  it("inWires returns incoming wires", () => { expect(inWires(d, "b")).toHaveLength(1); });
});
