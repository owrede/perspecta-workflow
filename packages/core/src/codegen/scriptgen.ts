import type { PflowDocument, PflowNode } from "../pflow/schema.js";
import { topoOrder, inWires, nodeById } from "../pflow/topo.js";
import { validatePflow } from "../pflow/validate.js";
import { lintEmittedScript } from "./emit-lint.js";
import { analyzeRegions, type Region, type LoopRegion } from "../pflow/regions.js";
import {
  emitVerify,
  emitSynthesize,
  emitLoopRegion,
  emitSplitJoinRegion,
  emitBranchRegion,
} from "./emit-kinds.js";

/** JSON.stringify yields a spec-compliant double-quoted JS string literal with
 *  correct escaping of quotes, backslashes, and control chars. */
export function jsString(value: string): string {
  return JSON.stringify(value);
}

/** Escape a string for safe inclusion as the LITERAL portion of a template
 *  literal (backticks). Backslashes, backticks, and `${` sequences are escaped
 *  so user text can never break out or introduce an unintended interpolation. */
export function escapeTemplate(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\$\{/g, "\\${");
}

/** Render `export const meta = {...}` as a pure literal. Phases are the
 *  distinct, declaration-ordered `phase` annotations on nodes. */
export function renderMeta(doc: PflowDocument): string {
  const phases: string[] = [];
  for (const n of doc.nodes) {
    if (n.phase && !phases.includes(n.phase)) phases.push(n.phase);
  }
  const phaseLines = phases.map((p) => `    { title: ${jsString(p)} },`).join("\n");
  return [
    "export const meta = {",
    `  name: ${jsString(doc.workflow.name)},`,
    `  description: ${jsString(doc.workflow.description)},`,
    "  phases: [",
    phaseLines,
    "  ],",
    "}",
  ].join("\n");
}

/** A safe, collision-proof JS identifier for a node's output variable. The
 *  node's INDEX in `doc.nodes` (unique by construction) guarantees distinct
 *  identifiers even when two nodes' labels/ids sanitize to the same text. */
export function varName(doc: PflowDocument, node: PflowNode): string {
  const base = (node.label || node.id).replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  const index = doc.nodes.indexOf(node);
  return `${base}_${index}`.replace(/[^A-Za-z0-9_]/g, "_");
}

/** The JS expression that holds the value flowing OUT of a wire's source port.
 *  - input-node source → `args.<argName>` (the specific arg, NOT the whole
 *    `args` object), where argName is the source output port's name. Bracket
 *    notation is used when the name is not a plain JS identifier. The workflow's
 *    args schema carries one property per input-node output port, so this is the
 *    value the caller passed for that arg.
 *  - any other source → that node's output variable. */
export function sourceExpr(doc: PflowDocument, wire: { from: { nodeId: string; portId: string } }): string {
  const src = nodeById(doc, wire.from.nodeId);
  if (!src) return "args";
  if (src.kind !== "input") return varName(doc, src);
  const port = src.outputs.find((p) => p.id === wire.from.portId);
  const argName = port?.name ?? wire.from.portId;
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(argName) ? `args.${argName}` : `args[${jsString(argName)}]`;
}

/** Build the `await agent(...)` expression (no `const X =` prefix) for a node,
 *  weaving each WIRED input as a labelled `<context name="…">` block in declared
 *  port order. `extraInstruction`, when given, is appended to the prompt before
 *  the context blocks — verify/branch use it to request a sentinel line. The
 *  result is deterministic for a given document. */
export function buildAgentCall(doc: PflowDocument, node: PflowNode, extraInstruction?: string): string {
  const label = jsString(node.label);
  const base = (node.prompt ?? node.label) + (extraInstruction ? `\n\n${extraInstruction}` : "");
  const incoming = inWires(doc, node.id);
  const blocks: string[] = [];
  for (const port of node.inputs) {
    const wire = incoming.find((w) => w.to.portId === port.id);
    if (!wire) continue;
    const src = nodeById(doc, wire.from.nodeId);
    if (!src) continue;
    const srcVar = sourceExpr(doc, wire);
    blocks.push(`\n\n<context name="${port.name}">\n\${${srcVar}}\n</context>`);
  }
  if (blocks.length === 0 && !extraInstruction) {
    // No woven dataflow and no extra instruction — keep a plain string literal.
    return `await agent(${jsString(base)}, { label: ${label} })`;
  }
  const tmpl = "`" + escapeTemplate(base) + blocks.join("") + "`";
  return `await agent(${tmpl}, { label: ${label} })`;
}

/** The source variable feeding a node's single input (linear subset). */
function inputVar(doc: PflowDocument, node: PflowNode): string {
  const wires = inWires(doc, node.id);
  if (wires.length === 0) return "args";
  const src = nodeById(doc, wires[0].from.nodeId)!;
  return src.kind === "input" ? "args" : varName(doc, src);
}

function emitNode(doc: PflowDocument, node: PflowNode): string {
  switch (node.kind) {
    case "input":
      return "";
    case "agent": {
      const v = varName(doc, node);
      return `  const ${v} = ${buildAgentCall(doc, node)};`;
    }
    case "output": {
      const v = inputVar(doc, node);
      return `  return ${v};`;
    }
    case "verify":
      return emitVerify(doc, node);
    case "synthesize":
      return emitSynthesize(doc, node);
    case "split":
    case "join":
    case "loop":
    case "branch":
      // These are control-flow REGION entries/members: they are emitted by the
      // region pass in generateClaudeCodeWorkflow, not node-by-node. If emitNode
      // is reached for one of these directly (i.e. it was not recognized as a
      // region), the graph is malformed for that kind — fail loudly.
      throw new Error(`scriptgen: node kind "${node.kind}" (node ${node.id}) must be emitted as part of a control-flow region; none was detected (check wiring: split needs a matching join, loop needs a refine back-edge, branch needs labelled paths)`);
    case "script":
      return `  // script node ${node.id}\n${(node.config?.body as string) ?? ""}`;
  }
}

/** emitOne renders a SINGLE node (the non-region path). Used at top level and
 *  passed into region emitters so they can render their member nodes without an
 *  import cycle back into emit-kinds. */
function emitOne(doc: PflowDocument, node: PflowNode): string {
  return emitNode(doc, node);
}

function emitRegion(doc: PflowDocument, region: Region): string {
  if (region.kind === "loop") return emitLoopRegion(doc, region, emitOne);
  if (region.kind === "splitjoin") return emitSplitJoinRegion(doc, region, emitOne);
  return emitBranchRegion(doc, region, emitOne);
}

/** Topo order with loop back-edges removed so the graph is acyclic. Regions
 *  must be computed first to know which wires are back-edges. */
function orderExcludingBackEdges(doc: PflowDocument, regions: Region[]): string[] {
  const backEdges = new Set(
    regions.filter((r): r is LoopRegion => r.kind === "loop").map((r) => r.backEdge),
  );
  if (backEdges.size === 0) return topoOrder(doc);
  const filtered: PflowDocument = { ...doc, wires: doc.wires.filter((w) => !backEdges.has(w)) };
  return topoOrder(filtered);
}

/** Compile a .pflow document to a native Claude Code dynamic-workflow script.
 *  Deterministic: same document -> byte-identical output. Throws if the
 *  document fails validation or the emitted code fails emit-lint. */
export function generateClaudeCodeWorkflow(doc: PflowDocument): string {
  const validation = validatePflow(doc);
  if (!validation.ok) {
    const msg = validation.errors.map((e) => `  - [${e.rule}] ${e.message}`).join("\n");
    throw new Error(`pflow validation failed:\n${msg}`);
  }
  const { regions, absorbed } = analyzeRegions(doc);
  const order = orderExcludingBackEdges(doc, regions);
  const regionByEntry = new Map(regions.map((r) => [r.entryId, r] as const));
  const emittedRegions = new Set<string>();
  const header = `// Generated by Perspecta Workflow from ${doc.workflow.name}.pflow — do not hand-edit.`;

  const lines: string[] = [];
  for (const id of order) {
    const region = regionByEntry.get(id);
    if (region) {
      if (!emittedRegions.has(region.entryId)) {
        lines.push(emitRegion(doc, region));
        emittedRegions.add(region.entryId);
      }
      continue;
    }
    if (absorbed.has(id)) continue; // member of a region — already emitted
    const piece = emitNode(doc, nodeById(doc, id)!);
    if (piece.length > 0) lines.push(piece);
  }
  const body = lines.join("\n");
  const code = [header, "", renderMeta(doc), "", body, ""].join("\n");

  const lint = lintEmittedScript(code);
  if (!lint.ok) {
    const msg = lint.violations.map((v) => `  - banned token "${v.token}" at index ${v.index}`).join("\n");
    throw new Error(`emit-lint failed (non-deterministic or sandbox-illegal output):\n${msg}`);
  }
  return code;
}
