import type { PflowDocument, PflowNode } from "../pflow/schema.js";
import type { LoopRegion, SplitJoinRegion, BranchRegion } from "../pflow/regions.js";
import { nodeById, inWires } from "../pflow/topo.js";
import { varName, buildAgentCall, jsString, escapeTemplate } from "./scriptgen.js";

/** Emit a single node's code. Injected into the region emitters so they can
 *  render their member nodes without importing scriptgen's emitNode (which
 *  would create an import cycle). */
export type EmitOne = (doc: PflowDocument, node: PflowNode) => string;

/** Indent a (possibly multi-line) emitted snippet by one extra level. */
function indent(code: string): string {
  return code
    .split("\n")
    .map((line) => (line.length > 0 ? "  " + line : line))
    .join("\n");
}

/** verify: an agent that emits a pass/fail verdict, logged, NON-blocking. The
 *  checked value flows on (the node's output var === the agent result). Gating
 *  is expressed by wiring verify → branch, not baked in here. */
export function emitVerify(doc: PflowDocument, node: PflowNode): string {
  const v = varName(doc, node);
  const call = buildAgentCall(doc, node, "Emit a verdict line exactly: VERIFY: pass  OR  VERIFY: fail");
  return `  const ${v} = ${call};\n  log(${v});`;
}

/** synthesize: a multi-input agent that merges all wired inputs. buildAgentCall
 *  already weaves every wired input as a labelled context block in declared
 *  order, so this is an agent call that simply expects many inputs. */
export function emitSynthesize(doc: PflowDocument, node: PflowNode): string {
  const v = varName(doc, node);
  return `  const ${v} = ${buildAgentCall(doc, node)};`;
}

/** loop: a bounded for-loop over the span (the member nodes), breaking when the
 *  loop node's result matches the sentinel. maxPasses/sentinel come from the
 *  loop node's config (defaults 3 / ALL_OWNED:\s*yes). */
export function emitLoopRegion(doc: PflowDocument, region: LoopRegion, _emitOne: EmitOne): string {
  const loopNode = nodeById(doc, region.entryId)!;
  const maxPasses = Number((loopNode.config?.maxPasses as number | undefined) ?? 3);
  const sentinel = (loopNode.config?.sentinel as string | undefined) ?? "ALL_OWNED:\\s*yes";

  // Variables that are produced INSIDE the loop but referenced earlier in the
  // SAME iteration (the refine back-edge: the loop node's output feeds an
  // upstream span member's input) must be hoisted to `let` declarations BEFORE
  // the loop and ASSIGNED (not re-declared with `const`) inside it. Otherwise
  // the first reference hits a temporal-dead-zone ReferenceError. Every span
  // member's variable is loop-carried, so we hoist them all and assign inside.
  const memberNodes = region.memberIds.map((id) => nodeById(doc, id)!);
  const declarations = memberNodes
    .map((n) => `  let ${varName(doc, n)};`)
    .join("\n");

  // Each member emits an ASSIGNMENT (var already declared above). The loop node
  // and any agent-like member become `<var> = await agent(...)`; an output
  // member would be unusual inside a loop and is not expected here.
  const body = memberNodes
    .map((n) => `  ${varName(doc, n)} = ${buildAgentCall(doc, n)};`)
    .map((s) => indent(s))
    .join("\n");

  const loopVar = varName(doc, loopNode);
  return [
    declarations,
    `  for (let pass = 0; pass < ${maxPasses}; pass++) {`,
    body,
    `    if (/${sentinel}/i.test(String(${loopVar}))) break;`,
    `  }`,
  ].join("\n");
}

/** split/join: fan out the split's array input through the span as a CC
 *  pipeline (each member agent becomes a stage), collecting into the join's
 *  output variable. */
export function emitSplitJoinRegion(doc: PflowDocument, region: SplitJoinRegion, _emitOne: EmitOne): string {
  const split = nodeById(doc, region.entryId)!;
  const join = nodeById(doc, region.joinId)!;
  const joinVar = varName(doc, join);
  const inWire = inWires(doc, split.id)[0];
  const src = inWire ? nodeById(doc, inWire.from.nodeId) : undefined;
  const arrExpr = src && src.kind !== "input" ? varName(doc, src) : "args";
  const stages = region.memberIds.map((id, idx) => {
    const n = nodeById(doc, id)!;
    const param = idx === 0 ? "item" : "prev";
    const prompt = n.prompt ?? n.label;
    const tmpl =
      "`" + escapeTemplate(prompt) + `\n\n<context name="${param}">\n\${${param}}\n</context>` + "`";
    return `    (${param}) => agent(${tmpl}, { label: ${jsString(n.label)} })`;
  });
  return [`  const ${joinVar} = await pipeline(`, `    ${arrExpr},`, stages.join(",\n"), `  );`].join("\n");
}

/** branch: the branch node is an agent emitting `BRANCH: <label>`; dispatch
 *  with an if / else-if chain over the labelled paths. */
export function emitBranchRegion(doc: PflowDocument, region: BranchRegion, emitOne: EmitOne): string {
  const branch = nodeById(doc, region.entryId)!;
  const choiceVar = varName(doc, branch);
  const labels = region.paths.map((p) => p.label).join("|");
  const call = buildAgentCall(doc, branch, `Choose exactly ONE path and emit a line: BRANCH: <one of ${labels}>`);
  const arms = region.paths.map((p, i) => {
    const cond = `/BRANCH:\\s*${p.label}/i.test(String(${choiceVar}))`;
    const body = p.memberIds
      .map((id) => emitOne(doc, nodeById(doc, id)!))
      .filter((s) => s.length > 0)
      .map((s) => indent(s))
      .join("\n");
    const head = i === 0 ? `  if (${cond}) {` : `  } else if (${cond}) {`;
    return `${head}\n${body}`;
  });
  return [`  const ${choiceVar} = ${call};`, ...arms, `  }`].join("\n");
}
