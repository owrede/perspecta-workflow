import type { PflowDocument, PflowNode } from "../pflow/schema.js";
import { nodeById, inWires } from "../pflow/topo.js";
import { parsePromptTokens } from "../pflow/tokens.js";
import { analyzeRegions } from "../pflow/regions.js";
import { nodeContractMode, vmToolName } from "../pflow/contract.js";
import { varName, sourceExpr, mcpAgentTypeName } from "./scriptgen.js";

/** Severity of a fidelity check finding. `error` = the emitted script does not
 *  faithfully realise the design and a downstream run would misbehave; `warn` =
 *  a likely-but-not-certain divergence worth a human glance. */
export type CheckSeverity = "error" | "warn";

/** One finding from the fidelity checker: a named check that failed, the node it
 *  concerns (when applicable), and a human-readable explanation. */
export interface CheckFinding {
  check: string;
  severity: CheckSeverity;
  message: string;
  nodeId?: string;
}

export interface CheckReport {
  ok: boolean; // no `error`-severity findings
  findings: CheckFinding[];
}

/** A single fidelity property: given the parsed doc and the emitted script,
 *  push any findings. Pure — no I/O, deterministic. */
type CheckFn = (doc: PflowDocument, code: string, push: (f: CheckFinding) => void) => void;

/** Regex-escape a string so it can be embedded as a literal in a RegExp. */
function reEsc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True if `code` declares the identifier `name` as a binding (const/let) OR a
 *  loop-carried `let name = ""` initializer. Word-boundary anchored so
 *  `foo_1` does not match `foo_10`. */
function declaresVar(code: string, name: string): boolean {
  const re = new RegExp(`\\b(?:const|let)\\s+${reEsc(name)}\\b`);
  return re.test(code);
}

/** True if `code` references the identifier `name` anywhere (declaration or use). */
function mentionsVar(code: string, name: string): boolean {
  return new RegExp(`\\b${reEsc(name)}\\b`).test(code);
}

/** The kinds that MUST emit at least one `await agent(` / `pipeline(` call. */
const AGENTIC_KINDS = new Set<PflowNode["kind"]>([
  "agent",
  "mcp",
  "verify",
  "synthesize",
  "branch",
  "eval",
  "split",
  "loop",
]);

// ── Individual checks ───────────────────────────────────────────────────────

/** Every agentic node declares its output variable. The codegen names the var
 *  via `varName(doc, node)`; assert that exact identifier is bound. Catches a
 *  node silently dropped from the emit (region mis-analysis, topo gap). */
const checkAgenticNodesEmitVar: CheckFn = (doc, code, push) => {
  for (const node of doc.nodes) {
    if (!AGENTIC_KINDS.has(node.kind)) continue;
    const v = varName(doc, node);
    if (!declaresVar(code, v)) {
      push({
        check: "node-emits-variable",
        severity: "error",
        nodeId: node.id,
        message: `${node.kind} node "${node.id}" should bind variable "${v}" but it is not declared in the emitted script`,
      });
    }
  }
};

/** Every node label appears as an `agent(... { label: "<label>" })` for the
 *  agentic kinds that always carry a label. A missing label means the node's
 *  prompt was not emitted into a call (or the label drifted). */
const checkNodeLabelsPresent: CheckFn = (doc, code, push) => {
  for (const node of doc.nodes) {
    if (node.kind !== "agent" && node.kind !== "mcp" && node.kind !== "verify" && node.kind !== "synthesize") continue;
    if (!node.label) continue;
    const re = new RegExp(`label:\\s*${reEsc(JSON.stringify(node.label))}`);
    if (!re.test(code)) {
      push({
        check: "node-label-present",
        severity: "warn",
        nodeId: node.id,
        message: `node "${node.id}" label ${JSON.stringify(node.label)} does not appear as an agent() label in the emitted script`,
      });
    }
  }
};

/** Every wire's data dependency survives: the downstream node's emitted code (or
 *  the script as a whole) references the source's value expression. We check the
 *  whole script — the consumer may read the source via args.<x>, a var, a
 *  projection, or a context block — but the *expression* must appear, otherwise
 *  the wire is a dropped dependency. Input-node sources (args.*) and contract
 *  projections are resolved exactly as codegen does. */
const checkWiresRealized: CheckFn = (doc, code, push) => {
  for (const wire of doc.wires) {
    const src = nodeById(doc, wire.from.nodeId);
    const dst = nodeById(doc, wire.to.nodeId);
    if (!src || !dst) continue; // structural validation owns missing-node
    const expr = sourceExpr(doc, wire);
    const isPlainIdent = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(expr);
    const present = isPlainIdent ? mentionsVar(code, expr) : code.includes(expr);
    if (!present) {
      push({
        check: "wire-realized",
        severity: "error",
        nodeId: dst.id,
        message: `wire ${wire.from.nodeId}.${wire.from.portId} -> ${wire.to.nodeId}.${wire.to.portId} should surface source expression "${expr}" downstream, but it never appears in the emitted script`,
      });
    }
  }
};

/** An `output` node emits a `return` of its wired source expression. */
const checkOutputReturns: CheckFn = (doc, code, push) => {
  for (const node of doc.nodes) {
    if (node.kind !== "output") continue;
    const wire = inWires(doc, node.id)[0];
    if (!wire) continue; // required-input-unwired owns the missing wire
    const expr = sourceExpr(doc, wire);
    if (!code.includes(`return ${expr}`)) {
      push({
        check: "output-returns",
        severity: "error",
        nodeId: node.id,
        message: `output node "${node.id}" should emit "return ${expr}" but no matching return statement was found`,
      });
    }
  }
};

/** An `eval` node with config.blockOnFail emits a hard gate: a `throw` guarded by
 *  an EVAL fail test. Without it, a failing quality gate would NOT abort the run
 *  — a silent semantic regression. */
const checkEvalBlockOnFail: CheckFn = (doc, code, push) => {
  for (const node of doc.nodes) {
    if (node.kind !== "eval") continue;
    if (node.config?.blockOnFail !== true) continue;
    const hasThrow = /throw new Error\([^)]*Quality gate failed/.test(code);
    if (!hasThrow) {
      push({
        check: "eval-block-on-fail",
        severity: "error",
        nodeId: node.id,
        message: `eval node "${node.id}" has blockOnFail set but the emitted script contains no throwing quality gate (Quality gate failed)`,
      });
    }
  }
};

/** Every eval/verify node emits a verdict-line instruction in its prompt, so the
 *  judge actually produces the sentinel the downstream dispatch/log relies on. */
const checkVerdictInstruction: CheckFn = (doc, code, push) => {
  const wantsEval = doc.nodes.some((n) => n.kind === "eval");
  const wantsVerify = doc.nodes.some((n) => n.kind === "verify");
  if (wantsEval && !/EVAL:\s*pass/.test(code)) {
    push({ check: "verdict-instruction", severity: "error", message: "an eval node exists but the emitted script never instructs an EVAL: pass/fail verdict line" });
  }
  if (wantsVerify && !/VERIFY:\s*pass/.test(code)) {
    push({ check: "verdict-instruction", severity: "error", message: "a verify node exists but the emitted script never instructs a VERIFY: pass/fail verdict line" });
  }
};

/** A `branch` node dispatches over each of its arm labels: one
 *  `/BRANCH:\s*<label>/i.test(...)` per outgoing labelled path. A missing arm
 *  means that design path can never be taken. */
const checkBranchArms: CheckFn = (doc, code, push) => {
  const { regions } = analyzeRegions(doc);
  for (const r of regions) {
    if (r.kind !== "branch") continue;
    if (r.verb !== "BRANCH") continue; // EVAL arms checked separately
    for (const path of r.paths) {
      // The emitter writes the literal source text `/BRANCH:\s*<label>/i.test(`,
      // so we match the literal `BRANCH:\s*<label>` (backslash-s) in `code`.
      const needle = `BRANCH:\\s*${path.label}`;
      if (!code.includes(needle)) {
        push({
          check: "branch-arm-present",
          severity: "error",
          nodeId: r.entryId,
          message: `branch node "${r.entryId}" path "${path.label}" has no matching dispatch arm in the emitted script`,
        });
      }
    }
  }
};

/** An arm member fed FROM a branch/eval output port must receive real data, not
 *  the gate's verdict string. The branch agent's variable holds only its routing
 *  line ("BRANCH: long"); a node wired off the `long` port and expecting the
 *  value that flowed THROUGH the gate (e.g. a Condense step expecting the draft)
 *  will instead interpolate the verdict — its purpose silently breaks.
 *
 *  Detect: a wire whose source is a branch/eval node's labelled output port and
 *  whose target is one of that branch's arm members. codegen currently resolves
 *  such a wire to the branch's own var (the verdict), which is never the intended
 *  data. (Reconvergent consumers OUTSIDE the arms are handled correctly via the
 *  hoisted result var, so we only flag intra-arm consumers.) */
const checkBranchArmInputData: CheckFn = (doc, code, push) => {
  const { regions } = analyzeRegions(doc);
  for (const r of regions) {
    if (r.kind !== "branch") continue;
    const branch = nodeById(doc, r.entryId)!;
    const verdictVar = varName(doc, branch);
    const armMembers = new Set(r.paths.flatMap((p) => p.memberIds));
    for (const w of doc.wires) {
      if (w.from.nodeId !== branch.id) continue; // from a branch OUTPUT port
      if (!armMembers.has(w.to.nodeId)) continue; // into one of its own arms
      // The wire resolves (in codegen) to the branch's verdict var — a routing
      // token, not data. That is the defect.
      const expr = sourceExpr(doc, w);
      if (expr === verdictVar) {
        push({
          check: "branch-arm-input-data",
          severity: "error",
          nodeId: w.to.nodeId,
          message: `node "${w.to.nodeId}" reads branch "${branch.id}"'s output port "${w.from.portId}", but codegen feeds it the branch's verdict variable "${verdictVar}" (a "BRANCH: <label>" routing line) instead of the data that flowed through the gate. The condense/transform step on this arm has no real input to work on.`,
        });
      }
    }
  }
};

/** A split/join region emits a `pipeline(` whose first argument is the split's
 *  array source expression, and one stage per member. */
const checkSplitPipeline: CheckFn = (doc, code, push) => {
  const { regions } = analyzeRegions(doc);
  for (const r of regions) {
    if (r.kind !== "splitjoin") continue;
    if (!/await pipeline\(/.test(code)) {
      push({ check: "split-pipeline", severity: "error", nodeId: r.entryId, message: `split node "${r.entryId}" should emit an await pipeline(...) but none was found` });
      continue;
    }
    const split = nodeById(doc, r.entryId)!;
    const inWire = inWires(doc, split.id)[0];
    if (inWire) {
      const arrExpr = sourceExpr(doc, inWire);
      if (!code.includes(arrExpr)) {
        push({ check: "split-pipeline", severity: "error", nodeId: r.entryId, message: `split node "${r.entryId}" array source "${arrExpr}" does not feed the emitted pipeline()` });
      }
    }
  }
};

/** A `loop` region emits a bounded `for` loop with the node's maxPasses and a
 *  break guarded by its sentinel. */
const checkLoopBounds: CheckFn = (doc, code, push) => {
  const { regions } = analyzeRegions(doc);
  for (const r of regions) {
    if (r.kind !== "loop") continue;
    const loopNode = nodeById(doc, r.entryId)!;
    const maxPasses = Number((loopNode.config?.maxPasses as number | undefined) ?? 3);
    const reFor = new RegExp(`for \\(let pass = 0; pass < ${maxPasses};`);
    if (!reFor.test(code)) {
      push({ check: "loop-bounded", severity: "error", nodeId: r.entryId, message: `loop node "${r.entryId}" should emit a bounded for-loop with maxPasses ${maxPasses}` });
    }
    if (!/\) break;/.test(code)) {
      push({ check: "loop-bounded", severity: "warn", nodeId: r.entryId, message: `loop node "${r.entryId}": no sentinel-guarded break found; the loop may always run to maxPasses` });
    }
  }
};

/** Each MCP node grants its server via an agentType referencing the generated
 *  subagent name `<workflow>-<nodeId>`. */
const checkMcpAgentType: CheckFn = (doc, code, push) => {
  for (const node of doc.nodes) {
    if (node.kind !== "mcp") continue;
    const name = mcpAgentTypeName(doc, node);
    const re = new RegExp(`agentType:\\s*${reEsc(JSON.stringify(name))}`);
    if (!re.test(code)) {
      push({ check: "mcp-agent-type", severity: "error", nodeId: node.id, message: `mcp node "${node.id}" should pass agentType ${JSON.stringify(name)} but it does not appear in the emitted script` });
    }
  }
};

/** A contract-mode (vault-memory) MCP node instructs the LLM to call its
 *  vm_<contract> tool by name. */
const checkContractToolCall: CheckFn = (doc, code, push) => {
  for (const node of doc.nodes) {
    if (node.kind !== "mcp") continue;
    const contract = nodeContractMode(node);
    if (contract === undefined) continue;
    const tool = vmToolName(contract);
    if (!code.includes(tool)) {
      push({ check: "contract-tool-call", severity: "error", nodeId: node.id, message: `memory node "${node.id}" (contract "${contract}") should instruct a call to "${tool}" but that tool name is absent from the emitted script` });
    }
  }
};

/** Typed prompt tokens are serialized correctly: `:json` => JSON.stringify,
 *  `:table` => toMarkdownTable. A token that loses its serializer would feed the
 *  LLM "[object Object]" instead of the intended JSON/table. */
const checkTypedTokens: CheckFn = (doc, code, push) => {
  let wantsJson = false;
  let wantsTable = false;
  for (const node of doc.nodes) {
    const toks = parsePromptTokens(node.prompt ?? "");
    for (const t of [...toks.inputs, ...toks.outputs]) {
      if (t.type === "json") wantsJson = true;
      if (t.type === "table") wantsTable = true;
    }
  }
  if (wantsJson && !/JSON\.stringify\(/.test(code)) {
    push({ check: "typed-token-serializer", severity: "error", message: "a :json prompt token exists but the emitted script contains no JSON.stringify(...) serialization" });
  }
  if (wantsTable && !/toMarkdownTable\(/.test(code)) {
    push({ check: "typed-token-serializer", severity: "error", message: "a :table prompt token exists but the emitted script contains no toMarkdownTable(...) serialization" });
  }
  if (wantsTable && !/function toMarkdownTable\(/.test(code)) {
    push({ check: "typed-token-serializer", severity: "error", message: "a :table token is used but the toMarkdownTable helper is not emitted into the script" });
  }
};

/** meta.phases covers every distinct node phase annotation. */
const checkMetaPhases: CheckFn = (doc, code, push) => {
  const phases: string[] = [];
  for (const n of doc.nodes) if (n.phase && !phases.includes(n.phase)) phases.push(n.phase);
  for (const p of phases) {
    const re = new RegExp(`title:\\s*${reEsc(JSON.stringify(p))}`);
    if (!re.test(code)) {
      push({ check: "meta-phases", severity: "error", message: `node phase ${JSON.stringify(p)} is not declared in meta.phases` });
    }
  }
};

/** No emitted variable is referenced before it is declared (topological
 *  soundness of the linear emit). We find each node var's declaration index and
 *  flag any earlier use. Loop-carried `let x = ""` initializers count as
 *  declarations, so back-edges are not false flags. */
const checkNoForwardRef: CheckFn = (doc, code, push) => {
  for (const node of doc.nodes) {
    if (!AGENTIC_KINDS.has(node.kind)) continue;
    const v = varName(doc, node);
    const declRe = new RegExp(`\\b(?:const|let)\\s+${reEsc(v)}\\b`);
    const declMatch = declRe.exec(code);
    if (!declMatch) continue; // node-emits-variable owns the missing decl
    const declIdx = declMatch.index;
    const useRe = new RegExp(`\\b${reEsc(v)}\\b`, "g");
    let m: RegExpExecArray | null;
    while ((m = useRe.exec(code)) !== null) {
      if (m.index >= declIdx) break;
      push({
        check: "no-forward-ref",
        severity: "error",
        nodeId: node.id,
        message: `variable "${v}" (node "${node.id}") is referenced at index ${m.index}, before its declaration at index ${declIdx}`,
      });
      break;
    }
  }
};

/** The full ordered battery of deterministic fidelity checks. */
const CHECKS: CheckFn[] = [
  checkAgenticNodesEmitVar,
  checkNodeLabelsPresent,
  checkWiresRealized,
  checkOutputReturns,
  checkEvalBlockOnFail,
  checkVerdictInstruction,
  checkBranchArms,
  checkBranchArmInputData,
  checkSplitPipeline,
  checkLoopBounds,
  checkMcpAgentType,
  checkContractToolCall,
  checkTypedTokens,
  checkMetaPhases,
  checkNoForwardRef,
];

/** Run every deterministic fidelity check of the emitted script against the
 *  design it was generated from. Pure: the caller supplies both the parsed doc
 *  and the codegen output, so this never re-runs codegen or touches the disk.
 *
 *  This is the semantic-equivalence layer: schema/validate prove the DOCUMENT is
 *  well-formed and codegen+emit-lint prove the OUTPUT is well-formed; these
 *  checks prove the output is a faithful TRANSLATION of the document. */
export function checkExportFidelity(doc: PflowDocument, code: string): CheckReport {
  const findings: CheckFinding[] = [];
  const push = (f: CheckFinding) => findings.push(f);
  for (const check of CHECKS) check(doc, code, push);
  findings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "error" ? -1 : 1;
    if (a.check !== b.check) return a.check < b.check ? -1 : 1;
    return (a.nodeId ?? "") < (b.nodeId ?? "") ? -1 : 1;
  });
  return { ok: !findings.some((f) => f.severity === "error"), findings };
}

/** The names of every check, for documentation / coverage reporting. */
export const CHECK_NAMES = [
  "node-emits-variable",
  "node-label-present",
  "wire-realized",
  "output-returns",
  "eval-block-on-fail",
  "verdict-instruction",
  "branch-arm-present",
  "branch-arm-input-data",
  "split-pipeline",
  "loop-bounded",
  "mcp-agent-type",
  "contract-tool-call",
  "typed-token-serializer",
  "meta-phases",
  "no-forward-ref",
] as const;
