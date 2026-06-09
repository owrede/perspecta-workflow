import type { PortSchema, PflowNode } from "./schema.js";

/**
 * vault-memory contract snapshot — the typed bridge between a contract's
 * describe_contract result (input JSON Schema + output_shape + sink summary)
 * and pflow's port model. Stamped into an mcp node's `config.contractSnapshot`
 * by the editor so the node renders cold-safe (no live server needed).
 *
 * All parsers here are PURE and deterministic: object keys are iterated in
 * declared order (never sorted), matching scriptgen's determinism contract.
 */

export interface ContractInputDef {
  name: string;
  schema: PortSchema;
  required: boolean;
}

export interface ContractOutputDef {
  name: string;
  schema: PortSchema;
  /** Dotted access path off the result bundle, e.g. "steps" or
   *  "write_back.doc_id". Empty string = the whole bundle. */
  projection: string;
}

export interface ContractSnapshot {
  inputs: ContractInputDef[];
  outputs: ContractOutputDef[];
  /** Sink summary for the write-back badge (e.g. ["default", "_memory/_briefs"]). */
  writesTo: string[];
  describedAt?: string;
}

/** The single fallback output when output_shape is absent or opaque: the whole
 *  `{steps, write_back}` bundle as one untyped port. */
const BUNDLE_FALLBACK: ContractOutputDef[] = [
  { name: "bundle", schema: { type: "any" }, projection: "" },
];

/** Map a vault-memory input/output JSON Schema fragment to pflow's PortSchema
 *  union. Lossy by design: `integer` → number; `$ref` / unions / unknown → any. */
export function jsonSchemaToPortSchema(js: unknown): PortSchema {
  if (typeof js !== "object" || js === null) return { type: "any" };
  const o = js as Record<string, unknown>;
  const t = o.type;
  if (t === "string" || t === "number" || t === "boolean") return { type: t };
  if (t === "integer") return { type: "number" };
  if (t === "array") {
    const items = o.items;
    if (typeof items === "object" && items !== null) {
      return { type: "array", items: jsonSchemaToPortSchema(items) };
    }
    return { type: "array" };
  }
  if (t === "object") {
    const props = o.properties;
    if (typeof props !== "object" || props === null) return { type: "object" };
    const properties: Record<string, PortSchema> = {};
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      properties[k] = jsonSchemaToPortSchema(v);
    }
    const out: PortSchema = { type: "object", properties };
    const req = o.required;
    if (Array.isArray(req) && req.every((r) => typeof r === "string")) {
      (out as { required?: string[] }).required = req as string[];
    }
    return out;
  }
  return { type: "any" };
}

/** Top-level properties of a contract's input JSON Schema → typed input defs,
 *  in declared order. `required` defaults to the schema's own required array;
 *  an explicit second argument overrides it. */
export function parseContractInputs(inputSchema: unknown, required?: string[]): ContractInputDef[] {
  if (typeof inputSchema !== "object" || inputSchema === null) return [];
  const o = inputSchema as Record<string, unknown>;
  const props = o.properties;
  if (typeof props !== "object" || props === null) return [];
  const req = new Set(
    required ?? (Array.isArray(o.required) ? (o.required as unknown[]).filter((r): r is string => typeof r === "string") : []),
  );
  const defs: ContractInputDef[] = [];
  for (const [name, schema] of Object.entries(props as Record<string, unknown>)) {
    defs.push({ name, schema: jsonSchemaToPortSchema(schema), required: req.has(name) });
  }
  return defs;
}

/** A contract's output_shape → output port defs:
 *  - each top-level property → one def (projection = the property name);
 *  - one level of nested projection: an object-typed top-level property emits
 *    an additional child def per non-object nested property (the useful leaves,
 *    e.g. `write_back.doc_id` → a `doc_id` port). The child's port name is the
 *    leaf name, or `<top>_<leaf>` when that collides with an already-emitted
 *    name. Deeper nesting and array projection are out of scope.
 *  - absent / non-object / property-less output_shape → the `bundle` fallback.
 *  Deterministic: declared key order throughout. */
export function parseContractOutputs(outputShape: unknown): ContractOutputDef[] {
  if (typeof outputShape !== "object" || outputShape === null) return [...BUNDLE_FALLBACK];
  const props = (outputShape as Record<string, unknown>).properties;
  if (typeof props !== "object" || props === null) return [...BUNDLE_FALLBACK];
  const entries = Object.entries(props as Record<string, unknown>);
  if (entries.length === 0) return [...BUNDLE_FALLBACK];

  const defs: ContractOutputDef[] = [];
  const taken = new Set<string>();
  const push = (name: string, schema: PortSchema, projection: string) => {
    defs.push({ name, schema, projection });
    taken.add(name);
  };

  for (const [top, topJs] of entries) {
    push(top, jsonSchemaToPortSchema(topJs), top);
  }
  // Children second, so a leaf only collides against the full set of top-level
  // names plus earlier children — deterministic in declared order.
  for (const [top, topJs] of entries) {
    if (typeof topJs !== "object" || topJs === null) continue;
    const t = topJs as Record<string, unknown>;
    if (t.type !== "object" || typeof t.properties !== "object" || t.properties === null) continue;
    for (const [leaf, leafJs] of Object.entries(t.properties as Record<string, unknown>)) {
      const leafSchema = jsonSchemaToPortSchema(leafJs);
      if (leafSchema.type === "object") continue; // not a leaf — no deep projection
      const name = taken.has(leaf) ? `${top}_${leaf}` : leaf;
      if (taken.has(name)) continue; // double collision: skip rather than invent names
      push(name, leafSchema, `${top}.${leaf}`);
    }
  }
  return defs;
}

/** The subset of a describe_contract result the snapshot consumes. `json_schema`
 *  is required (every vault-memory version returns it); `output_shape` and
 *  `writes_to` are the structured fields newer vault-memory versions add —
 *  absent fields degrade to the bundle port / empty badge. */
export interface RawContractDescription {
  json_schema: unknown;
  output_shape?: unknown;
  writes_to?: string[];
}

/** The server name whose mcp nodes can enter contract mode. */
export const VAULT_MEMORY_SERVER = "vault-memory";

/** The selected contract of an mcp node in contract mode, or undefined when the
 *  node is any other kind, bound to another server, or has no contract picked.
 *  This is THE contract-mode detection used by codegen, lints, and the editor. */
export function nodeContractMode(node: PflowNode): string | undefined {
  if (node.kind !== "mcp") return undefined;
  if (node.config?.mcpServer !== VAULT_MEMORY_SERVER) return undefined;
  const c = node.config?.contract;
  return typeof c === "string" && c.length > 0 ? c : undefined;
}

/** The dynamic MCP tool name vault-memory registers for a contract: `vm_` +
 *  the slugified contract name (dashes → underscores; anything outside the
 *  tool-name charset hardened to underscores). Mirrors vault-memory's slugify. */
export function vmToolName(contract: string): string {
  return `vm_${contract.replace(/-/g, "_").replace(/[^A-Za-z0-9_]/g, "_")}`;
}

/** Build the full snapshot from a describe_contract result. Pure. */
export function contractSnapshotFromDescribe(
  raw: RawContractDescription,
  describedAt?: string,
): ContractSnapshot {
  return {
    inputs: parseContractInputs(raw.json_schema),
    outputs: parseContractOutputs(raw.output_shape),
    writesTo: Array.isArray(raw.writes_to) ? raw.writes_to.filter((w): w is string => typeof w === "string") : [],
    ...(describedAt !== undefined ? { describedAt } : {}),
  };
}
