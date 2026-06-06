import { describe, it, expect } from "vitest";
import { PortSchemaZ } from "../../src/pflow/schema.js";
import { parsePflow, NODE_KINDS } from "../../src/pflow/schema.js";

const MINIMAL = {
  pflowFormatVersion: 1,
  workflow: { name: "demo", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "args", schema: { type: "any" } }] },
    { id: "out", kind: "output", label: "Output", inputs: [{ id: "i", name: "result", schema: { type: "any" } }], outputs: [] },
  ],
  wires: [{ from: { nodeId: "in", portId: "o" }, to: { nodeId: "out", portId: "i" } }],
  editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
};

describe("PortSchema", () => {
  it("accepts a scalar type", () => {
    expect(PortSchemaZ.parse({ type: "string" })).toEqual({ type: "string" });
  });
  it("accepts an array with item type", () => {
    const s = { type: "array", items: { type: "string" } };
    expect(PortSchemaZ.parse(s)).toEqual(s);
  });
  it("accepts a nested object schema", () => {
    const s = { type: "object", properties: { title: { type: "string" }, n: { type: "number" } }, required: ["title"] };
    expect(PortSchemaZ.parse(s)).toEqual(s);
  });
  it("rejects an unknown type", () => {
    expect(() => PortSchemaZ.parse({ type: "blob" })).toThrow();
  });
});

describe("parsePflow", () => {
  it("parses a minimal valid document", () => {
    const doc = parsePflow(JSON.stringify(MINIMAL));
    expect(doc.workflow.name).toBe("demo");
    expect(doc.nodes).toHaveLength(2);
    expect(doc.wires[0].from.nodeId).toBe("in");
  });
  it("throws on malformed JSON", () => {
    expect(() => parsePflow("{not json")).toThrow();
  });
  it("throws when a node kind is unknown", () => {
    const bad = { ...MINIMAL, nodes: [{ id: "x", kind: "frobnicate", label: "X", inputs: [], outputs: [] }] };
    expect(() => parsePflow(JSON.stringify(bad))).toThrow();
  });
  it("exposes the full node-kind vocabulary", () => {
    expect(NODE_KINDS).toContain("split");
    expect(NODE_KINDS).toContain("join");
    expect(NODE_KINDS).toContain("verify");
    expect(NODE_KINDS).toContain("script");
  });
  it("rejects a node id with an unsafe charset (I1)", () => {
    const bad = {
      ...MINIMAL,
      nodes: [
        { id: "n.1", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "args", schema: { type: "any" } }] },
        ...MINIMAL.nodes.slice(1),
      ],
    };
    expect(() => parsePflow(JSON.stringify(bad))).toThrow();
  });
  it("rejects a workflow name with a newline (I2)", () => {
    const bad = { ...MINIMAL, workflow: { name: "demo\nrm -rf", description: "d" } };
    expect(() => parsePflow(JSON.stringify(bad))).toThrow();
  });
  it("rejects a workflow name with a space or slash (I2)", () => {
    expect(() => parsePflow(JSON.stringify({ ...MINIMAL, workflow: { name: "a b", description: "d" } }))).toThrow();
    expect(() => parsePflow(JSON.stringify({ ...MINIMAL, workflow: { name: "a/b", description: "d" } }))).toThrow();
  });
});

describe("editor.inspectorWidth", () => {
  it("parses a document that carries inspectorWidth", () => {
    const doc = parsePflow(
      JSON.stringify({
        ...MINIMAL,
        editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [], inspectorWidth: 420 },
      }),
    );
    expect(doc.editor!.inspectorWidth).toBe(420);
  });
  it("parses a document with editor but no inspectorWidth (backward compat)", () => {
    const doc = parsePflow(JSON.stringify(MINIMAL));
    expect(doc.editor!.inspectorWidth).toBeUndefined();
  });
});
