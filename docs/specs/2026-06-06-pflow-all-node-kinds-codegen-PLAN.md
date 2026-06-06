# All Node Kinds Codegen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compile all 6 remaining pflow node kinds (verify, synthesize, loop, split, join, branch) to idiomatic Claude Code workflow code, so no kind throws and the editor un-ghosts every kind.

**Architecture:** A new pure graph-analysis module `pflow/regions.ts` identifies control-flow regions (loop spans, split→join spans, branch paths) by traversal. A new `codegen/emit-kinds.ts` holds per-kind emitters. `scriptgen.ts` switches from node-by-node to region-by-region emission. emit-lint and determinism invariants are preserved.

**Tech Stack:** TypeScript, Zod (existing schema), vitest. Targets the CC workflow primitives `agent()`, `pipeline()`, `log()`.

Spec: `docs/specs/2026-06-06-pflow-all-node-kinds-codegen-design.md`

---

## File structure

- `packages/core/src/pflow/regions.ts` (new) — `analyzeRegions(doc)`: returns `{ regions, absorbed }`. A region is `{ kind: 'loop'|'splitjoin'|'branch', entryId, memberIds, ... }`. Pure, tested in isolation.
- `packages/core/src/codegen/emit-kinds.ts` (new) — `emitVerify`, `emitSynthesize`, `emitLoopRegion`, `emitSplitJoinRegion`, `emitBranchRegion`. Each returns a code string.
- `packages/core/src/codegen/scriptgen.ts` (modify) — region-based emit loop; delegate to emit-kinds.
- `packages/core/src/pflow/validate.ts` (modify) — branch/loop/nested-region rules.
- `packages/core/src/views/.../flow-map.ts` (modify) — `COMPILABLE_KINDS` = all 10.
- Tests: `packages/core/test/pflow/regions.test.ts`, `packages/core/test/codegen/scriptgen.test.ts` (extend).

Existing helpers to reuse (from `pflow/topo.ts`): `nodeById`, `inWires`, `outWires`, `topoOrder`. Existing emit helpers (in `scriptgen.ts`, will be exported for reuse): `varName`, `jsString`, `escapeTemplate`, the agent-context-weaving logic.

---

## Task 1: Export reusable emit helpers from scriptgen

**Files:**
- Modify: `packages/core/src/codegen/scriptgen.ts`

emit-kinds.ts needs `varName`, the context-weaving, `jsString`, `escapeTemplate`. Currently `varName` and the weaving are private. Extract the agent-call builder into an exported function.

- [ ] **Step 1: Export `varName` and add `buildAgentCall`**

In `scriptgen.ts`, change `function varName` → `export function varName`. Then extract the agent emit body (lines ~62-87) into an exported helper:

```ts
/** Build the `await agent(...)` expression (without the `const X =` prefix) for
 *  a node, weaving each wired input as a labelled context block in declared
 *  order. `extraInstruction`, if given, is appended to the prompt before the
 *  context blocks (used by verify/branch to request a sentinel line). */
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
    const srcVar = src.kind === "input" ? "args" : varName(doc, src);
    blocks.push(`\n\n<context name="${port.name}">\n\${${srcVar}}\n</context>`);
  }
  if (blocks.length === 0 && !extraInstruction) {
    return `await agent(${jsString(base)}, { label: ${label} })`;
  }
  const tmpl = "`" + escapeTemplate(base) + blocks.join("") + "`";
  return `await agent(${tmpl}, { label: ${label} })`;
}
```

Then rewrite the `case "agent"` in `emitNode` to use it:
```ts
case "agent": {
  const v = varName(doc, node);
  return `  const ${v} = await ${buildAgentCall(doc, node)};`.replace("await await ", "await ");
}
```
(Simpler: `return \`  const ${v} = ${buildAgentCall(doc, node)};\`;` — buildAgentCall already includes `await`.)

- [ ] **Step 2: Run existing codegen tests (must stay green)**

Run: `npx vitest run packages/core/test/codegen/scriptgen.test.ts`
Expected: PASS (the refactor is behavior-preserving — byte-identical output).

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/codegen/scriptgen.ts
git commit -m "refactor(codegen): extract buildAgentCall + export varName for reuse"
```

---

## Task 2: regions.ts — loop span detection

**Files:**
- Create: `packages/core/src/pflow/regions.ts`
- Test: `packages/core/test/pflow/regions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { analyzeRegions } from "../../src/pflow/regions.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

// loop: draft -> review(loop), with review's refine back-edge -> draft.
const LOOP_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "loopwf", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
    { id: "draft", kind: "agent", label: "Draft", prompt: "draft", inputs: [{ id: "i", name: "x", schema: { type: "string" }, required: true }, { id: "r", name: "fix", schema: { type: "string" } }], outputs: [{ id: "o", name: "d", schema: { type: "string" } }] },
    { id: "review", kind: "loop", label: "Review", prompt: "review; emit ALL_OWNED: yes|no", inputs: [{ id: "i", name: "d", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "fix", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "d", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "draft", portId: "i" } },
    { from: { nodeId: "draft", portId: "o" }, to: { nodeId: "review", portId: "i" } },
    { from: { nodeId: "review", portId: "o" }, to: { nodeId: "draft", portId: "r" } }, // back-edge
    { from: { nodeId: "draft", portId: "o" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("analyzeRegions — loop", () => {
  it("detects a loop region spanning the back-edge target through the loop node", () => {
    const { regions } = analyzeRegions(LOOP_DOC);
    const loop = regions.find((r) => r.kind === "loop");
    expect(loop).toBeDefined();
    expect(loop!.entryId).toBe("review");
    expect(new Set(loop!.memberIds)).toEqual(new Set(["draft", "review"]));
    expect(loop!.backEdge).toMatchObject({ from: { nodeId: "review" }, to: { nodeId: "draft" } });
  });
  it("marks the span members as absorbed", () => {
    const { absorbed } = analyzeRegions(LOOP_DOC);
    expect(absorbed.has("draft")).toBe(true);
    expect(absorbed.has("review")).toBe(true);
    expect(absorbed.has("in")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/pflow/regions.test.ts -t loop`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement loop detection**

```ts
import type { PflowDocument, Wire } from "./schema.js";
import { nodeById, outWires } from "./topo.js";

export interface LoopRegion {
  kind: "loop";
  entryId: string;        // the loop node id
  memberIds: string[];    // span: back-edge target … loop node (forward path)
  backEdge: Wire;
}
export interface SplitJoinRegion {
  kind: "splitjoin";
  entryId: string;        // split node id
  joinId: string;
  memberIds: string[];    // nodes strictly between split and join
}
export interface BranchRegion {
  kind: "branch";
  entryId: string;        // branch node id
  paths: { label: string; memberIds: string[] }[];
}
export type Region = LoopRegion | SplitJoinRegion | BranchRegion;

export interface RegionAnalysis {
  regions: Region[];
  absorbed: Set<string>;  // node ids emitted as part of a region (skip at top level)
}

/** A back-edge is a wire from a loop node's output back to an upstream node:
 *  its source is the loop node and its target is reachable to the loop via
 *  forward (non-back) wires. */
function findLoopRegions(doc: PflowDocument): LoopRegion[] {
  const regions: LoopRegion[] = [];
  for (const node of doc.nodes) {
    if (node.kind !== "loop") continue;
    // the back-edge is the loop's own outgoing wire that targets an ancestor.
    const back = outWires(doc, node.id).find((w) => reaches(doc, w.to.nodeId, node.id, w));
    if (!back) continue;
    const members = pathNodes(doc, back.to.nodeId, node.id, back);
    regions.push({ kind: "loop", entryId: node.id, memberIds: members, backEdge: back });
  }
  return regions;
}

/** True if `fromId` can reach `toId` via forward wires (excluding `exclude`). */
function reaches(doc: PflowDocument, fromId: string, toId: string, exclude: Wire): boolean {
  const seen = new Set<string>();
  const stack = [fromId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === toId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const w of outWires(doc, id)) {
      if (w === exclude) continue;
      stack.push(w.to.nodeId);
    }
  }
  return false;
}

/** Nodes on forward paths from startId to endId (inclusive), excluding the
 *  back-edge. Declaration-ordered. */
function pathNodes(doc: PflowDocument, startId: string, endId: string, exclude: Wire): string[] {
  const onPath = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (id === endId) {
      for (const t of [...trail, id]) onPath.add(t);
      return;
    }
    for (const w of outWires(doc, id)) {
      if (w === exclude) continue;
      if (trail.includes(id)) continue; // guard cycles
      visit(w.to.nodeId, [...trail, id]);
    }
  };
  visit(startId, []);
  return doc.nodes.filter((n) => onPath.has(n.id)).map((n) => n.id);
}

export function analyzeRegions(doc: PflowDocument): RegionAnalysis {
  const loops = findLoopRegions(doc);
  const regions: Region[] = [...loops];
  const absorbed = new Set<string>();
  for (const r of regions) {
    for (const id of memberIdsOf(r)) absorbed.add(id);
  }
  return { regions, absorbed };
}

function memberIdsOf(r: Region): string[] {
  if (r.kind === "loop") return r.memberIds;
  if (r.kind === "splitjoin") return [r.entryId, ...r.memberIds, r.joinId];
  return [r.entryId, ...r.paths.flatMap((p) => p.memberIds)];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/core/test/pflow/regions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pflow/regions.ts packages/core/test/pflow/regions.test.ts
git commit -m "feat(pflow): regions.ts — loop span detection via back-edge"
```

---

## Task 3: regions.ts — split→join span detection

**Files:**
- Modify: `packages/core/src/pflow/regions.ts`, `packages/core/test/pflow/regions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// split -> work(agent) -> join. split.items is array.
const SPLITJOIN_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "sj", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "list", schema: { type: "array", items: { type: "string" } } }] },
    { id: "sp", kind: "split", label: "Split", inputs: [{ id: "i", name: "list", schema: { type: "array" }, required: true }], outputs: [{ id: "o", name: "item", schema: { type: "string" } }] },
    { id: "work", kind: "agent", label: "Work", prompt: "process item", inputs: [{ id: "i", name: "item", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "done", schema: { type: "string" } }] },
    { id: "jn", kind: "join", label: "Join", inputs: [{ id: "i", name: "done", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "results", schema: { type: "array" } }] },
    { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "results", schema: { type: "array" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "sp", portId: "i" } },
    { from: { nodeId: "sp", portId: "o" }, to: { nodeId: "work", portId: "i" } },
    { from: { nodeId: "work", portId: "o" }, to: { nodeId: "jn", portId: "i" } },
    { from: { nodeId: "jn", portId: "o" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("analyzeRegions — split/join", () => {
  it("detects a splitjoin region with the work node between", () => {
    const { regions } = analyzeRegions(SPLITJOIN_DOC);
    const sj = regions.find((r) => r.kind === "splitjoin");
    expect(sj).toBeDefined();
    expect(sj!.entryId).toBe("sp");
    if (sj!.kind === "splitjoin") {
      expect(sj!.joinId).toBe("jn");
      expect(sj!.memberIds).toEqual(["work"]);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/pflow/regions.test.ts -t "split/join"`
Expected: FAIL (no splitjoin region found).

- [ ] **Step 3: Implement**

Add to `regions.ts`:
```ts
import { inWires } from "./topo.js";

function findSplitJoinRegions(doc: PflowDocument): SplitJoinRegion[] {
  const regions: SplitJoinRegion[] = [];
  for (const split of doc.nodes.filter((n) => n.kind === "split")) {
    const join = findMatchingJoin(doc, split.id);
    if (!join) continue;
    const between = pathNodesBetween(doc, split.id, join);
    regions.push({ kind: "splitjoin", entryId: split.id, joinId: join, memberIds: between });
  }
  return regions;
}

/** First downstream join reachable from a split via forward wires. */
function findMatchingJoin(doc: PflowDocument, splitId: string): string | undefined {
  const seen = new Set<string>();
  const stack = [splitId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = nodeById(doc, id);
    if (node && id !== splitId && node.kind === "join") return id;
    for (const w of outWires(doc, id)) stack.push(w.to.nodeId);
  }
  return undefined;
}

/** Nodes strictly between start and end (exclusive of both), declaration-ordered. */
function pathNodesBetween(doc: PflowDocument, startId: string, endId: string): string[] {
  const onPath = new Set<string>();
  const visit = (id: string, trail: string[]): void => {
    if (id === endId) {
      for (const t of trail) if (t !== startId) onPath.add(t);
      return;
    }
    for (const w of outWires(doc, id)) {
      if (trail.includes(id)) continue;
      visit(w.to.nodeId, [...trail, id]);
    }
  };
  visit(startId, []);
  return doc.nodes.filter((n) => onPath.has(n.id)).map((n) => n.id);
}
```

Wire it into `analyzeRegions`:
```ts
const splitjoins = findSplitJoinRegions(doc);
const regions: Region[] = [...loops, ...splitjoins];
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/core/test/pflow/regions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pflow/regions.ts packages/core/test/pflow/regions.test.ts
git commit -m "feat(pflow): regions.ts — split/join span detection"
```

---

## Task 4: regions.ts — branch path detection

**Files:**
- Modify: `packages/core/src/pflow/regions.ts`, `packages/core/test/pflow/regions.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// branch with two labelled output ports (approve/reject) → distinct nodes.
const BRANCH_DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "br", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "x", schema: { type: "string" } }] },
    { id: "br", kind: "branch", label: "Branch", prompt: "decide; emit BRANCH: approve|reject", inputs: [{ id: "i", name: "x", schema: { type: "string" }, required: true }], outputs: [{ id: "approve", name: "approve", schema: { type: "string" } }, { id: "reject", name: "reject", schema: { type: "string" } }] },
    { id: "ap", kind: "agent", label: "Approve", prompt: "handle approve", inputs: [{ id: "i", name: "approve", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "r", schema: { type: "string" } }] },
    { id: "rj", kind: "agent", label: "Reject", prompt: "handle reject", inputs: [{ id: "i", name: "reject", schema: { type: "string" }, required: true }], outputs: [{ id: "o", name: "r", schema: { type: "string" } }] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "br", portId: "i" } },
    { from: { nodeId: "br", portId: "approve" }, to: { nodeId: "ap", portId: "i" } },
    { from: { nodeId: "br", portId: "reject" }, to: { nodeId: "rj", portId: "i" } },
  ],
};

describe("analyzeRegions — branch", () => {
  it("detects a branch region with one path per labelled output port", () => {
    const { regions } = analyzeRegions(BRANCH_DOC);
    const br = regions.find((r) => r.kind === "branch");
    expect(br).toBeDefined();
    if (br!.kind === "branch") {
      expect(br!.paths.map((p) => p.label).sort()).toEqual(["approve", "reject"]);
      const approve = br!.paths.find((p) => p.label === "approve")!;
      expect(approve.memberIds).toEqual(["ap"]);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/pflow/regions.test.ts -t branch`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
function findBranchRegions(doc: PflowDocument): BranchRegion[] {
  const regions: BranchRegion[] = [];
  for (const branch of doc.nodes.filter((n) => n.kind === "branch")) {
    const paths: { label: string; memberIds: string[] }[] = [];
    for (const port of branch.outputs) {
      const wire = outWires(doc, branch.id).find((w) => w.from.portId === port.id);
      if (!wire) continue;
      const members = reachableFrom(doc, wire.to.nodeId, branch.id);
      paths.push({ label: port.name, memberIds: members });
    }
    if (paths.length > 0) regions.push({ kind: "branch", entryId: branch.id, paths });
  }
  return regions;
}

/** Nodes reachable forward from startId, declaration-ordered, never re-entering
 *  the branch node. (Single-level: paths assumed disjoint until graph end.) */
function reachableFrom(doc: PflowDocument, startId: string, stopId: string): string[] {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === stopId || seen.has(id)) continue;
    seen.add(id);
    for (const w of outWires(doc, id)) stack.push(w.to.nodeId);
  }
  return doc.nodes.filter((n) => seen.has(n.id)).map((n) => n.id);
}
```

Wire into `analyzeRegions`:
```ts
const branches = findBranchRegions(doc);
const regions: Region[] = [...loops, ...splitjoins, ...branches];
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/core/test/pflow/regions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pflow/regions.ts packages/core/test/pflow/regions.test.ts
git commit -m "feat(pflow): regions.ts — branch path detection"
```

---

## Task 5: emit-kinds.ts — verify + synthesize

**Files:**
- Create: `packages/core/src/codegen/emit-kinds.ts`
- Test: extend `packages/core/test/codegen/scriptgen.test.ts`

- [ ] **Step 1: Implement the two sequential emitters**

```ts
import type { PflowDocument, PflowNode } from "../pflow/schema.js";
import { varName, buildAgentCall } from "./scriptgen.js";

/** verify: an agent that emits a pass/fail verdict, logged, non-blocking. The
 *  node's checked input flows on (its output var === the agent result). */
export function emitVerify(doc: PflowDocument, node: PflowNode): string {
  const v = varName(doc, node);
  const call = buildAgentCall(doc, node, "Emit a verdict line exactly: VERIFY: pass  OR  VERIFY: fail");
  return `  const ${v} = ${call};\n  log(${v});`;
}

/** synthesize: a multi-input agent that merges all wired inputs (the agent call
 *  already weaves every wired input as a labelled context block). */
export function emitSynthesize(doc: PflowDocument, node: PflowNode): string {
  const v = varName(doc, node);
  return `  const ${v} = ${buildAgentCall(doc, node)};`;
}
```

- [ ] **Step 2: Add a verify+synthesize codegen test**

In `scriptgen.test.ts`, append a doc with a verify node and a synthesize node, then:
```ts
describe("verify + synthesize", () => {
  it("verify emits a VERIFY sentinel instruction and logs the verdict", () => {
    const code = generateClaudeCodeWorkflow(VERIFY_DOC);
    expect(code).toContain("VERIFY: pass");
    expect(code).toMatch(/log\(\w+\)/);
  });
  it("synthesize weaves multiple inputs as context blocks", () => {
    const code = generateClaudeCodeWorkflow(SYNTH_DOC);
    expect(code).toContain('<context name="a">');
    expect(code).toContain('<context name="b">');
  });
});
```
(Define `VERIFY_DOC` = input→verify→output; `SYNTH_DOC` = two inputs→synthesize→output. Wire both inputs to the synthesize node's two input ports.)

- [ ] **Step 3: Wire emit-kinds into scriptgen (Task 7 does the full loop); for now make verify/synthesize cases call them**

In `scriptgen.ts` `emitNode`, replace the `verify`/`synthesize` throw arms:
```ts
case "verify":
  return emitVerify(doc, node);
case "synthesize":
  return emitSynthesize(doc, node);
```
(Import from `./emit-kinds.js`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/test/codegen/scriptgen.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codegen/emit-kinds.ts packages/core/src/codegen/scriptgen.ts packages/core/test/codegen/scriptgen.test.ts
git commit -m "feat(codegen): emit verify (verdict+log) and synthesize (multi-input)"
```

---

## Task 6: emit-kinds.ts — loop, split/join, branch region emitters

**Files:**
- Modify: `packages/core/src/codegen/emit-kinds.ts`
- Test: extend `scriptgen.test.ts`

- [ ] **Step 1: Implement the three region emitters**

```ts
import type { LoopRegion, SplitJoinRegion, BranchRegion } from "../pflow/regions.js";
import { nodeById, inWires } from "../pflow/topo.js";
import { jsString } from "./scriptgen.js";

/** Emit a single node's code for use inside a region body (no top-level
 *  indentation concerns; the caller wraps). Reuses the per-kind single-node
 *  emitters. `emitOne` is passed in to avoid a cycle with scriptgen. */
export type EmitOne = (doc: PflowDocument, node: PflowNode) => string;

export function emitLoopRegion(doc: PflowDocument, region: LoopRegion, emitOne: EmitOne): string {
  const loopNode = nodeById(doc, region.entryId)!;
  const maxPasses = Number((loopNode.config?.maxPasses as number | undefined) ?? 3);
  const sentinel = (loopNode.config?.sentinel as string | undefined) ?? "ALL_OWNED:\\s*yes";
  const loopVar = varName(doc, loopNode);
  // span body: emit each member node in declared order (members include the
  // loop node itself, whose emit binds loopVar).
  const body = region.memberIds
    .map((id) => emitOne(doc, nodeById(doc, id)!))
    .filter((s) => s.length > 0)
    .map((s) => "  " + s.replace(/\n/g, "\n  "))
    .join("\n");
  return [
    `  for (let pass = 0; pass < ${maxPasses}; pass++) {`,
    body,
    `    if (/${sentinel}/i.test(String(${loopVar}))) break;`,
    `  }`,
  ].join("\n");
}

export function emitSplitJoinRegion(doc: PflowDocument, region: SplitJoinRegion, _emitOne: EmitOne): string {
  const split = nodeById(doc, region.entryId)!;
  const join = nodeById(doc, region.joinId)!;
  const joinVar = varName(doc, join);
  // split's array source variable.
  const inWire = inWires(doc, split.id)[0];
  const src = inWire ? nodeById(doc, inWire.from.nodeId) : undefined;
  const arrExpr = src && src.kind !== "input" ? varName(doc, src) : "args";
  // each member agent becomes a pipeline stage. First stage receives `item`.
  const stages = region.memberIds.map((id, idx) => {
    const n = nodeById(doc, id)!;
    const param = idx === 0 ? "item" : "prev";
    const prompt = (n.prompt ?? n.label);
    return `    (${param}) => agent(\`${escapeForStage(prompt)}\n\n<context name="item">\n\${${param}}\n</context>\`, { label: ${jsString(n.label)} })`;
  });
  return [
    `  const ${joinVar} = await pipeline(`,
    `    ${arrExpr},`,
    stages.join(",\n"),
    `  );`,
  ].join("\n");
}

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
      .map((s) => "  " + s.replace(/\n/g, "\n  "))
      .join("\n");
    const head = i === 0 ? `  if (${cond}) {` : `  } else if (${cond}) {`;
    return `${head}\n${body}`;
  });
  return [`  const ${choiceVar} = ${call};`, ...arms, `  }`].join("\n");
}

function escapeForStage(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
```
(Add `escapeTemplate`, `varName`, `buildAgentCall` to the imports from `./scriptgen.js`.)

- [ ] **Step 2: Add region codegen tests**

```ts
describe("loop region", () => {
  it("emits a bounded for-loop with a sentinel break", () => {
    const code = generateClaudeCodeWorkflow(LOOP_DOC); // reuse regions test doc shape
    expect(code).toMatch(/for \(let pass = 0; pass < 3; pass\+\+\)/);
    expect(code).toMatch(/ALL_OWNED.*break|break/);
  });
});
describe("split/join region", () => {
  it("emits a pipeline over the split array", () => {
    const code = generateClaudeCodeWorkflow(SPLITJOIN_DOC);
    expect(code).toContain("await pipeline(");
  });
});
describe("branch region", () => {
  it("emits BRANCH sentinel dispatch with an if/else-if chain", () => {
    const code = generateClaudeCodeWorkflow(BRANCH_DOC);
    expect(code).toMatch(/BRANCH:\\s\*approve|BRANCH:/);
    expect(code).toContain("} else if (");
  });
});
```
(Copy LOOP_DOC / SPLITJOIN_DOC / BRANCH_DOC from the regions test into the scriptgen test, or import a shared fixtures module.)

- [ ] **Step 3: Run (will fail until Task 7 wires the region loop)**

Run: `npx vitest run packages/core/test/codegen/scriptgen.test.ts -t region`
Expected: FAIL (regions not yet emitted by scriptgen). Proceed to Task 7.

- [ ] **Step 4: Commit the emitters**

```bash
git add packages/core/src/codegen/emit-kinds.ts packages/core/test/codegen/scriptgen.test.ts
git commit -m "feat(codegen): loop/split-join/branch region emitters"
```

---

## Task 7: scriptgen region-based emit loop

**Files:**
- Modify: `packages/core/src/codegen/scriptgen.ts`

- [ ] **Step 1: Rewrite generateClaudeCodeWorkflow's body emission**

Replace the body-building section:
```ts
import { analyzeRegions, type Region } from "../pflow/regions.js";
import { emitVerify, emitSynthesize, emitLoopRegion, emitSplitJoinRegion, emitBranchRegion } from "./emit-kinds.js";

// emitOne handles a SINGLE node (the non-region path). Used directly at top
// level and passed into region emitters for their member nodes.
function emitOne(doc: PflowDocument, node: PflowNode): string {
  return emitNode(doc, node);
}

function emitRegion(doc: PflowDocument, region: Region): string {
  if (region.kind === "loop") return emitLoopRegion(doc, region, emitOne);
  if (region.kind === "splitjoin") return emitSplitJoinRegion(doc, region, emitOne);
  return emitBranchRegion(doc, region, emitOne);
}
```

In `generateClaudeCodeWorkflow`, after validation and `topoOrder`:
```ts
const { regions, absorbed } = analyzeRegions(doc);
const regionByEntry = new Map(regions.map((r) => [r.entryId, r] as const));
const emittedRegions = new Set<string>();
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
  if (absorbed.has(id)) continue; // member of a region, already emitted
  const piece = emitNode(doc, nodeById(doc, id)!);
  if (piece.length > 0) lines.push(piece);
}
const body = lines.join("\n");
```
Keep the existing `header`, `renderMeta`, `code`, and emit-lint steps.

IMPORTANT: `topoOrder` throws on cycles. The loop back-edge is a cycle. So
before topo, the back-edges must be excluded. Add to `topo.ts` an internal
`topoOrderExcluding(doc, excludeWires)` OR have `analyzeRegions` run first and
pass the back-edge set to a cycle-tolerant order. Simplest: compute
`backEdges` from regions, and build the order from a filtered wire list.

Concretely, add to `scriptgen.ts`:
```ts
function orderExcludingBackEdges(doc: PflowDocument, regions: Region[]): string[] {
  const backEdges = new Set(regions.filter((r): r is LoopRegion => r.kind === "loop").map((r) => r.backEdge));
  const filtered: PflowDocument = { ...doc, wires: doc.wires.filter((w) => !backEdges.has(w)) };
  return topoOrder(filtered);
}
```
and use `const order = orderExcludingBackEdges(doc, regions);` (so regions must be computed before order). Import `LoopRegion` from regions.

- [ ] **Step 2: Run the full codegen test suite**

Run: `npx vitest run packages/core/test/codegen/scriptgen.test.ts`
Expected: PASS (linear, chain, collision, verify, synthesize, loop, splitjoin, branch all green).

- [ ] **Step 3: Run emit-lint determinism check**

The region tests already assert shape. Add one determinism assertion per new doc if not present:
```ts
it("region docs are byte-identical across emissions", () => {
  for (const d of [LOOP_DOC, SPLITJOIN_DOC, BRANCH_DOC]) {
    expect(generateClaudeCodeWorkflow(d)).toBe(generateClaudeCodeWorkflow(d));
  }
});
```

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/codegen/scriptgen.ts packages/core/test/codegen/scriptgen.test.ts
git commit -m "feat(codegen): region-based emit loop wiring all 6 kinds"
```

---

## Task 8: Validation — branch/loop/nested-region rules

**Files:**
- Modify: `packages/core/src/pflow/validate.ts`
- Test: `packages/core/test/pflow/validate.test.ts` (or wherever validate is tested)

- [ ] **Step 1: Write failing tests**

```ts
import { analyzeRegions } from "../../src/pflow/regions.js";
// nested region: a split inside a loop span → must error.
it("rejects nested control-flow regions", () => {
  // build a doc where a loop span contains a split node
  expect(validatePflow(NESTED_DOC).ok).toBe(false);
  expect(validatePflow(NESTED_DOC).errors.some((e) => e.rule === "nested-region-unsupported")).toBe(true);
});
it("rejects a branch with no labelled outgoing path", () => {
  expect(validatePflow(BRANCH_NO_PATH).errors.some((e) => e.rule === "branch-no-path")).toBe(true);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/core/test/pflow -t "nested\|branch with no"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `validate.ts`, after the existing checks, add region-aware validation:
```ts
import { analyzeRegions } from "./regions.js";

// inside validatePflow, before the return:
const { regions } = analyzeRegions(doc);
const entryIds = new Set(regions.map((r) => r.entryId));
for (const r of regions) {
  const members = r.kind === "loop" ? r.memberIds
    : r.kind === "splitjoin" ? r.memberIds
    : r.paths.flatMap((p) => p.memberIds);
  for (const id of members) {
    if (id !== r.entryId && entryIds.has(id)) {
      errors.push({ rule: "nested-region-unsupported", message: `Control-flow region ${r.entryId} contains another region entry ${id}; nested regions are not supported`, nodeId: r.entryId });
    }
  }
}
for (const node of doc.nodes) {
  if (node.kind === "branch") {
    const hasPath = doc.wires.some((w) => w.from.nodeId === node.id);
    if (!hasPath) errors.push({ rule: "branch-no-path", message: `Branch node ${node.id} has no outgoing path`, nodeId: node.id });
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/core/test/pflow`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pflow/validate.ts packages/core/test/pflow/
git commit -m "feat(pflow): validate branch paths + reject nested regions"
```

---

## Task 9: Un-ghost all kinds in the editor

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

- [ ] **Step 1: Update the COMPILABLE_KINDS test**

```ts
it("is all ten kinds now that codegen supports every kind", () => {
  expect(COMPILABLE_KINDS).toEqual([
    "input", "output", "agent", "split", "join", "loop", "verify", "synthesize", "branch", "script",
  ]);
});
```
(Match the order of `NODE_KINDS` in `@perspecta/core` schema.ts.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t COMPILABLE`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `flow-map.ts`:
```ts
import { NODE_KINDS } from "@perspecta/core";
// ...
export const COMPILABLE_KINDS: NodeKind[] = [...NODE_KINDS];
```
(`script` is compilable as terminal-only; the add-menu still creates it, and validation guards downstream wires. All kinds are now selectable.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): un-ghost all node kinds (codegen now covers them)"
```

---

## Task 10: Full gate — build, all tests, typecheck, deploy

**Files:** none (verification).

- [ ] **Step 1: Full test suite + typechecks**

Run: `npx vitest run && cd packages/core && npx tsc --noEmit && cd ../obsidian-plugin && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 2: Build plugin + verify artifacts**

Run from `packages/obsidian-plugin`:
```bash
node esbuild.config.mjs
grep -c "await pipeline" main.js || true   # codegen string lives in core, not plugin — may be 0; not a gate
```
Expected: build exit 0.

- [ ] **Step 3: Deploy + byte-check**

```bash
PERSPECTA_VAULT_ROOT="/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact" bash scripts/deploy-dev.sh
DEST="/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/.obsidian/plugins/perspecta-workflow"
cmp main.js "$DEST/main.js" && echo "byte-identical"
```

- [ ] **Step 4: Commit final state**

```bash
git add -A && git commit -m "chore(pflow): all-node-kinds codegen gate (tests, build, deploy verified)"
```

---

## Self-review notes

- **Spec coverage:** verify→T5; synthesize→T5; loop→T2/T6/T7; split-join→T3/T6/T7; branch→T4/T6/T7; region emit loop→T7; validation (branch/nested)→T8; editor un-ghost→T9; determinism→T6/T7 tests; nested-region rejection→T8.
- **Type consistency:** `Region`/`LoopRegion`/`SplitJoinRegion`/`BranchRegion`, `analyzeRegions`, `emitOne`/`EmitOne`, `buildAgentCall`, `varName` used consistently across T1–T8.
- **Known risks flagged inline:** topo cycle exclusion for loop back-edges (T7 Step 1); split array source resolution (T6); single-level region assumption enforced by T8 validation.
- **Scope:** single milestone; nested regions deferred-by-rejection, not silently handled.
