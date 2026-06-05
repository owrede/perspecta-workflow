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
  data: FlowNodeData;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

/** Deterministic fallback position for a node without a saved position:
 *  lay out left-to-right by declared index so nodes never stack at 0,0. */
function fallbackPosition(index: number): { x: number; y: number } {
  return { x: index * 260, y: 80 };
}

export function toFlowNodes(doc: PflowDocument): FlowNode[] {
  const saved = new Map((doc.editor?.nodePositions ?? []).map((p) => [p.nodeId, p] as const));
  return doc.nodes.map((n: PflowNode, i: number) => {
    const pos = saved.get(n.id);
    return {
      id: n.id,
      type: "pflow" as const,
      position: pos ? { x: pos.x, y: pos.y } : fallbackPosition(i),
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
