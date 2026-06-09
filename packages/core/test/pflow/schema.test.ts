import { describe, it, expect } from "vitest";
import { PortSchemaZ, PflowNodeZ } from "../../src/pflow/schema.js";
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

describe("Port.orphan", () => {
  it("parses a port carrying orphan:true", () => {
    const doc = parsePflow(JSON.stringify({
      ...MINIMAL,
      nodes: [
        { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "args", schema: { type: "any" }, orphan: true }] },
        ...MINIMAL.nodes.slice(1),
      ],
    }));
    expect(doc.nodes[0].outputs[0].orphan).toBe(true);
  });
  it("parses a port with no orphan field (backward compat)", () => {
    const doc = parsePflow(JSON.stringify(MINIMAL));
    expect(doc.nodes[0].outputs[0].orphan).toBeUndefined();
  });
});

describe("Port.projection", () => {
  it("round-trips a contract output port carrying a projection path", () => {
    const withProjection = {
      ...MINIMAL,
      nodes: [
        { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "args", schema: { type: "any" } }] },
        {
          id: "mem", kind: "mcp", label: "Memory",
          inputs: [],
          outputs: [{ id: "out:doc_id", name: "doc_id", schema: { type: "string" }, projection: "write_back.doc_id" }],
          config: { mcpServer: "vault-memory", contract: "meeting-prep" },
        },
        ...MINIMAL.nodes.slice(1),
      ],
    };
    const doc = parsePflow(JSON.stringify(withProjection));
    expect(doc.nodes[1].outputs[0].projection).toBe("write_back.doc_id");
    // serialize → parse again: the projection survives
    const again = parsePflow(JSON.stringify(doc));
    expect(again.nodes[1].outputs[0].projection).toBe("write_back.doc_id");
  });
  it("parses a port with no projection field (backward compat)", () => {
    const doc = parsePflow(JSON.stringify(MINIMAL));
    expect(doc.nodes[0].outputs[0].projection).toBeUndefined();
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

describe("mcp node kind", () => {
  it("includes 'mcp' in the kind vocabulary", () => {
    expect(NODE_KINDS).toContain("mcp");
  });
  it("parses an mcp node with config.mcpServer + expectedGrants", () => {
    const doc = parsePflow(JSON.stringify({
      pflowFormatVersion: 1,
      workflow: { name: "w", description: "d" },
      nodes: [{
        id: "fig", kind: "mcp", label: "Fetch design",
        prompt: "Use figma to fetch {{in:url}}; return {{out:design}}.",
        inputs: [{ id: "in:url", name: "url", schema: { type: "string" } }],
        outputs: [{ id: "out:design", name: "design", schema: { type: "string" } }],
        config: { mcpServer: "figma", expectedGrants: { get_design: "allow" } },
      }],
      wires: [],
    }));
    expect(doc.nodes[0].kind).toBe("mcp");
    expect(doc.nodes[0].config?.mcpServer).toBe("figma");
  });
});

describe("schema — eval kind", () => {
  it("accepts an eval node with mode + blockOnFail config", () => {
    const node = {
      id: "ev",
      kind: "eval",
      label: "Quality gate",
      prompt: "Evaluate {{in:candidate}}. Emit EVAL: pass or EVAL: fail. Route {{out:pass}}/{{out:fail}}.",
      inputs: [{ id: "in:candidate", name: "candidate", schema: { type: "string" } }],
      outputs: [
        { id: "out:pass", name: "pass", schema: { type: "string" } },
        { id: "out:fail", name: "fail", schema: { type: "string" } },
      ],
      config: { mode: "criteria", blockOnFail: false },
    };
    expect(PflowNodeZ.parse(node).kind).toBe("eval");
  });
});
