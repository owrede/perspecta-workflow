import { MarkerType } from "@xyflow/system";
import { NODE_KINDS, parsePromptTokens, portSchemaTypeForToken, resolveServerGrants, snapshotGrants, nodeContractMode, contractSnapshotOf, VAULT_MEMORY_SERVER } from "@perspecta/core";
import type { TokenPort, TokenType, McpRegistry, ContractSnapshot } from "@perspecta/core";
import type { PflowDocument, PflowNode, Port, Wire, NodeKind } from "@perspecta/core";
import { templateForMode, DEFAULT_EVAL_MODE, type EvalMode } from "./eval-templates.js";

/** A port as rendered on the canvas: the persisted Port plus `wired` — whether
 *  any wire touches this port. The node fills a port's dot when it is wired
 *  (connected), independent of `required`. `wired` is derived per-render from
 *  doc.wires and never persisted. */
export type RenderPort = Port & { wired?: boolean };

export interface FlowNodeData {
  kind: string;
  label: string;
  prompt?: string;
  mcpServer?: string;
  /** Eval node mode (config.mode), surfaced for the inspector's mode picker. */
  evalMode?: string;
  /** Eval node block-on-fail flag (config.blockOnFail), surfaced for the toggle. */
  blockOnFail?: boolean;
  /** Contract mode (vault-memory mcp node with a selected contract): the
   *  canonical contract name, write-back badge data, pinned literals, and the
   *  snapshot's per-input required flags — derived from config per render. */
  contract?: string;
  writesTo?: string[];
  contractInputs?: Record<string, unknown>;
  contractRequired?: Record<string, boolean>;
  inputs: RenderPort[];
  outputs: RenderPort[];
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
  // A port is "wired" when some wire references it (by node + port id), on
  // either end. The node renders a filled dot for wired ports.
  const wiredIn = new Set(doc.wires.map((w) => `${w.to.nodeId} ${w.to.portId}`));
  const wiredOut = new Set(doc.wires.map((w) => `${w.from.nodeId} ${w.from.portId}`));
  return doc.nodes.map((n: PflowNode, i: number) => {
    const pos = saved.get(n.id);
    const markWired = (set: Set<string>) => (p: Port): RenderPort => ({
      ...p,
      wired: set.has(`${n.id} ${p.id}`),
    });
    const contract = nodeContractMode(n);
    const snap = contract !== undefined ? contractSnapshotOf(n) : undefined;
    return {
      id: n.id,
      type: "pflow" as const,
      position: pos ? { x: pos.x, y: pos.y } : fallbackPosition(i),
      width: NODE_WIDTH,
      data: {
        kind: n.kind,
        label: n.label,
        prompt: n.prompt,
        mcpServer: n.config?.mcpServer as string | undefined,
        evalMode: n.config?.mode as string | undefined,
        blockOnFail: n.config?.blockOnFail === true,
        contract,
        writesTo: snap?.writesTo,
        contractInputs: contract !== undefined ? (n.config?.contractInputs as Record<string, unknown> | undefined) : undefined,
        contractRequired: snap ? Object.fromEntries(snap.inputs.map((d) => [d.name, d.required])) : undefined,
        inputs: n.inputs.map(markWired(wiredIn)),
        outputs: n.outputs.map(markWired(wiredOut)),
      },
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
    // `any` is a wildcard (e.g. a fresh input node's default out-port): it is
    // compatible with every type, so an `any` endpoint is never a mismatch.
    const typeMismatch =
      !!fromPort &&
      !!toPort &&
      fromPort.schema.type !== "any" &&
      toPort.schema.type !== "any" &&
      fromPort.schema.type !== toPort.schema.type;
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

/** Persist the canvas pan/zoom into editor.viewport so reopening the .pflow
 *  (or restoring a Perspecta arrangement that includes it) returns to the same
 *  view instead of fit-to-content. */
export function applyViewport(
  doc: PflowDocument,
  viewport: { x: number; y: number; zoom: number },
): PflowDocument {
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  return {
    ...doc,
    editor: {
      ...editor,
      viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
    },
  };
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

// ── Port editor helpers ─────────────────────────────────────────────────────
// The inspector port editor and the prompt tokens are two views of the same
// ports. A port is "token-locked" when the prompt declares a matching token —
// then it can't be removed in the inspector, and type/name edits rewrite the
// token so the two never disagree. An inspector-only (token-less) port is freely
// editable/removable until its token appears.

type PortDir = "in" | "out";

/** Token type suffix for a token type ("" for string). */
function suffixForType(type: TokenType): string {
  return type === "string" ? "" : `:${type}`;
}

/** Map a PortSchema type back to the token type keyword. */
function tokenTypeForSchema(type: string): TokenType {
  if (type === "object") return "json";
  if (type === "array") return "table";
  return "string";
}

/** Replace every `{{dir:oldName(:anytype)?}}` occurrence in `prompt` with a
 *  token spelled `{{dir:newName(:newType)?}}`. Used to keep the prompt in sync
 *  when a token-backed port is renamed or retyped. */
function rewriteToken(prompt: string, dir: PortDir, oldName: string, newName: string, newType: TokenType): string {
  // Match the name with an optional :type suffix (string|json|table).
  const re = new RegExp(`\\{\\{${dir}:${escapeForRegExp(oldName)}(?::(?:string|json|table))?\\}\\}`, "g");
  return prompt.replace(re, `{{${dir}:${newName}${suffixForType(newType)}}}`);
}

/** True when the node's prompt declares a token whose name matches `port`. */
export function isPortTokenLocked(node: { prompt?: string }, port: Port, dir: PortDir): boolean {
  const toks = parsePromptTokens(node.prompt ?? "");
  return (dir === "in" ? toks.inputs : toks.outputs).some((t) => t.name === port.name);
}

/** Add an inspector-only port (no token written) of `dir` named `name` with the
 *  given token type. No-op for input-kind inputs / output-kind outputs, and when
 *  a port of that name already exists on the side. Immutable. */
export function applyAddPort(
  doc: PflowDocument,
  nodeId: string,
  dir: PortDir,
  name: string,
  type: TokenType,
): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      if (dir === "in" && n.kind === "input") return n;
      if (dir === "out" && n.kind === "output") return n;
      const list = dir === "in" ? n.inputs : n.outputs;
      if (list.some((p) => p.name === name)) return n;
      const port: Port = {
        id: `${dir}:${name}`,
        name,
        schema: { type: portSchemaTypeForToken(type) },
        ...(dir === "in" ? { required: false } : {}),
      };
      return dir === "in" ? { ...n, inputs: [...n.inputs, port] } : { ...n, outputs: [...n.outputs, port] };
    }),
  };
}

/** Remove a port by id — UNLESS it is token-locked (then no-op; the UI hides the
 *  control, this is the safety net). Drops wires on the removed port. Immutable. */
export function applyRemovePort(doc: PflowDocument, nodeId: string, dir: PortDir, portId: string): PflowDocument {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return doc;
  const list = dir === "in" ? node.inputs : node.outputs;
  const port = list.find((p) => p.id === portId);
  if (!port) return doc;
  if (isPortTokenLocked(node, port, dir)) return doc; // token-locked: not removable
  const nodes = doc.nodes.map((n) =>
    n.id === nodeId
      ? dir === "in"
        ? { ...n, inputs: n.inputs.filter((p) => p.id !== portId) }
        : { ...n, outputs: n.outputs.filter((p) => p.id !== portId) }
      : n,
  );
  const wires = doc.wires.filter((w) =>
    dir === "in"
      ? !(w.to.nodeId === nodeId && w.to.portId === portId)
      : !(w.from.nodeId === nodeId && w.from.portId === portId),
  );
  return { ...doc, nodes, wires };
}

/** Change a port's type. Updates schema.type; if the port is token-backed,
 *  rewrites the token's suffix in the prompt so the two agree. Immutable. */
export function applyPortType(
  doc: PflowDocument,
  nodeId: string,
  dir: PortDir,
  name: string,
  type: TokenType,
): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const apply = (ports: Port[]) =>
        ports.map((p) => (p.name === name ? { ...p, schema: { type: portSchemaTypeForToken(type) } } : p));
      const locked = isPortTokenLocked(n, { id: `${dir}:${name}`, name, schema: { type: "any" } }, dir);
      const prompt = locked ? rewriteToken(n.prompt ?? "", dir, name, name, type) : n.prompt;
      return dir === "in"
        ? { ...n, inputs: apply(n.inputs), prompt }
        : { ...n, outputs: apply(n.outputs), prompt };
    }),
  };
}

/** Rename a port. Updates name + id; re-points wires; if token-backed, rewrites
 *  the token name in the prompt (preserving its type). Immutable. */
export function applyPortRename(
  doc: PflowDocument,
  nodeId: string,
  dir: PortDir,
  oldName: string,
  newName: string,
): PflowDocument {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return doc;
  const list = dir === "in" ? node.inputs : node.outputs;
  const port = list.find((p) => p.name === oldName);
  if (!port) return doc;
  const oldId = port.id;
  const newId = `${dir}:${newName}`;
  const type = tokenTypeForSchema(port.schema.type);
  const locked = isPortTokenLocked(node, port, dir);
  const nodes = doc.nodes.map((n) => {
    if (n.id !== nodeId) return n;
    const apply = (ports: Port[]) =>
      ports.map((p) => (p.id === oldId ? { ...p, id: newId, name: newName } : p));
    const prompt = locked ? rewriteToken(n.prompt ?? "", dir, oldName, newName, type) : n.prompt;
    return dir === "in"
      ? { ...n, inputs: apply(n.inputs), prompt }
      : { ...n, outputs: apply(n.outputs), prompt };
  });
  const wires = doc.wires.map((w) => {
    if (dir === "in" && w.to.nodeId === nodeId && w.to.portId === oldId) return { ...w, to: { ...w.to, portId: newId } };
    if (dir === "out" && w.from.nodeId === nodeId && w.from.portId === oldId) return { ...w, from: { ...w.from, portId: newId } };
    return w;
  });
  return { ...doc, nodes, wires };
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

/** A connector dragged from a handle and dropped on a TARGET CARD (not a
 *  specific port). Create the matching opposite-direction port on the target —
 *  same name and type as the source port — then wire it. If a same-name port of
 *  the needed direction already exists, wire to THAT instead of duplicating.
 *
 *  `fromType` is the xyflow handle type of the DRAG ORIGIN: 'source' means the
 *  drag began on an output (so the target needs an INPUT); 'target' means it
 *  began on an input (so the target needs an OUTPUT).
 *
 *  No-ops when: the target is the source node (self-drop); the source port
 *  can't be found; or the needed direction is forbidden for the target kind
 *  (an input node has no inputs, an output node has no outputs). Immutable. */
export function applyDropConnect(
  doc: PflowDocument,
  fromNodeId: string,
  fromPortId: string,
  fromType: "source" | "target",
  toNodeId: string,
): PflowDocument {
  if (fromNodeId === toNodeId) return doc; // self-drop
  const fromNode = doc.nodes.find((n) => n.id === fromNodeId);
  const toNode = doc.nodes.find((n) => n.id === toNodeId);
  if (!fromNode || !toNode) return doc;

  // The source port lives on the side matching the drag origin: a drag from an
  // output ('source') starts on fromNode.outputs; from an input on fromNode.inputs.
  const fromSidePorts = fromType === "source" ? fromNode.outputs : fromNode.inputs;
  const srcPort = fromSidePorts.find((p) => p.id === fromPortId);
  if (!srcPort) return doc;

  // The target needs the OPPOSITE direction: output-origin → target input; etc.
  const targetDir: PortDir = fromType === "source" ? "in" : "out";
  if (targetDir === "in" && toNode.kind === "input") return doc; // input node has no inputs
  if (targetDir === "out" && toNode.kind === "output") return doc; // output node has no outputs

  // Reuse an existing same-name port of the needed direction; else create one
  // carrying the source port's type.
  const targetList = targetDir === "in" ? toNode.inputs : toNode.outputs;
  const existing = targetList.find((p) => p.name === srcPort.name);
  const targetType: TokenType = schemaTypeToTokenType(srcPort.schema.type);
  const withPort = existing
    ? doc
    : applyAddPort(doc, toNodeId, targetDir, srcPort.name, targetType);
  const targetPortId = existing ? existing.id : `${targetDir}:${srcPort.name}`;

  // Wire from output → input regardless of which end the drag started on.
  return fromType === "source"
    ? applyAddWire(withPort, { nodeId: fromNodeId, portId: fromPortId }, { nodeId: toNodeId, portId: targetPortId })
    : applyAddWire(withPort, { nodeId: toNodeId, portId: targetPortId }, { nodeId: fromNodeId, portId: fromPortId });
}

/** Inverse of portSchemaTypeForToken: a port's schema.type → the token type the
 *  port editor uses (object→json, array→table, everything else→string). */
function schemaTypeToTokenType(type: string): TokenType {
  if (type === "object") return "json";
  if (type === "array") return "table";
  return "string";
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
  const next: PflowDocument = {
    ...doc,
    nodes: [...doc.nodes, node],
    editor: { ...editor, nodePositions: [...editor.nodePositions, { nodeId: id, x, y }] },
  };
  // An eval node arrives usable: pre-fill the default mode's template and derive
  // its pass/fail + candidate ports. Routed through DEFAULT_EVAL_MODE so
  // eval-templates.ts stays the single source of truth for the default.
  if (kind === "eval") return applyEvalMode(next, id, DEFAULT_EVAL_MODE);
  return next;
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

/** Set (or clear) an mcp node's bound server (config.mcpServer). An empty
 *  `server` removes the key rather than persisting "". Changing the server also
 *  drops any contract state — a contract is meaningful only on vault-memory,
 *  and stale snapshots must not survive a rebind. Immutable. */
export function applyMcpServer(doc: PflowDocument, nodeId: string, server: string): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const { mcpServer: _omit, contract: _c, contractSnapshot: _cs, contractInputs: _ci, ...rest } = n.config ?? {};
      return { ...n, config: server ? { ...rest, mcpServer: server } : rest };
    }),
  };
}

/** vault-memory contracts known to the probed registry: its vm_* dynamic tools,
 *  prefix stripped (slug form, e.g. "meeting_prep"). The slug is a valid
 *  describe_contract lookup. Sorted. Pure. */
export function contractsFromRegistry(registry: McpRegistry): string[] {
  const tools = registry[VAULT_MEMORY_SERVER]?.tools ?? {};
  return Object.keys(tools)
    .filter((t) => t.startsWith("vm_"))
    .map((t) => t.slice("vm_".length))
    .filter((n) => n.length > 0)
    .sort();
}

/** Ports regenerated from a contract snapshot. An input pinned in
 *  `pins` renders/validates as optional (the pin satisfies it); output ports
 *  carry their projection path for codegen. Pure. */
export function portsFromContractSnapshot(
  snapshot: ContractSnapshot,
  pins: Record<string, unknown>,
): { inputs: Port[]; outputs: Port[] } {
  const pinned = (name: string) => Object.prototype.hasOwnProperty.call(pins, name);
  const inputs: Port[] = snapshot.inputs.map((d) => ({
    id: `in:${d.name}`,
    name: d.name,
    schema: d.schema,
    required: d.required && !pinned(d.name),
  }));
  const outputs: Port[] = snapshot.outputs.map((d) => ({
    id: `out:${d.name}`,
    name: d.name,
    schema: d.schema,
    projection: d.projection,
  }));
  return { inputs, outputs };
}

/** Select a contract on a vault-memory mcp node: stamp `config.contract` (the
 *  CANONICAL name from describe_contract) + `config.contractSnapshot`,
 *  regenerate ports from the snapshot, prune pins of inputs the contract no
 *  longer has, and drop wires whose port vanished. Immutable. */
export function applyContract(
  doc: PflowDocument,
  nodeId: string,
  contract: string,
  snapshot: ContractSnapshot,
): PflowDocument {
  const target = doc.nodes.find((n) => n.id === nodeId);
  if (!target) return doc;
  const inputNames = new Set(snapshot.inputs.map((d) => d.name));
  const prevPins = (target.config?.contractInputs ?? {}) as Record<string, unknown>;
  const pins = Object.fromEntries(Object.entries(prevPins).filter(([k]) => inputNames.has(k)));
  const { inputs, outputs } = portsFromContractSnapshot(snapshot, pins);
  const inIds = new Set(inputs.map((p) => p.id));
  const outIds = new Set(outputs.map((p) => p.id));
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId
        ? { ...n, inputs, outputs, config: { ...n.config, contract, contractSnapshot: snapshot, contractInputs: pins } }
        : n,
    ),
    wires: doc.wires.filter((w) => {
      if (w.to.nodeId === nodeId && !inIds.has(w.to.portId)) return false;
      if (w.from.nodeId === nodeId && !outIds.has(w.from.portId)) return false;
      return true;
    }),
  };
}

/** Pin a literal into `config.contractInputs[name]` (value !== undefined) or
 *  clear the pin (undefined). The same-named port's `required` flag follows:
 *  pinned → satisfied (false); unpinned → back to the snapshot's flag.
 *  Immutable. */
export function applyPinContractInput(
  doc: PflowDocument,
  nodeId: string,
  name: string,
  value: unknown,
): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const pins = { ...((n.config?.contractInputs ?? {}) as Record<string, unknown>) };
      if (value === undefined) delete pins[name];
      else pins[name] = value;
      const def = contractSnapshotOf(n)?.inputs.find((d) => d.name === name);
      const inputs = n.inputs.map((p) =>
        p.name === name && def !== undefined
          ? { ...p, required: def.required && !Object.prototype.hasOwnProperty.call(pins, name) }
          : p,
      );
      return { ...n, inputs, config: { ...n.config, contractInputs: pins } };
    }),
  };
}

/** Switch an eval node's mode: replace its prompt with the mode's template and
 *  re-derive ports from the template's tokens (same mechanism as a prompt edit).
 *  Also records `config.mode`. The caller confirms an overwrite of a non-empty
 *  prompt before calling this. */
export function applyEvalMode(doc: PflowDocument, nodeId: string, mode: EvalMode): PflowDocument {
  const withPromptAndPorts = applyPromptAndDerivePorts(doc, nodeId, templateForMode(mode));
  return {
    ...withPromptAndPorts,
    nodes: withPromptAndPorts.nodes.map((n) =>
      n.id === nodeId ? { ...n, config: { ...n.config, mode } } : n,
    ),
  };
}

/** Record an eval node's mode WITHOUT changing its prompt (used when the user
 *  declines the template-overwrite confirm). The resulting prompt/mode mismatch
 *  is flagged later by the deferred check-workflow lint. */
export function applyEvalModeFlagOnly(doc: PflowDocument, nodeId: string, mode: EvalMode): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId ? { ...n, config: { ...n.config, mode } } : n,
    ),
  };
}

/** Toggle an eval node's hard quality gate (throw on a `fail` verdict). */
export function applyBlockOnFail(doc: PflowDocument, nodeId: string, value: boolean): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) =>
      n.id === nodeId ? { ...n, config: { ...n.config, blockOnFail: value } } : n,
    ),
  };
}

/** A one-line grant summary for a server against the registry (for the inspector). */
export function grantSummary(registry: McpRegistry, server: string): string {
  const reg = registry[server];
  if (!reg) return "not whitelisted in this vault";
  if (reg.probe.status !== "hot") return `${reg.probe.status}${reg.probe.error ? `: ${reg.probe.error}` : ""}`;
  const g = resolveServerGrants(reg);
  return `${Object.keys(reg.tools).length} tools — ${g.allow.length} always · ${g.ask.length} ask · ${g.blocked.length} blocked`;
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

/** Stamp each mcp node's config.expectedGrants with the snapshot of its server's
 *  current per-tool permission (the import-warning compares against this). Only
 *  stamps a node whose bound server is hot in the registry. Immutable. */
export function applyMcpExpectedGrants(doc: PflowDocument, registry: McpRegistry): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.kind !== "mcp") return n;
      const server = n.config?.mcpServer as string | undefined;
      const reg = server ? registry[server] : undefined;
      if (!reg || reg.probe.status !== "hot") return n;
      return { ...n, config: { ...(n.config ?? {}), expectedGrants: snapshotGrants(reg) } };
    }),
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
