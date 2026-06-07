import { MarkerType } from "@xyflow/system";
import { NODE_KINDS, parsePromptTokens, portSchemaTypeForToken } from "@perspecta/core";
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

/** Compute a node's ports. There are NO structural ports: control-flow is
 *  inferred from wiring, not port names, so EVERY kind derives ports the same
 *  way — the union of:
 *    (a) prompt token ports ({{in:}}/{{out:}}), the "locked" prompt-declared ports;
 *    (b) inspector-defined ports already on the node (not duplicating a token
 *        NAME) — these are token-less ports the user added directly;
 *  with orphan marking for a wired token-style port whose token is gone, and a
 *  per-side default fallback (one `in`/`out`) when a side ends up empty — except
 *  the direction a kind lacks (input has no inputs, output has no outputs).
 *  Pure over (node, wires). */
export function derivePortsFromPrompt(
  node: { id: string; kind: NodeKind; prompt?: string; inputs: Port[]; outputs: Port[] },
  wires: Wire[],
): { inputs: Port[]; outputs: Port[] } {
  const { inputs: inToks, outputs: outToks } = parsePromptTokens(node.prompt ?? "");
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

  function build(toks: TokenPort[], make: (t: TokenPort) => Port, current: Port[], wiredIds: Set<string>): Port[] {
    const out: Port[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const tokenNames = new Set(toks.map((t) => t.name));
    const add = (p: Port, orphan: boolean) => {
      out.push({ ...p, orphan });
      seenIds.add(p.id);
      seenNames.add(p.name);
    };
    // 1) token ports (locked, prompt-declared)
    for (const t of toks) {
      const p = make(t);
      if (!seenNames.has(p.name)) add(p, false);
    }
    // 2) existing ports the tokens didn't cover: inspector-defined ports (kept),
    //    or a wired token-style port whose token vanished (orphan, dashed). A
    //    bare DEFAULT-fallback port (id+name exactly `in`/`out`) is NOT a
    //    user-added port — it is dropped once any token of this direction exists,
    //    so the first token replaces the default rather than coexisting with it.
    const isDefaultFallback = (p: Port) => (p.id === "in" && p.name === "in") || (p.id === "out" && p.name === "out");
    for (const cur of current) {
      if (seenIds.has(cur.id) || seenNames.has(cur.name)) continue;
      if (toks.length > 0 && isDefaultFallback(cur)) continue; // default replaced by tokens
      const looksTokenId = /^(in|out):/.test(cur.id);
      const orphan = looksTokenId && wiredIds.has(cur.id) && !tokenNames.has(cur.name);
      add(cur, orphan);
    }
    return out;
  }

  let inputs = build(inToks, tokenInput, node.inputs, wiredInIds);
  let outputs = build(outToks, tokenOutput, node.outputs, wiredOutIds);

  // Direction constraint: input is source-only, output is sink-only.
  if (node.kind === "input") inputs = [];
  if (node.kind === "output") outputs = [];

  // Per-side default fallback (all other kinds): an empty side gets one default
  // port, so a node always has a way to connect. The first token of that
  // direction replaces the default.
  const def = defaultPortsForKind(node.kind);
  if (node.kind !== "input" && inputs.length === 0) inputs = def.inputs;
  if (node.kind !== "output" && outputs.length === 0) outputs = def.outputs;
  return { inputs, outputs };
}

/** The token type suffix for a port's schema type (inverse of
 *  portSchemaTypeForToken): object→json, array→table, else string (no suffix). */
function tokenSuffixForSchema(type: string): string {
  if (type === "object") return ":json";
  if (type === "array") return ":table";
  return "";
}

/** Detect-ports: for each of the node's CURRENT ports whose name appears in the
 *  prompt and is NOT already tokenised, wrap the first plain occurrence as the
 *  matching {{in:name(:type)?}} / {{out:name(:type)?}} token. Deterministic
 *  stand-in for a future LLM pass. Immutable. (Word-boundary match so `note`
 *  doesn't match inside `notepad`.) */
export function applyDetectPorts(doc: PflowDocument, nodeId: string): PflowDocument {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return doc;
  let prompt = node.prompt ?? "";
  const already = parsePromptTokens(prompt);

  const wrap = (ports: Port[], dir: "in" | "out") => {
    const taken = new Set((dir === "in" ? already.inputs : already.outputs).map((t) => t.name));
    for (const p of ports) {
      if (taken.has(p.name)) continue; // already tokenised
      const suffix = tokenSuffixForSchema(p.schema.type);
      const token = `{{${dir}:${p.name}${suffix}}}`;
      // Replace the first whole-word occurrence. Names already tokenised are
      // skipped via `taken` above, so we needn't avoid the braces here: a name
      // inside `{{in:name}}` is only reached when that name is NOT yet a token,
      // which can't be the case for the same spelling. Distinct in/out names
      // that collide are handled by processing inputs before outputs.
      const re = new RegExp(`\\b${escapeForRegExp(p.name)}\\b`);
      if (re.test(prompt)) {
        prompt = prompt.replace(re, token);
        taken.add(p.name);
      }
    }
  };
  wrap(node.inputs, "in");
  wrap(node.outputs, "out");

  if (prompt === (node.prompt ?? "")) return doc; // nothing detected
  return applyPromptAndDerivePorts(doc, nodeId, prompt);
}

/** Escape a string for literal use inside a RegExp. */
function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Heal a document that carries DUPLICATE-NAMED ports on a node side — keep the
 *  FIRST port of each name, drop later same-name duplicates and any wire on them.
 *  (Cleans up legacy files where an older build persisted two same-named ports,
 *  e.g. a loop with both `out`(fix) and `out:fix`(fix).) Returns the same object
 *  when nothing changes, so a clean file is untouched. Immutable. */
export function dedupeDuplicateNamedPorts(doc: PflowDocument): PflowDocument {
  let changed = false;
  const removed = new Set<string>(); // `${nodeId}|${portId}`
  const nodes = doc.nodes.map((n) => {
    const heal = (ports: Port[]): Port[] => {
      const seen = new Set<string>();
      const kept = ports.filter((p) => {
        if (seen.has(p.name)) {
          removed.add(`${n.id}|${p.id}`);
          return false;
        }
        seen.add(p.name);
        return true;
      });
      return kept.length === ports.length ? ports : kept; // same ref when unchanged
    };
    const inputs = heal(n.inputs);
    const outputs = heal(n.outputs);
    if (inputs === n.inputs && outputs === n.outputs) return n;
    changed = true;
    return { ...n, inputs, outputs };
  });
  if (!changed) return doc;
  const wires = doc.wires.filter(
    (w) => !removed.has(`${w.from.nodeId}|${w.from.portId}`) && !removed.has(`${w.to.nodeId}|${w.to.portId}`),
  );
  return { ...doc, nodes, wires };
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
