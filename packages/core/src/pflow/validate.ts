import type { PortSchema } from "./schema.js";

/** Shallow M1 port-compatibility. `any` joins anything; scalars must match
 *  exactly; arrays must agree on item type (missing items === any); objects
 *  join objects without deep property subtyping. */
export function schemaCompatible(from: PortSchema, to: PortSchema): boolean {
  if (from.type === "any" || to.type === "any") return true;
  if (from.type !== to.type) return false;
  if (from.type === "array" && to.type === "array") {
    const fi = from.items ?? { type: "any" as const };
    const ti = to.items ?? { type: "any" as const };
    return schemaCompatible(fi, ti);
  }
  return true;
}

import type { PflowDocument, Port } from "./schema.js";
import { nodeById, inWires, outWires } from "./topo.js";

export interface PflowError { rule: string; message: string; nodeId?: string; }
export interface PflowValidation { ok: boolean; errors: PflowError[]; }

function findPort(ports: Port[], id: string): Port | undefined {
  return ports.find((p) => p.id === id);
}

export function validatePflow(doc: PflowDocument): PflowValidation {
  const errors: PflowError[] = [];

  for (const w of doc.wires) {
    const fromNode = nodeById(doc, w.from.nodeId);
    const toNode = nodeById(doc, w.to.nodeId);
    if (!fromNode || !toNode) {
      errors.push({ rule: "wire-missing-node", message: `Wire ${w.from.nodeId}.${w.from.portId} -> ${w.to.nodeId}.${w.to.portId} references a missing node` });
      continue;
    }
    const fromPort = findPort(fromNode.outputs, w.from.portId);
    const toPort = findPort(toNode.inputs, w.to.portId);
    if (!fromPort || !toPort) {
      errors.push({ rule: "wire-missing-port", message: `Wire ${w.from.nodeId}.${w.from.portId} -> ${w.to.nodeId}.${w.to.portId} references a missing port` });
      continue;
    }
    if (!schemaCompatible(fromPort.schema, toPort.schema)) {
      errors.push({ rule: "wire-type-mismatch", message: `Wire ${w.from.nodeId}.${fromPort.name} (${fromPort.schema.type}) is not compatible with ${w.to.nodeId}.${toPort.name} (${toPort.schema.type})`, nodeId: w.to.nodeId });
    }
  }

  for (const node of doc.nodes) {
    const incoming = inWires(doc, node.id);
    for (const port of node.inputs) {
      if (port.required === false) continue;
      const wired = incoming.some((w) => w.to.portId === port.id);
      if (!wired) {
        errors.push({ rule: "required-input-unwired", message: `Required input "${port.name}" of node ${node.id} has no incoming wire`, nodeId: node.id });
      }
    }
  }

  for (const node of doc.nodes) {
    if (node.kind === "script" && outWires(doc, node.id).length > 0) {
      errors.push({
        rule: "script-node-downstream-unsupported",
        message: `Script node ${node.id} has outgoing wires, but script-node outputs are not yet supported in M1 (its body does not bind an output variable). A script node may only be a side-effecting terminal with no downstream consumers.`,
        nodeId: node.id,
      });
    }
  }

  const splits = doc.nodes.filter((n) => n.kind === "split");
  const joins = doc.nodes.filter((n) => n.kind === "join");
  if (splits.length !== joins.length) {
    errors.push({ rule: "split-join-unbalanced", message: `Found ${splits.length} split node(s) and ${joins.length} join node(s); they must be paired` });
  }
  for (const sp of splits) {
    const arrayInput = sp.inputs.some((p) => p.schema.type === "array");
    if (!arrayInput) {
      errors.push({ rule: "split-needs-array", message: `Split node ${sp.id} requires an array-typed input to fan out`, nodeId: sp.id });
    }
    if (joins.length > 0 && !reachesJoin(doc, sp.id)) {
      errors.push({ rule: "split-no-join", message: `Split node ${sp.id} does not reach a join node`, nodeId: sp.id });
    }
  }

  return { ok: errors.length === 0, errors };
}

/** True if a join node is reachable downstream of startId via data wires. */
function reachesJoin(doc: PflowDocument, startId: string): boolean {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodeById(doc, id);
    if (node && node.id !== startId && node.kind === "join") return true;
    for (const w of doc.wires.filter((w) => w.from.nodeId === id)) stack.push(w.to.nodeId);
  }
  return false;
}
