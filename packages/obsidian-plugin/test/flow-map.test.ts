import { describe, it, expect } from "vitest";
import { toFlowNodes, toFlowEdges } from "../src/views/pflow-editor/flow-map.js";
import type { PflowDocument } from "@perspecta/core";

const DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "demo", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "ag", kind: "agent", label: "Research", prompt: "p", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "notes", schema: { type: "string" } }] },
  ],
  wires: [{ from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "i" } }],
  editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [{ nodeId: "in", x: 10, y: 20 }] },
};

describe("toFlowNodes", () => {
  it("maps each pflow node to a flow node with type 'pflow'", () => {
    const nodes = toFlowNodes(DOC);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ id: "in", type: "pflow" });
    expect(nodes[0].data.kind).toBe("input");
    expect(nodes[0].data.label).toBe("Input");
  });
  it("uses saved positions when present, falls back to a deterministic layout", () => {
    const nodes = toFlowNodes(DOC);
    const inNode = nodes.find((n) => n.id === "in")!;
    expect(inNode.position).toEqual({ x: 10, y: 20 });
    const agNode = nodes.find((n) => n.id === "ag")!;
    expect(agNode.position).not.toEqual(inNode.position);
  });
  it("passes ports through in node data for handle rendering", () => {
    const ag = toFlowNodes(DOC).find((n) => n.id === "ag")!;
    expect(ag.data.inputs[0].name).toBe("topic");
    expect(ag.data.outputs[0].name).toBe("notes");
  });
});

describe("toFlowEdges", () => {
  it("maps each wire to a flow edge with source/target handles = port ids", () => {
    const edges = toFlowEdges(DOC);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "in", target: "ag", sourceHandle: "o", targetHandle: "i" });
  });
  it("gives every edge a stable unique id", () => {
    const edges = toFlowEdges(DOC);
    expect(edges[0].id).toBe("in:o->ag:i");
  });
});
