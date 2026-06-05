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
import { nodeById, inWires } from "./topo.js";

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

  return { ok: errors.length === 0, errors };
}
