import { MarkerType } from "@xyflow/system";
import { NODE_KINDS, parsePromptTokens, STRUCTURAL_PORT_IDS, portSchemaTypeForToken } from "@perspecta/core";
import type { TokenPort } from "@perspecta/core";
import type { PflowDocument, PflowNode, Port, Wire, NodeKind } from "@perspecta/core";

export interface FlowNodeData {
  kind: string;
  label: string;
  prompt?: string;
  inputs: Port[];
  outputs: Port[];
}
export interface FlowNode {
  id: string;
  type: "pflow";
  position: { x: number; y: number };
  /** Explicit node width so xyflow doesn't let the node auto-grow to its
   *  content; the component fills this box. Height is intrinsic. */
  width: number;
  data: FlowNodeData;
}

/** Fixed node width (px). The PflowNode component lays out to fill it. */
export const NODE_WIDTH = 220;

/** Inspector sidebar width bounds (px). DEFAULT is used when a document has no
 *  saved width; MIN/MAX clamp both the live drag and the persisted value. */
export const DEFAULT_INSPECTOR_WIDTH = 320;
export const MIN_INSPECTOR_WIDTH = 240;
export const MAX_INSPECTOR_WIDTH = 640;
export interface FlowEdge {
  id: string;
  /** Custom edge renderer (PflowEdge): guarantees a horizontal stick off each
   *  handle so near-straight and loop-back edges stay readable. */
  type: "pflow";
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  /** Arrowhead at the target end to show flow direction (sized up for visibility). */
  markerEnd: { type: MarkerType; width: number; height: number };
  /** Edge render data. `inactive` (dashed) when either endpoint port is an
   *  orphan. `typeMismatch` (red) when the source out-port type differs from the
   *  target in-port type — a non-blocking lint. */
  data: { inactive: boolean; typeMismatch: boolean };
}

/** Deterministic fallback position for a node without a saved position:
 *  a staggered left-to-right cascade so nodes never stack at 0,0 and the
 *  wires between them stay readable before the user arranges them. */
function fallbackPosition(index: number): { x: number; y: number } {
  return { x: index * (NODE_WIDTH + 80), y: 60 + (index % 2) * 140 };
}

export function toFlowNodes(doc: PflowDocument): FlowNode[] {
  const saved = new Map((doc.editor?.nodePositions ?? []).map((p) => [p.nodeId, p] as const));
  return doc.nodes.map((n: PflowNode, i: number) => {
    const pos = saved.get(n.id);
    return {
      id: n.id,
      type: "pflow" as const,
      position: pos ? { x: pos.x, y: pos.y } : fallbackPosition(i),
      width: NODE_WIDTH,
      data: { kind: n.kind, label: n.label, prompt: n.prompt, inputs: n.inputs, outputs: n.outputs },
    };
  });
}

export function toFlowEdges(doc: PflowDocument): FlowEdge[] {
  const portOf = (nodeId: string, portId: string, side: "in" | "out"): Port | undefined => {
    const n = doc.nodes.find((x) => x.id === nodeId);
    if (!n) return undefined;
    return (side === "in" ? n.inputs : n.outputs).find((p) => p.id === portId);
  };
  return doc.wires.map((w) => {
    const fromPort = portOf(w.from.nodeId, w.from.portId, "out");
    const toPort = portOf(w.to.nodeId, w.to.portId, "in");
    // Type mismatch: both ports resolve and their schema types differ. (A missing
    // port can't be a type clash — it's an orphan, handled by `inactive`.)
    const typeMismatch =
      !!fromPort && !!toPort && fromPort.schema.type !== toPort.schema.type;
    return {
      id: `${w.from.nodeId}:${w.from.portId}->${w.to.nodeId}:${w.to.portId}`,
      type: "pflow" as const,
      source: w.from.nodeId,
      target: w.to.nodeId,
      sourceHandle: w.from.portId,
      targetHandle: w.to.portId,
      markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
      data: {
        inactive: fromPort?.orphan === true || toPort?.orphan === true,
        typeMismatch,
      },
    };
  });
}

/** Return a new document with `nodeId`'s saved position upserted. Immutable. */
export function applyNodePosition(doc: PflowDocument, nodeId: string, x: number, y: number): PflowDocument {
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  const nodePositions = editor.nodePositions.filter((p) => p.nodeId !== nodeId);
  nodePositions.push({ nodeId, x, y });
  return { ...doc, editor: { ...editor, nodePositions } };
}

/** Return a new document with the inspector width set (clamped to the
 *  MIN/MAX bounds and rounded). Creates the editor block if absent. Immutable. */
export function applyInspectorWidth(doc: PflowDocument, width: number): PflowDocument {
  const clamped = Math.max(
    MIN_INSPECTOR_WIDTH,
    Math.min(MAX_INSPECTOR_WIDTH, Math.round(width)),
  );
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  return { ...doc, editor: { ...editor, inspectorWidth: clamped } };
}

/** Compute the ports a node's prompt implies. agent: tokens replace (no tokens
 *  & no wires -> default in/out). structural kinds: tokens ADD; the kind's
 *  structural ports (by id) are kept. Any current port that is wired but no
 *  longer derived (and not structural) is KEPT as an orphan so its wire survives
 *  as a dashed (inactive) edge. Pure over (node, wires). */
export function derivePortsFromPrompt(
  node: { id: string; kind: NodeKind; prompt?: string; inputs: Port[]; outputs: Port[] },
  wires: Wire[],
): { inputs: Port[]; outputs: Port[] } {
  const { inputs: inToks, outputs: outToks } = parsePromptTokens(node.prompt ?? "");
  const structural = STRUCTURAL_PORT_IDS[node.kind];
  // A token's declared type becomes the port's schema.type (string/object/array).
  const tokenInput = (t: TokenPort): Port => ({
    id: `in:${t.name}`,
    name: t.name,
    schema: { type: portSchemaTypeForToken(t.type) },
    required: false,
  });
  const tokenOutput = (t: TokenPort): Port => ({
    id: `out:${t.name}`,
    name: t.name,
    schema: { type: portSchemaTypeForToken(t.type) },
  });
  const wiredInIds = new Set(wires.filter((w) => w.to.nodeId === node.id).map((w) => w.to.portId));
  const wiredOutIds = new Set(wires.filter((w) => w.from.nodeId === node.id).map((w) => w.from.portId));

  function build(
    toks: TokenPort[],
    make: (t: TokenPort) => Port,
    current: Port[],
    structuralIds: string[],
    wiredIds: Set<string>,
  ): Port[] {
    const out: Port[] = [];
    const seen = new Set<string>();
    // 1) structural ports (preserve the node's current port object by id)
    for (const sid of structuralIds) {
      const cur = current.find((p) => p.id === sid);
      if (cur) {
        out.push({ ...cur, orphan: false });
        seen.add(cur.id);
      }
    }
    // 2) token ports
    for (const t of toks) {
      const p = make(t);
      if (seen.has(p.id)) continue;
      out.push(p);
      seen.add(p.id);
    }
    // 3) orphans: a current port still referenced by a wire but not (re-)derived
    for (const cur of current) {
      if (seen.has(cur.id)) continue;
      if (wiredIds.has(cur.id)) {
        out.push({ ...cur, orphan: true });
        seen.add(cur.id);
      }
    }
    return out;
  }

  let inputs = build(inToks, tokenInput, node.inputs, structural.inputs, wiredInIds);
  let outputs = build(outToks, tokenOutput, node.outputs, structural.outputs, wiredOutIds);

  // agent fallback: nothing derived and nothing wired -> single default in/out
  if (node.kind === "agent" && inputs.length === 0 && outputs.length === 0) {
    const def = defaultPortsForKind("agent");
    inputs = def.inputs;
    outputs = def.outputs;
  }
  return { inputs, outputs };
}

/** Set a node's prompt AND re-derive its ports from the new prompt. Immutable. */
export function applyPromptAndDerivePorts(doc: PflowDocument, nodeId: string, prompt: string): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const withPrompt = { ...n, prompt };
      const { inputs, outputs } = derivePortsFromPrompt(withPrompt, doc.wires);
      return { ...withPrompt, inputs, outputs };
    }),
  };
}

/** Return a new document with `nodeId`'s prompt set. Immutable. */
export function applyPromptEdit(doc: PflowDocument, nodeId: string, prompt: string): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, prompt } : n)),
  };
}

/** Add a wire (output port -> input port) created by a mouse drag. Immutable.
 *  No-ops when the exact wire already exists. Replaces any existing wire into
 *  the same input port (an input takes one source), so re-connecting an input
 *  rewires it rather than duplicating. */
export function applyAddWire(
  doc: PflowDocument,
  from: { nodeId: string; portId: string },
  to: { nodeId: string; portId: string },
): PflowDocument {
  const exists = doc.wires.some(
    (w) =>
      w.from.nodeId === from.nodeId &&
      w.from.portId === from.portId &&
      w.to.nodeId === to.nodeId &&
      w.to.portId === to.portId,
  );
  if (exists) return doc;
  // drop any wire already feeding this input port (single-source inputs)
  const kept = doc.wires.filter((w) => !(w.to.nodeId === to.nodeId && w.to.portId === to.portId));
  return { ...doc, wires: [...kept, { from, to }] };
}

/** Kinds the codegen can compile — now ALL of them. Kept as a named export
 *  (rather than inlining NODE_KINDS at call sites) so the add-menu/inspector
 *  "ghosting" mechanism stays in place if a future kind is added that codegen
 *  doesn't yet cover. */
export const COMPILABLE_KINDS: NodeKind[] = [...NODE_KINDS];

/** Default input/output ports for a freshly-created (or re-kinded) node.
 *  input: source only; output: sink only; everything else: one in + one out. */
export function defaultPortsForKind(kind: NodeKind): { inputs: Port[]; outputs: Port[] } {
  const inPort: Port = { id: "in", name: "in", schema: { type: "any" }, required: true };
  const outPort: Port = { id: "out", name: "out", schema: { type: "any" } };
  switch (kind) {
    case "input":
      return { inputs: [], outputs: [outPort] };
    case "output":
      return { inputs: [inPort], outputs: [] };
    default:
      return { inputs: [inPort], outputs: [outPort] };
  }
}

/** Append a new node of `kind` at (x,y) with default ports. Immutable. The new
 *  node is the last entry in `nodes`; its id is unique among existing ids. */
export function applyAddNode(
  doc: PflowDocument,
  kind: NodeKind,
  label: string,
  x: number,
  y: number,
): PflowDocument {
  const existing = new Set(doc.nodes.map((n) => n.id));
  let i = doc.nodes.length + 1;
  let id = `node-${i}`;
  while (existing.has(id)) {
    i += 1;
    id = `node-${i}`;
  }
  const { inputs, outputs } = defaultPortsForKind(kind);
  const node: PflowNode = { id, kind, label, inputs, outputs };
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  return {
    ...doc,
    nodes: [...doc.nodes, node],
    editor: { ...editor, nodePositions: [...editor.nodePositions, { nodeId: id, x, y }] },
  };
}

/** Remove a node plus every wire touching it and its saved position. Immutable. */
export function applyDeleteNode(doc: PflowDocument, nodeId: string): PflowDocument {
  const editor = doc.editor;
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => n.id !== nodeId),
    wires: doc.wires.filter((w) => w.from.nodeId !== nodeId && w.to.nodeId !== nodeId),
    editor: editor
      ? { ...editor, nodePositions: editor.nodePositions.filter((p) => p.nodeId !== nodeId) }
      : editor,
  };
}

/** Set a node's label. Immutable. */
export function applyLabelEdit(doc: PflowDocument, nodeId: string, label: string): PflowDocument {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n)) };
}

/** Wires that would dangle if `nodeId` became `kind`: any wire referencing a
 *  port id the new kind's DEFAULT ports won't include (both directions). The
 *  caller should confirm with the user before applying when this is non-empty. */
export function orphanedWiresForKind(doc: PflowDocument, nodeId: string, kind: NodeKind): Wire[] {
  const { inputs, outputs } = defaultPortsForKind(kind);
  const inIds = new Set(inputs.map((p) => p.id));
  const outIds = new Set(outputs.map((p) => p.id));
  return doc.wires.filter((w) => {
    if (w.to.nodeId === nodeId && !inIds.has(w.to.portId)) return true;
    if (w.from.nodeId === nodeId && !outIds.has(w.from.portId)) return true;
    return false;
  });
}

/** Change a node's kind, reset its ports to the kind defaults, and drop any
 *  wires orphaned by the new ports. Immutable. */
export function applyKindChange(doc: PflowDocument, nodeId: string, kind: NodeKind): PflowDocument {
  const orphans = new Set(orphanedWiresForKind(doc, nodeId, kind));
  const { inputs, outputs } = defaultPortsForKind(kind);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, kind, inputs, outputs } : n)),
    wires: doc.wires.filter((w) => !orphans.has(w)),
  };
}

/** Patch workflow-level name/description. Immutable. */
export function applyWorkflowMeta(
  doc: PflowDocument,
  patch: { name?: string; description?: string },
): PflowDocument {
  return { ...doc, workflow: { ...doc.workflow, ...patch } };
}

/** Set a string-typed arg default on the workflow args object, creating the
 *  object-typed args schema if missing. The default is carried on the property
 *  as `default`; the codegen/runtime reads it as the arg's default value.
 *  Immutable. */
export function applyArgDefault(doc: PflowDocument, key: string, value: string): PflowDocument {
  const current = doc.workflow.args;
  const base =
    current && current.type === "object"
      ? current
      : { type: "object" as const, properties: {}, required: [] };
  const properties = { ...(base as { properties?: Record<string, unknown> }).properties };
  properties[key] = { type: "string", default: value };
  return {
    ...doc,
    workflow: {
      ...doc.workflow,
      args: { ...base, properties } as PflowDocument["workflow"]["args"],
    },
  };
}
