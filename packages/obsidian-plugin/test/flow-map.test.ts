import { describe, it, expect } from "vitest";
import { MarkerType } from "@xyflow/system";
import { toFlowNodes, toFlowEdges, applyNodePosition, applyPromptEdit } from "../src/views/pflow-editor/flow-map.js";
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
  it("gives every edge a target arrowhead marker sized for visibility", () => {
    const edges = toFlowEdges(DOC);
    expect(edges[0].markerEnd).toEqual({ type: MarkerType.ArrowClosed, width: 24, height: 24 });
  });
  it("uses the custom pflow edge type (stick-out routing)", () => {
    const edges = toFlowEdges(DOC);
    expect(edges[0].type).toBe("pflow");
  });
});

describe("toFlowEdges orphan/inactive flag", () => {
  it("marks an edge inactive when its target port is an orphan", () => {
    const doc: PflowDocument = {
      ...DOC,
      nodes: DOC.nodes.map((n) =>
        n.id === "ag"
          ? { ...n, inputs: [{ id: "i", name: "topic", schema: { type: "string" }, orphan: true }] }
          : n,
      ),
    };
    const edge = toFlowEdges(doc).find((e) => e.target === "ag")!;
    expect(edge.data?.inactive).toBe(true);
  });
  it("leaves a normal edge active", () => {
    expect(toFlowEdges(DOC)[0].data?.inactive).toBeFalsy();
  });
});

describe("toFlowEdges type-mismatch flag", () => {
  // in.o (string) -> ag.i : make ag.i a json port so the types differ.
  const mismatch: PflowDocument = {
    ...DOC,
    nodes: DOC.nodes.map((n) =>
      n.id === "ag"
        ? { ...n, inputs: [{ id: "i", name: "topic", schema: { type: "object" as const } }] }
        : n,
    ),
  };
  it("flags an edge whose source/target port types differ", () => {
    const edge = toFlowEdges(mismatch).find((e) => e.target === "ag")!;
    expect(edge.data?.typeMismatch).toBe(true);
  });
  it("does not flag a matching-type edge", () => {
    expect(toFlowEdges(DOC)[0].data?.typeMismatch).toBeFalsy();
  });
});

describe("applyNodePosition", () => {
  it("upserts a node position in editor.nodePositions without mutating the input", () => {
    const next = applyNodePosition(DOC, "ag", 300, 90);
    expect(next.editor!.nodePositions).toContainEqual({ nodeId: "ag", x: 300, y: 90 });
    expect(DOC.editor!.nodePositions.some((p) => p.nodeId === "ag")).toBe(false);
  });
  it("overwrites an existing saved position", () => {
    const next = applyNodePosition(DOC, "in", 50, 60);
    const positions = next.editor!.nodePositions.filter((p) => p.nodeId === "in");
    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({ nodeId: "in", x: 50, y: 60 });
  });
});

describe("applyPromptEdit", () => {
  it("sets a node's prompt immutably", () => {
    const next = applyPromptEdit(DOC, "ag", "new prompt");
    expect(next.nodes.find((n) => n.id === "ag")!.prompt).toBe("new prompt");
    expect(DOC.nodes.find((n) => n.id === "ag")!.prompt).toBe("p");
  });
});

import { applyAddWire } from "../src/views/pflow-editor/flow-map.js";

describe("applyAddWire", () => {
  it("adds a new wire immutably", () => {
    const next = applyAddWire(DOC, { nodeId: "ag", portId: "r" }, { nodeId: "in", portId: "x" });
    // DOC has 1 wire (in.o->ag.i); adding ag.r->in.x yields 2
    expect(next.wires).toHaveLength(2);
    expect(DOC.wires).toHaveLength(1); // original untouched
    expect(next.wires.some((w) => w.from.nodeId === "ag" && w.to.nodeId === "in")).toBe(true);
  });
  it("no-ops when the exact wire already exists", () => {
    const next = applyAddWire(DOC, { nodeId: "in", portId: "o" }, { nodeId: "ag", portId: "i" });
    expect(next).toBe(DOC);
  });
  it("replaces an existing wire into the same input port (single-source inputs)", () => {
    // re-wire ag.i from a different source
    const next = applyAddWire(DOC, { nodeId: "ag", portId: "r" }, { nodeId: "ag", portId: "i" });
    const intoAgI = next.wires.filter((w) => w.to.nodeId === "ag" && w.to.portId === "i");
    expect(intoAgI).toHaveLength(1);
    expect(intoAgI[0].from.nodeId).toBe("ag");
  });
});

import {
  defaultPortsForKind,
  COMPILABLE_KINDS,
  applyAddNode,
  applyDeleteNode,
  applyLabelEdit,
  orphanedWiresForKind,
  applyKindChange,
  applyWorkflowMeta,
  applyArgDefault,
} from "../src/views/pflow-editor/flow-map.js";

describe("defaultPortsForKind", () => {
  it("agent has one in and one out", () => {
    expect(defaultPortsForKind("agent")).toEqual({
      inputs: [{ id: "in", name: "in", schema: { type: "any" }, required: true }],
      outputs: [{ id: "out", name: "out", schema: { type: "any" } }],
    });
  });
  it("input has no inputs, one out", () => {
    const p = defaultPortsForKind("input");
    expect(p.inputs).toEqual([]);
    expect(p.outputs).toHaveLength(1);
  });
  it("output has one in, no outputs", () => {
    const p = defaultPortsForKind("output");
    expect(p.inputs).toHaveLength(1);
    expect(p.outputs).toEqual([]);
  });
  it("loop has one in and one out", () => {
    const p = defaultPortsForKind("loop");
    expect(p.inputs).toHaveLength(1);
    expect(p.outputs).toHaveLength(1);
  });
});

describe("COMPILABLE_KINDS", () => {
  it("is all ten kinds now that codegen supports every kind", () => {
    expect(COMPILABLE_KINDS).toEqual([
      "input", "output", "agent", "split", "join", "loop", "verify", "synthesize", "branch", "script",
    ]);
  });
});

describe("applyAddNode", () => {
  it("appends a node with default ports and saves its position", () => {
    const next = applyAddNode(DOC, "agent", "New agent", 100, 200);
    const added = next.nodes[next.nodes.length - 1];
    expect(added.kind).toBe("agent");
    expect(added.label).toBe("New agent");
    expect(added.inputs).toHaveLength(1);
    expect(added.outputs).toHaveLength(1);
    expect(next.editor!.nodePositions).toContainEqual(
      expect.objectContaining({ nodeId: added.id, x: 100, y: 200 }),
    );
    expect(DOC.nodes).toHaveLength(2); // immutable
  });
  it("generates an id not already present", () => {
    const a = applyAddNode(DOC, "agent", "A", 0, 0);
    const b = applyAddNode(a, "agent", "B", 0, 0);
    const ids = b.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("applyDeleteNode", () => {
  it("removes the node, its wires, and its saved position", () => {
    const next = applyDeleteNode(DOC, "ag");
    expect(next.nodes.some((n) => n.id === "ag")).toBe(false);
    expect(next.wires.some((w) => w.from.nodeId === "ag" || w.to.nodeId === "ag")).toBe(false);
    expect((next.editor?.nodePositions ?? []).some((p) => p.nodeId === "ag")).toBe(false);
    expect(DOC.nodes.some((n) => n.id === "ag")).toBe(true); // immutable
  });
});

describe("applyLabelEdit", () => {
  it("sets a node's label immutably", () => {
    const next = applyLabelEdit(DOC, "ag", "Renamed");
    expect(next.nodes.find((n) => n.id === "ag")!.label).toBe("Renamed");
    expect(DOC.nodes.find((n) => n.id === "ag")!.label).not.toBe("Renamed");
  });
});

describe("orphanedWiresForKind", () => {
  it("flags the incoming wire when the new kind drops inputs", () => {
    // ag has incoming in.o->ag.i. Changing ag->input (no inputs) orphans it.
    const orphans = orphanedWiresForKind(DOC, "ag", "input");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ to: { nodeId: "ag", portId: "i" } });
  });
  it("flags wires whose port id is not in the new kind's default ports", () => {
    // ag's wire targets port 'i', but default ports are 'in'/'out', so even
    // ag->loop (which has an input) orphans the 'i'-targeted wire.
    const orphans = orphanedWiresForKind(DOC, "ag", "loop");
    expect(orphans).toHaveLength(1);
  });
  it("returns empty when no wire touches the changing node", () => {
    expect(orphanedWiresForKind(DOC, "in", "output")).toHaveLength(1); // in has outgoing wire on port 'o'
  });
});

describe("applyKindChange", () => {
  it("changes kind, resets ports to defaults, and drops orphaned wires", () => {
    const next = applyKindChange(DOC, "ag", "input");
    const node = next.nodes.find((n) => n.id === "ag")!;
    expect(node.kind).toBe("input");
    expect(node.inputs).toEqual([]);
    expect(next.wires.some((w) => w.to.nodeId === "ag")).toBe(false);
  });
});

describe("applyWorkflowMeta", () => {
  it("patches workflow name/description immutably", () => {
    const next = applyWorkflowMeta(DOC, { description: "new desc" });
    expect(next.workflow.description).toBe("new desc");
    expect(next.workflow.name).toBe(DOC.workflow.name);
    expect(DOC.workflow.description).not.toBe("new desc");
  });
});

describe("applyArgDefault", () => {
  it("sets a default on an args object property, creating args if absent", () => {
    const next = applyArgDefault(DOC, "target_folder", "Meetings/Follow-ups");
    const args = next.workflow.args as { type: "object"; properties: Record<string, unknown> };
    expect(args.type).toBe("object");
    expect(args.properties.target_folder).toMatchObject({ type: "string", default: "Meetings/Follow-ups" });
  });
});

import {
  applyInspectorWidth,
  MIN_INSPECTOR_WIDTH,
  MAX_INSPECTOR_WIDTH,
  derivePortsFromPrompt,
  applyPromptAndDerivePorts,
} from "../src/views/pflow-editor/flow-map.js";

describe("derivePortsFromPrompt", () => {
  it("agent: tokens replace ports", () => {
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "{{in:topic}} -> {{out:draft}}", inputs: [{ id: "in", name: "in", schema: { type: "any" as const }, required: true }], outputs: [{ id: "out", name: "out", schema: { type: "any" as const } }] };
    const r = derivePortsFromPrompt(node, []);
    expect(r.inputs.map((p) => p.id)).toEqual(["in:topic"]);
    expect(r.outputs.map((p) => p.id)).toEqual(["out:draft"]);
  });
  it("agent: no tokens, no wires -> default in/out", () => {
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "plain", inputs: [], outputs: [] };
    const r = derivePortsFromPrompt(node, []);
    expect(r.inputs.map((p) => p.id)).toEqual(["in"]);
    expect(r.outputs.map((p) => p.id)).toEqual(["out"]);
  });
  it("structural kind: tokens ADD, structural port preserved", () => {
    const loop = { id: "lp", kind: "loop" as const, label: "L", prompt: "{{in:extra}}", inputs: [{ id: "in", name: "draft", schema: { type: "any" as const }, required: true }], outputs: [{ id: "out", name: "fix", schema: { type: "any" as const } }] };
    const r = derivePortsFromPrompt(loop, []);
    expect(r.inputs.map((p) => p.id).sort()).toEqual(["in", "in:extra"].sort());
    expect(r.outputs.map((p) => p.id)).toContain("out");
  });
  it("carries the token's declared type onto the port schema", () => {
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "{{in:data:json}} {{out:rows:table}} {{in:plain}}", inputs: [], outputs: [] };
    const r = derivePortsFromPrompt(node, []);
    expect(r.inputs.find((p) => p.id === "in:data")?.schema.type).toBe("object");
    expect(r.inputs.find((p) => p.id === "in:plain")?.schema.type).toBe("string");
    expect(r.outputs.find((p) => p.id === "out:rows")?.schema.type).toBe("array");
  });
  it("a wired port dropped by an edited prompt becomes an orphan", () => {
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "{{in:topic}}", inputs: [{ id: "in:notes", name: "notes", schema: { type: "any" as const } }], outputs: [] };
    const wires = [{ from: { nodeId: "up", portId: "o" }, to: { nodeId: "ag", portId: "in:notes" } }];
    const r = derivePortsFromPrompt(node, wires);
    expect(r.inputs.find((p) => p.id === "in:notes")?.orphan).toBe(true);
    expect(r.inputs.some((p) => p.id === "in:topic")).toBe(true);
  });
});

describe("applyPromptAndDerivePorts", () => {
  it("commits prompt and re-derives ports immutably", () => {
    const next = applyPromptAndDerivePorts(DOC, "ag", "{{in:topic}} {{out:r}}");
    const ag = next.nodes.find((n) => n.id === "ag")!;
    expect(ag.prompt).toBe("{{in:topic}} {{out:r}}");
    // 'topic' is the new derived input; the fixture's existing input port 'i' is
    // WIRED (in.o->ag.i), so it survives as an orphan rather than being dropped.
    expect(ag.inputs.map((p) => p.id)).toEqual(["in:topic", "i"]);
    expect(ag.inputs.find((p) => p.id === "i")?.orphan).toBe(true);
    expect(ag.outputs.map((p) => p.id)).toEqual(["out:r"]);
    expect(DOC.nodes.find((n) => n.id === "ag")!.prompt).toBe("p");
  });
  it("drops a non-wired port that the prompt no longer declares (no orphan)", () => {
    // ag's output port 'r' is NOT wired in DOC, so a prompt declaring only
    // {{out:done}} replaces it cleanly — no orphan.
    const next = applyPromptAndDerivePorts(DOC, "ag", "{{in:topic}} {{out:done}}");
    const ag = next.nodes.find((n) => n.id === "ag")!;
    expect(ag.outputs.map((p) => p.id)).toEqual(["out:done"]);
  });
});

describe("applyInspectorWidth", () => {
  it("upserts the width into a doc, creating editor if absent", () => {
    const noEditor: PflowDocument = { ...DOC, editor: undefined };
    const next = applyInspectorWidth(noEditor, 400);
    expect(next.editor!.inspectorWidth).toBe(400);
    expect(next.editor!.nodePositions).toEqual([]);
  });
  it("clamps below the minimum", () => {
    expect(applyInspectorWidth(DOC, 10).editor!.inspectorWidth).toBe(MIN_INSPECTOR_WIDTH);
  });
  it("clamps above the maximum", () => {
    expect(applyInspectorWidth(DOC, 9999).editor!.inspectorWidth).toBe(MAX_INSPECTOR_WIDTH);
  });
  it("rounds to an integer", () => {
    expect(applyInspectorWidth(DOC, 321.7).editor!.inspectorWidth).toBe(322);
  });
  it("does not mutate the input document", () => {
    applyInspectorWidth(DOC, 400);
    expect(DOC.editor!.inspectorWidth).toBeUndefined();
  });
});
