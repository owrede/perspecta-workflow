import type { PflowDocument, PflowNode, Wire } from "./schema.js";

export function nodeById(doc: PflowDocument, id: string): PflowNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}
export function outWires(doc: PflowDocument, nodeId: string): Wire[] {
  return doc.wires.filter((w) => w.from.nodeId === nodeId);
}
export function inWires(doc: PflowDocument, nodeId: string): Wire[] {
  return doc.wires.filter((w) => w.to.nodeId === nodeId);
}

/** Deterministic topological order of node ids from data wires. Ready-set ties
 *  broken by declared order. Throws on a cycle (non-loop cycles are authoring
 *  errors; bounded loops handled by validate/codegen). */
export function topoOrder(doc: PflowDocument): string[] {
  const order = doc.nodes.map((n) => n.id);
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const indegree = new Map<string, number>(order.map((id) => [id, 0] as const));
  for (const w of doc.wires) {
    indegree.set(w.to.nodeId, (indegree.get(w.to.nodeId) ?? 0) + 1);
  }
  const ready = order.filter((id) => (indegree.get(id) ?? 0) === 0);
  const result: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (rank.get(a)! - rank.get(b)!));
    const id = ready.shift()!;
    result.push(id);
    for (const w of outWires(doc, id)) {
      const t = w.to.nodeId;
      const next = (indegree.get(t) ?? 0) - 1;
      indegree.set(t, next);
      if (next === 0) ready.push(t);
    }
  }
  if (result.length !== order.length) {
    throw new Error("pflow graph has a cycle (outside a bounded loop region)");
  }
  return result;
}
