import type { PflowDocument, PflowNode } from "../pflow/schema.js";
import { parsePromptTokens, type TokenType } from "../pflow/tokens.js";
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
import type { McpRegistryServer } from "../pflow/mcp-registry.js";
import { resolveServerGrants } from "../pflow/mcp-registry.js";

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
  if (src.kind === "input") {
    const port = src.outputs.find((p) => p.id === wire.from.portId);
    const argName = port?.name ?? wire.from.portId;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(argName) ? `args.${argName}` : `args[${jsString(argName)}]`;
  }
  // Multi-output agent: a wire from out:NAME reads the per-output parsed var
  // <var>__<NAME>, not the bare result var. Single-output agents are unchanged.
  const outToks = parsePromptTokens(src.prompt ?? "").outputs;
  if (src.kind === "agent" && outToks.length >= 2 && wire.from.portId.startsWith("out:")) {
    const name = wire.from.portId.slice("out:".length);
    if (outToks.some((t) => t.name === name)) return `${varName(doc, src)}__${name}`;
  }
  return varName(doc, src);
}

/** The output tokens of an agent that uses the multi-output protocol (2+), or an
 *  empty array otherwise. */
function multiOutputTokens(node: PflowNode): { name: string; type: TokenType }[] {
  if (node.kind !== "agent") return [];
  const outs = parsePromptTokens(node.prompt ?? "").outputs;
  return outs.length >= 2 ? outs : [];
}

/** The delimiter instruction appended to a multi-output agent's prompt, telling
 *  it to wrap each named output so the generated parse can split them apart. The
 *  per-output type adds a "as JSON"/"as a Markdown table" nudge. */
function multiOutputInstruction(outs: { name: string; type: TokenType }[]): string {
  const lines = outs.map((o) => {
    const hint = o.type === "json" ? " (valid JSON)" : o.type === "table" ? " (a Markdown table)" : "";
    return `<<<out:${o.name}>>>\n<the ${o.name}${hint}>\n<<<end>>>`;
  });
  return `Return EACH output wrapped EXACTLY as shown, with nothing outside the blocks:\n${lines.join("\n")}`;
}

/** Parse lines for a multi-output agent: one `const <var>__<NAME> = …` per
 *  output, splitting the result on the delimiters. A missing section → "". Pure
 *  string ops (split/trim) — passes emit-lint. */
function multiOutputParse(varBase: string, outs: { name: string }[]): string {
  return outs
    .map((o) => {
      const sec = `String(${varBase}).split("<<<out:${o.name}>>>")[1] ?? ""`;
      return `  const ${varBase}__${o.name} = (${sec}).split("<<<end>>>")[0].trim();`;
    })
    .join("\n");
}

/** Build the `await agent(...)` expression (no `const X =` prefix) for a node,
 *  weaving each WIRED input as a labelled `<context name="…">` block in declared
 *  port order. `extraInstruction`, when given, is appended to the prompt before
 *  the context blocks — verify/branch use it to request a sentinel line.
 *  `portOverrides` maps an input portId to a JS expression that REPLACES the
 *  wire's normal source — used by branch reconvergence, where a downstream
 *  consumer must read the branch's unified result variable rather than an
 *  arm-local variable that exists in only one arm. Deterministic. */
/** Deterministic helper, emitted into a generated script when any prompt uses a
 *  `:table` token. Renders an array of row objects (or array-of-arrays) as a
 *  GitHub-flavoured Markdown table; falls back to pretty JSON for non-tabular
 *  values. Pure string ops only — passes emit-lint (no banned tokens). */
export const TO_MARKDOWN_TABLE_HELPER = [
  "function toMarkdownTable(value) {",
  "  if (!Array.isArray(value) || value.length === 0) return JSON.stringify(value, null, 2);",
  "  const rows = value.map((r) => (Array.isArray(r) ? r : r && typeof r === \"object\" ? r : [r]));",
  "  const cols = Array.isArray(rows[0])",
  "    ? rows[0].map((_, i) => String(i))",
  "    : Array.from(new Set(rows.flatMap((r) => Object.keys(r))));",
  "  const cell = (r, c) => String((Array.isArray(r) ? r[Number(c)] : r[c]) ?? \"\");",
  "  const header = `| ${cols.join(\" | \")} |`;",
  "  const sep = `| ${cols.map(() => \"---\").join(\" | \")} |`;",
  "  const body = rows.map((r) => `| ${cols.map((c) => cell(r, c)).join(\" | \")} |`).join(\"\\n\");",
  "  return [header, sep, body].join(\"\\n\");",
  "}",
].join("\n");

/** Does any node's prompt declare a `:table` token (in or out)? Drives whether
 *  the toMarkdownTable helper prelude is emitted. */
function usesTableToken(doc: PflowDocument): boolean {
  for (const n of doc.nodes) {
    const t = parsePromptTokens(n.prompt ?? "");
    if ([...t.inputs, ...t.outputs].some((tok) => tok.type === "table")) return true;
  }
  return false;
}

/** Wrap a source expression for a token's declared type so the LLM sees a useful
 *  serialization: string → as-is; json → pretty JSON; table → a Markdown table
 *  (via the toMarkdownTable helper emitted into the script when any table token
 *  is used). */
export function typedSourceExpr(expr: string, type: TokenType): string {
  if (type === "json") return `JSON.stringify(${expr}, null, 2)`;
  if (type === "table") return `toMarkdownTable(${expr})`;
  return expr;
}

/** The source expression feeding a node's input port by NAME (the wired source,
 *  or an empty-string literal when unwired). Used for inline token replacement. */
function tokenInputSource(doc: PflowDocument, node: PflowNode, name: string): string {
  const port = node.inputs.find((p) => p.id === `in:${name}`);
  if (!port) return '""';
  const wire = inWires(doc, node.id).find((w) => w.to.portId === port.id);
  if (!wire) return '""';
  return sourceExpr(doc, wire);
}

/** NUL-delimited sentinel for inline token interpolation. NUL can't occur in a
 *  user prompt and passes through escapeTemplate untouched, so we swap each token
 *  for a sentinel, escape the literal text, then substitute `${expr}` back in —
 *  guaranteeing the interpolation lands exactly where the token was. */
function tokenSentinel(i: number): string {
  return ` ${i} `;
}

/** The MCP-qualified tool id Claude Code uses for permission lists. */
function mcpToolId(server: string, tool: string): string {
  return `mcp__${server}__${tool}`;
}

/** Generate the `.claude/agents/<name>.md` content for an MCP node: a subagent
 *  granted exactly `server`, with allow/disallow tool lists derived from the
 *  registry (allow → allowedTools; blocked → disallowedTools; ask → neither, so
 *  it prompts at run time). Deterministic. */
export function mcpSubagentMarkdown(
  name: string,
  server: string,
  serverReg: McpRegistryServer,
  description: string,
): string {
  const g = resolveServerGrants(serverReg);
  const allow = g.allow.map((t) => mcpToolId(server, t));
  const disallow = g.blocked.map((t) => mcpToolId(server, t));
  const lines: string[] = ["---", `name: ${name}`, `description: ${JSON.stringify(description)}`, "mcpServers:", `  - ${JSON.stringify(server)}`];
  if (allow.length) { lines.push("allowedTools:"); for (const t of allow) lines.push(`  - ${t}`); }
  if (disallow.length) { lines.push("disallowedTools:"); for (const t of disallow) lines.push(`  - ${t}`); }
  lines.push("---", "", `You may use the **${server}** MCP server to accomplish this step. ` +
    `Use only the tools you are permitted; tools marked ask will prompt for approval.`, "");
  return lines.join("\n");
}

export function buildAgentCall(
  doc: PflowDocument,
  node: PflowNode,
  extraInstruction?: string,
  portOverrides?: Map<string, string>,
): string {
  const label = jsString(node.label);
  const base = (node.prompt ?? node.label) + (extraInstruction ? `\n\n${extraInstruction}` : "");

  // ── Inline token replacement ─────────────────────────────────────────────
  // Each {{in:NAME(:TYPE)?}} in the prompt is replaced in place by the typed
  // wired source. Replaced ports are "consumed" so they are NOT also appended as
  // context blocks below.
  const tokens = parsePromptTokens(node.prompt ?? "");
  const consumed = new Set<string>();
  const substitutions: string[] = []; // index → JS expression for ${...}
  let rewritten = base;
  for (const tok of tokens.inputs) {
    const portId = `in:${tok.name}`;
    consumed.add(portId);
    // A reconvergence override (e.g. a branch result var) takes precedence over
    // the wire's normal source — the same precedence the context-block path uses
    // — so a token feeding a node downstream of a branch reads the unified result
    // var, not an arm-local var that exists in only one arm.
    const override = portOverrides?.get(portId);
    const rawSource = override ?? tokenInputSource(doc, node, tok.name);
    const expr = typedSourceExpr(rawSource, tok.type);
    const sentinel = tokenSentinel(substitutions.length);
    // Replace EVERY occurrence of this exact token spelling (with and without an
    // explicit type suffix — the parser already normalized the name).
    const variants = [`{{in:${tok.name}}}`, `{{in:${tok.name}:${tok.type}}}`];
    for (const v of variants) rewritten = rewritten.split(v).join(sentinel);
    substitutions.push(expr);
  }
  // Output tokens NAME a result in place: each {{out:NAME(:TYPE)?}} is replaced
  // by the bare NAME wherever it appears, so the prose reads naturally ("...as
  // draft...") and the output's name stays visible to the LLM. Multiple
  // occurrences of the same out-token all render as the same NAME and map to the
  // single out-port NAME (no port multiplication). The multi-output delimiter
  // protocol (2+ distinct out-ports) is added separately as an instruction.
  for (const tok of tokens.outputs) {
    for (const v of [`{{out:${tok.name}}}`, `{{out:${tok.name}:${tok.type}}}`]) {
      rewritten = rewritten.split(v).join(tok.name);
    }
  }

  const hasTokens = substitutions.length > 0;

  const incoming = inWires(doc, node.id);
  const blocks: string[] = [];
  for (const port of node.inputs) {
    if (consumed.has(port.id)) continue; // interpolated inline already
    const override = portOverrides?.get(port.id);
    if (override) {
      blocks.push(`\n\n<context name="${port.name}">\n\${${override}}\n</context>`);
      continue;
    }
    const wire = incoming.find((w) => w.to.portId === port.id);
    if (!wire) continue;
    const src = nodeById(doc, wire.from.nodeId);
    if (!src) continue;
    const srcVar = sourceExpr(doc, wire);
    blocks.push(`\n\n<context name="${port.name}">\n\${${srcVar}}\n</context>`);
  }

  if (blocks.length === 0 && !extraInstruction && !hasTokens) {
    // No interpolation needed (no wired input tokens, no context blocks, no extra
    // instruction). Emit a plain string literal — but use `rewritten`, which has
    // any {{out:NAME}} tokens replaced by their bare names, not the raw base.
    return `await agent(${jsString(rewritten)}, { label: ${label} })`;
  }
  // Escape the literal text (sentinels survive), then substitute each sentinel
  // with its `${expr}` interpolation.
  let body = escapeTemplate(rewritten);
  for (let i = 0; i < substitutions.length; i++) {
    body = body.split(tokenSentinel(i)).join("${" + substitutions[i] + "}");
  }
  const tmpl = "`" + body + blocks.join("") + "`";
  return `await agent(${tmpl}, { label: ${label} })`;
}

/** The unified result variable for a branch: every arm assigns it, and
 *  reconvergent downstream consumers read it. Distinct from the branch's own
 *  choice variable (varName), which holds the BRANCH: <label> verdict. */
export function branchResultVar(doc: PflowDocument, branch: PflowNode): string {
  return `${varName(doc, branch)}_result`;
}

/** The source variable feeding a node's single input (linear subset). An
 *  `overrides` map (portId → expression) lets a reconvergent output node read a
 *  branch result variable instead of an arm-local var. */
function inputVar(doc: PflowDocument, node: PflowNode, overrides?: Map<string, string>): string {
  const wires = inWires(doc, node.id);
  if (wires.length === 0) return "args";
  const override = overrides?.get(wires[0].to.portId);
  if (override) return override;
  const src = nodeById(doc, wires[0].from.nodeId)!;
  if (src.kind === "input") return "args";
  // Delegate to sourceExpr so a wire from a multi-output agent's out:NAME reads
  // the per-output parsed var (<var>__NAME) rather than the bare result var.
  return sourceExpr(doc, wires[0]);
}

function emitNode(doc: PflowDocument, node: PflowNode, overrides?: Map<string, string>): string {
  switch (node.kind) {
    case "input":
      return "";
    case "agent": {
      const v = varName(doc, node);
      const outs = multiOutputTokens(node);
      if (outs.length >= 2) {
        // 2+ named outputs: instruct the agent to delimit each, then parse the
        // single result into per-output vars that downstream wires read.
        const call = buildAgentCall(doc, node, multiOutputInstruction(outs), overrides);
        return `  const ${v} = ${call};\n${multiOutputParse(v, outs)}`;
      }
      return `  const ${v} = ${buildAgentCall(doc, node, undefined, overrides)};`;
    }
    case "output": {
      const v = inputVar(doc, node, overrides);
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

  // Reconvergence overrides: a node downstream of a branch that consumes an arm
  // value reads the branch's unified result variable, not an arm-local var.
  // Keyed by consumer nodeId → (portId → branch result var expression).
  const overridesByNode = new Map<string, Map<string, string>>();
  for (const r of regions) {
    if (r.kind !== "branch") continue;
    const resultVar = branchResultVar(doc, nodeById(doc, r.entryId)!);
    for (const rc of r.reconverges) {
      let m = overridesByNode.get(rc.nodeId);
      if (!m) {
        m = new Map();
        overridesByNode.set(rc.nodeId, m);
      }
      m.set(rc.portId, resultVar);
    }
  }

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
    const piece = emitNode(doc, nodeById(doc, id)!, overridesByNode.get(id));
    if (piece.length > 0) lines.push(piece);
  }
  const body = lines.join("\n");
  // Emit the Markdown-table helper once, before the body, when any table token
  // is used (its calls appear inside agent prompt interpolations). When NO table
  // token is present, the output is byte-identical to the pre-token codegen.
  const parts = [header, "", renderMeta(doc)];
  if (usesTableToken(doc)) parts.push("", TO_MARKDOWN_TABLE_HELPER);
  parts.push("", body, "");
  const code = parts.join("\n");

  const lint = lintEmittedScript(code);
  if (!lint.ok) {
    const msg = lint.violations.map((v) => `  - banned token "${v.token}" at index ${v.index}`).join("\n");
    throw new Error(`emit-lint failed (non-deterministic or sandbox-illegal output):\n${msg}`);
  }
  return code;
}
