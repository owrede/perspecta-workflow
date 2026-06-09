import type { PortSchema } from "./schema.js";
import type { McpRegistry } from "./mcp-registry.js";
import { isPolicyStricter } from "./mcp-registry.js";
import {
  VAULT_MEMORY_SERVER,
  nodeContractMode,
  vmToolName,
  unboundRequiredContractInputs,
} from "./contract.js";

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
import { analyzeRegions, memberIdsOf } from "./regions.js";

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

  // A branch must have at least one labelled outgoing path; with none, codegen
  // would emit an `if`-chain with no arms.
  for (const node of doc.nodes) {
    if (node.kind === "branch" && outWires(doc, node.id).length === 0) {
      errors.push({ rule: "branch-no-path", message: `Branch node ${node.id} has no outgoing path`, nodeId: node.id });
    }
  }

  // Nested control-flow regions are not supported in this pass: a region's
  // member set must not contain another region's entry node. Detect by
  // analysing regions and checking for an entry inside another region's span.
  // (The loop node IS its own entry-as-member, so we exclude r's own entry.)
  const { regions } = analyzeRegions(doc);
  const entryIds = new Set(regions.map((r) => r.entryId));
  for (const r of regions) {
    for (const id of memberIdsOf(r)) {
      if (id !== r.entryId && entryIds.has(id)) {
        errors.push({
          rule: "nested-region-unsupported",
          message: `Control-flow region ${r.entryId} contains another region entry ${id}; nested regions are not supported`,
          nodeId: r.entryId,
        });
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** MCP-node lints, computed against the vault registry (which validatePflow does
 *  not have). Only `mcp-server-missing` is blocking for export (no service ⇒
 *  nothing to compile); the rest are informational. Pure. */
export function mcpLints(doc: PflowDocument, registry: McpRegistry): PflowError[] {
  const errors: PflowError[] = [];
  for (const node of doc.nodes) {
    if (node.kind !== "mcp") continue;
    const server = (node.config?.mcpServer as string | undefined) ?? "";
    if (!server) {
      errors.push({ rule: "mcp-server-missing", message: `MCP node ${node.id} has no service selected`, nodeId: node.id });
      continue;
    }
    const reg = registry[server];
    if (!reg || !reg.whitelisted) {
      errors.push({ rule: "mcp-server-not-whitelisted", message: `MCP node ${node.id}: service "${server}" is not whitelisted in this vault`, nodeId: node.id });
      continue;
    }
    if (reg.probe.status !== "hot") {
      const status = reg.probe.status;
      const detail =
        status === "failed"
          ? `probe failed${reg.probe.error ? `: ${reg.probe.error}` : ""}`
          : status === "probing"
            ? "probe in progress"
            : "not yet probed";
      errors.push({ rule: "mcp-server-cold", message: `MCP node ${node.id}: service "${server}" is whitelisted but unavailable (${detail})`, nodeId: node.id });
    }
    const expected = node.config?.expectedGrants as Record<string, "blocked" | "ask" | "allow"> | undefined;
    if (expected && reg.probe.status === "hot") {
      const stricter = isPolicyStricter(expected, reg);
      if (stricter.length) {
        errors.push({ rule: "mcp-policy-stricter", message: `MCP node ${node.id}: vault policy is stricter than expected for "${server}" — affected tools: ${stricter.join(", ")}`, nodeId: node.id });
      }
    }
    // ── Memory (vault-memory contract) lints — gated on the server so generic
    // MCP nodes are unaffected. contract-missing and input-unbound are BLOCKING
    // (buildWorkflowArtifacts refuses to export, like mcp-server-missing);
    // contract-stale is informational.
    if (server === VAULT_MEMORY_SERVER) {
      const contract = nodeContractMode(node);
      if (contract === undefined) {
        errors.push({ rule: "memory-contract-missing", message: `Memory node ${node.id}: no contract selected — pick a vault-memory contract in the inspector`, nodeId: node.id });
      } else {
        for (const name of unboundRequiredContractInputs(doc, node)) {
          errors.push({ rule: "memory-input-unbound", message: `Memory node ${node.id}: required contract input "${name}" is neither wired nor pinned`, nodeId: node.id });
        }
        if (reg.probe.status === "hot" && !(vmToolName(contract) in reg.tools)) {
          errors.push({ rule: "memory-contract-stale", message: `Memory node ${node.id}: contract "${contract}" is not in this vault's vault-memory registry — re-probe to refresh, or check the active vault`, nodeId: node.id });
        }
      }
    }
  }
  return errors;
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
