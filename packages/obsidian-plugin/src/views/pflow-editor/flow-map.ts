import type { PflowDocument, PflowNode, Port } from "@perspecta/core";

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
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
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
  return doc.wires.map((w) => ({
    id: `${w.from.nodeId}:${w.from.portId}->${w.to.nodeId}:${w.to.portId}`,
    source: w.from.nodeId,
    target: w.to.nodeId,
    sourceHandle: w.from.portId,
    targetHandle: w.to.portId,
  }));
}

/** Return a new document with `nodeId`'s saved position upserted. Immutable. */
export function applyNodePosition(doc: PflowDocument, nodeId: string, x: number, y: number): PflowDocument {
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  const nodePositions = editor.nodePositions.filter((p) => p.nodeId !== nodeId);
  nodePositions.push({ nodeId, x, y });
  return { ...doc, editor: { ...editor, nodePositions } };
}

/** Return a new document with `nodeId`'s prompt set. Immutable. */
export function applyPromptEdit(doc: PflowDocument, nodeId: string, prompt: string): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, prompt } : n)),
  };
}
