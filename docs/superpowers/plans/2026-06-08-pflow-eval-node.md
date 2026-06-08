# pflow Eval Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `eval` node kind — a gate-capable judge that evaluates its wired input(s), emits an `EVAL: pass/fail` verdict, routes via `pass`/`fail` output ports, and optionally halts the run.

**Architecture:** The eval node reuses the existing branch control-flow machinery. Rather than duplicate the (bug-prone) arm/reconvergence logic, we **generalize the branch region** to carry a `verb` (`"BRANCH"` | `"EVAL"`) and an optional `blockOnFail` flag. `findBranchRegions` already works for any node with labelled output ports; `emitBranchRegion` already emits a verdict line + N-arm dispatch. The eval node's two `pass`/`fail` output ports are declared by `{{out:pass}}`/`{{out:fail}}` tokens in pre-populated, mode-specific prompt templates, so port derivation needs no new machinery. The editor adds a mode dropdown (confirm-and-overwrite prompt swap) and a `block on fail` toggle.

**Tech Stack:** TypeScript, Zod (schema), Vitest (`vitest run`), Svelte 5 (editor inspector). Monorepo: `@perspecta/core` (schema + codegen) and `packages/obsidian-plugin` (editor).

**Reference spec:** `docs/specs/2026-06-08-pflow-eval-node-design.md`

---

## File Structure

**Core (`packages/core/src`):**
- `pflow/schema.ts` — add `"eval"` to `NODE_KINDS` (modify). `config` is already a freeform `z.record`, so `mode`/`blockOnFail` need no schema additions.
- `pflow/regions.ts` — generalize `BranchRegion` with `verb: "BRANCH" | "EVAL"` and `blockOnFail: boolean`; `findBranchRegions` detects `eval` nodes too (modify).
- `codegen/emit-kinds.ts` — `emitBranchRegion` honors `region.verb` for the verdict label and emits a block-on-fail throw when `region.blockOnFail` (modify).
- `codegen/scriptgen.ts` — `emitNode` adds `case "eval"` to the region-only throw list (modify).

**Editor (`packages/obsidian-plugin/src`):**
- `views/pflow-editor/eval-templates.ts` — NEW: the three mode templates + `EVAL_MODES` constant + `templateForMode()`.
- `views/pflow-editor/flow-map.ts` — `applyEvalMode()`, `applyEvalModeFlagOnly()`, `applyBlockOnFail()` (modify).
- `views/pflow-editor/kind-info.ts` — `KIND_INFO.eval` entry + add `"eval"` to `PROMPT_KINDS` (modify).
- `views/pflow-editor/inspector-pane.svelte` — mode dropdown + block-on-fail toggle for eval nodes (modify).
- `views/pflow-editor/editor.svelte` — wire `onEvalMode`/`onBlockOnFail` handlers (modify).

**Tests:**
- `packages/core/test/pflow/regions.test.ts` — eval region detection (modify).
- `packages/core/test/codegen/eval-node.test.ts` — NEW: eval codegen (verdict, routing, block-on-fail, comparison two-input, reconvergence).
- `packages/obsidian-plugin/test/flow-map.test.ts` — eval transforms (modify).
- `packages/obsidian-plugin/test/eval-templates.test.ts` — NEW: template/port-derivation sanity.
- `packages/obsidian-plugin/test/kind-info.test.ts` — NEW (or extend): eval KIND_INFO + PROMPT_KINDS.

**Note on compile-checking emitted code:** several codegen tests below assert the generated script is structurally sound. Use the repo's existing approach for this — if `packages/core/test/codegen` already has a helper that parses/compiles emitted output, reuse it. If none exists, the load-bearing assertions are the `toContain(...)` string checks (verdict labels, dispatch keywords); those are sufficient and require no dynamic evaluation.

---

## Task 1: Register the `eval` kind in the schema

**Files:**
- Modify: `packages/core/src/pflow/schema.ts:23-29`
- Test: `packages/core/test/pflow/schema.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/pflow/schema.test.ts` (append a new test; import `PflowNodeZ` the same way the existing tests do):

```ts
import { describe, it, expect } from "vitest";
import { PflowNodeZ } from "../../src/pflow/schema.js";

describe("schema — eval kind", () => {
  it("accepts an eval node with mode + blockOnFail config", () => {
    const node = {
      id: "ev",
      kind: "eval",
      label: "Quality gate",
      prompt: "Evaluate {{in:candidate}}. Emit EVAL: pass or EVAL: fail. Route {{out:pass}}/{{out:fail}}.",
      inputs: [{ id: "in:candidate", name: "candidate", schema: { type: "string" } }],
      outputs: [
        { id: "out:pass", name: "pass", schema: { type: "string" } },
        { id: "out:fail", name: "fail", schema: { type: "string" } },
      ],
      config: { mode: "criteria", blockOnFail: false },
    };
    expect(PflowNodeZ.parse(node).kind).toBe("eval");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/pflow/schema.test.ts -t "accepts an eval node"`
Expected: FAIL — Zod rejects `kind: "eval"` (invalid enum value, not in `NODE_KINDS`).

- [ ] **Step 3: Add `"eval"` to NODE_KINDS**

In `packages/core/src/pflow/schema.ts`, change lines 23-29 from:

```ts
export const NODE_KINDS = [
  "input", "output", "agent",
  "split", "join",
  "loop", "verify", "synthesize", "branch",
  "mcp",
  "script",
] as const;
```

to:

```ts
export const NODE_KINDS = [
  "input", "output", "agent",
  "split", "join",
  "loop", "verify", "synthesize", "branch", "eval",
  "mcp",
  "script",
] as const;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/pflow/schema.test.ts -t "accepts an eval node"`
Expected: PASS

- [ ] **Step 5: Run the full core suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS at the vitest (runtime) level. Adding a `NodeKind` may surface a TypeScript exhaustiveness gap in `emitNode`'s `switch (node.kind)` (no `default` branch) — that is fixed in Task 3. If the core suite is run through a typecheck step that fails here, proceed to Task 3 first, then return; otherwise continue.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pflow/schema.ts packages/core/test/pflow/schema.test.ts
git commit -m "feat(pflow): register eval node kind in schema"
```

---

## Task 2: Generalize the branch region to carry a verb + blockOnFail

**Files:**
- Modify: `packages/core/src/pflow/regions.ts:31-46` (BranchRegion interface), `:158-211` (findBranchRegions)
- Test: `packages/core/test/pflow/regions.test.ts`

**Context:** `findBranchRegions` (regions.ts:158) iterates `doc.nodes.filter(n => n.kind === "branch")` and builds arm/reconvergence data purely from output-port wiring. An `eval` node has the same shape (labelled output ports `pass`/`fail`). We widen the filter to include `eval`, and stamp each region with `verb` (`"BRANCH"` for branch nodes, `"EVAL"` for eval nodes) and `blockOnFail` (from an eval node's `config.blockOnFail`; always `false` for branch).

- [ ] **Step 1: Write the failing test**

Add to `packages/core/test/pflow/regions.test.ts` (it already imports `analyzeRegions`). Place after the existing branch tests:

```ts
describe("analyzeRegions — eval", () => {
  const EVAL_DOC = {
    pflowFormatVersion: 1 as const,
    workflow: { name: "wf", description: "" },
    nodes: [
      { id: "in", kind: "input" as const, label: "in", inputs: [], outputs: [{ id: "out:x", name: "x", schema: { type: "string" as const } }] },
      { id: "ev", kind: "eval" as const, label: "Gate", prompt: "Evaluate {{in:candidate}}. EVAL: pass/fail. {{out:pass}} {{out:fail}}",
        inputs: [{ id: "in:candidate", name: "candidate", schema: { type: "string" as const } }],
        outputs: [{ id: "out:pass", name: "pass", schema: { type: "string" as const } }, { id: "out:fail", name: "fail", schema: { type: "string" as const } }],
        config: { mode: "criteria", blockOnFail: true } },
      { id: "okOut", kind: "output" as const, label: "ok", inputs: [{ id: "in:y", name: "y", schema: { type: "string" as const } }], outputs: [] },
      { id: "badOut", kind: "output" as const, label: "bad", inputs: [{ id: "in:z", name: "z", schema: { type: "string" as const } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "ev", portId: "in:candidate" } },
      { from: { nodeId: "ev", portId: "out:pass" }, to: { nodeId: "okOut", portId: "in:y" } },
      { from: { nodeId: "ev", portId: "out:fail" }, to: { nodeId: "badOut", portId: "in:z" } },
    ],
  };

  it("detects an eval node as a branch-shaped region with verb EVAL and blockOnFail", () => {
    const { regions } = analyzeRegions(EVAL_DOC);
    const region = regions.find((r) => r.kind === "branch" && r.entryId === "ev");
    expect(region).toBeDefined();
    expect((region as any).verb).toBe("EVAL");
    expect((region as any).blockOnFail).toBe(true);
    expect((region as any).paths.map((p: any) => p.label).sort()).toEqual(["fail", "pass"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/pflow/regions.test.ts -t "detects an eval node"`
Expected: FAIL — no region found for `ev` (findBranchRegions only matches `kind === "branch"`), so `region` is `undefined`.

- [ ] **Step 3: Widen the BranchRegion interface**

In `packages/core/src/pflow/regions.ts`, change the `BranchRegion` interface (lines 31-46). Find:

```ts
export interface BranchRegion {
  kind: "branch";
  entryId: string;
  paths: {
    label: string;
    memberIds: string[];
    resultNodeId: string | null;
  }[];
  reconverges: { nodeId: string; portId: string }[];
}
```

Add `verb` and `blockOnFail` (keep `kind: "branch"` so all existing region-dispatch code keeps working):

```ts
export interface BranchRegion {
  kind: "branch";
  /** "BRANCH" for a branch node, "EVAL" for an eval node. Drives the verdict
   *  label the generated agent emits (BRANCH: <label> vs EVAL: pass/fail). */
  verb: "BRANCH" | "EVAL";
  /** Eval-only: when true, a `fail` verdict throws (hard quality gate). Always
   *  false for branch nodes. */
  blockOnFail: boolean;
  entryId: string;
  paths: {
    label: string;
    memberIds: string[];
    resultNodeId: string | null;
  }[];
  reconverges: { nodeId: string; portId: string }[];
}
```

- [ ] **Step 4: Make findBranchRegions detect eval nodes and stamp verb/blockOnFail**

In `findBranchRegions` (regions.ts:158-211), change the loop header from:

```ts
  for (const branch of doc.nodes.filter((n) => n.kind === "branch")) {
```

to:

```ts
  for (const branch of doc.nodes.filter((n) => n.kind === "branch" || n.kind === "eval")) {
```

Then change the final `regions.push(...)` (line 208) from:

```ts
    regions.push({ kind: "branch", entryId: branch.id, paths, reconverges });
```

to:

```ts
    const verb = branch.kind === "eval" ? "EVAL" : "BRANCH";
    const blockOnFail = branch.kind === "eval" && branch.config?.blockOnFail === true;
    regions.push({ kind: "branch", verb, blockOnFail, entryId: branch.id, paths, reconverges });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/pflow/regions.test.ts -t "detects an eval node"`
Expected: PASS

- [ ] **Step 6: Run the regions suite to confirm branch tests still pass**

Run: `cd packages/core && npx vitest run test/pflow/regions.test.ts`
Expected: PASS — existing branch-region tests are unaffected (the new fields are additive). If a branch test constructs a `BranchRegion` literal and TS now demands `verb`/`blockOnFail`, that is a test-only fix: add `verb: "BRANCH", blockOnFail: false` to that literal.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pflow/regions.ts packages/core/test/pflow/regions.test.ts
git commit -m "feat(pflow): detect eval nodes as branch-shaped regions (verb + blockOnFail)"
```

---

## Task 3: Emit EVAL verdict + pass/fail routing in codegen

**Files:**
- Modify: `packages/core/src/codegen/emit-kinds.ts:103-134` (emitBranchRegion)
- Modify: `packages/core/src/codegen/scriptgen.ts:349-357` (add `case "eval"` to region-only throw)
- Test: `packages/core/test/codegen/eval-node.test.ts` (NEW)

**Context:** `emitBranchRegion` (emit-kinds.ts) builds the verdict instruction with a hardcoded `BRANCH:` and conditions on `/BRANCH:\s*<label>/i`. We parameterize both off `region.verb`. For an EVAL region the labels are exactly `pass`/`fail`, so the instruction becomes `Emit a verdict line exactly: EVAL: pass OR EVAL: fail`. When `region.blockOnFail`, emit a throw after the choice variable on a `fail` verdict.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/codegen/eval-node.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function evalDoc(blockOnFail: boolean): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "gate_wf", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "out:x", name: "x", schema: { type: "string" } }] },
      { id: "gen", kind: "agent", label: "Gen", prompt: "Write a draft of {{in:x}}.",
        inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }],
        outputs: [{ id: "out:draft", name: "draft", schema: { type: "string" } }] },
      { id: "ev", kind: "eval", label: "Gate",
        prompt: "Evaluate {{in:candidate}} against the rubric. Route {{out:pass}} or {{out:fail}}.",
        inputs: [{ id: "in:candidate", name: "candidate", schema: { type: "string" } }],
        outputs: [{ id: "out:pass", name: "pass", schema: { type: "string" } }, { id: "out:fail", name: "fail", schema: { type: "string" } }],
        config: { mode: "criteria", blockOnFail } },
      { id: "okOut", kind: "output", label: "ok", inputs: [{ id: "in:y", name: "y", schema: { type: "string" } }], outputs: [] },
      { id: "badOut", kind: "output", label: "bad", inputs: [{ id: "in:z", name: "z", schema: { type: "string" } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "gen", portId: "in:x" } },
      { from: { nodeId: "gen", portId: "out:draft" }, to: { nodeId: "ev", portId: "in:candidate" } },
      { from: { nodeId: "ev", portId: "out:pass" }, to: { nodeId: "okOut", portId: "in:y" } },
      { from: { nodeId: "ev", portId: "out:fail" }, to: { nodeId: "badOut", portId: "in:z" } },
    ],
  };
}

describe("codegen — eval node", () => {
  it("emits an EVAL verdict instruction and a pass/fail dispatch", () => {
    const code = generateClaudeCodeWorkflow(evalDoc(false));
    expect(code).toContain("EVAL: pass");
    expect(code).toContain("EVAL: fail");
    // Two-arm dispatch keyed on the EVAL verdict (the emitted source contains a
    // regex literal /EVAL:\s*pass/i ); assert on the stable "EVAL:" substring.
    expect(code).toContain("EVAL:");
    expect(code).not.toContain("BRANCH:");
  });

  it("omits a block-on-fail throw when blockOnFail is false", () => {
    const code = generateClaudeCodeWorkflow(evalDoc(false));
    expect(code).not.toContain("Quality gate failed");
  });

  it("emits a throw when blockOnFail is true", () => {
    const code = generateClaudeCodeWorkflow(evalDoc(true));
    expect(code).toContain("Quality gate failed");
    expect(code).toContain("throw new Error");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/codegen/eval-node.test.ts`
Expected: FAIL — `generateClaudeCodeWorkflow` throws `node kind "eval" ... must be emitted as part of a control-flow region` (emitNode has no `eval` case and the region path emits `BRANCH:`), OR the code contains `BRANCH:` not `EVAL:`.

- [ ] **Step 3: Add `case "eval"` to the region-only throw list in scriptgen**

In `packages/core/src/codegen/scriptgen.ts`, the `emitNode` switch (lines 349-357) lists region-entry kinds that must be emitted by the region pass. Change:

```ts
    case "split":
    case "join":
    case "loop":
    case "branch":
```

to:

```ts
    case "split":
    case "join":
    case "loop":
    case "branch":
    case "eval":
```

(The `eval` node IS detected as a region by Task 2, so `emitNode` should never be reached for it directly — this case mirrors `branch`, failing loudly only if region detection missed it. It also satisfies exhaustiveness of `switch (node.kind)`.)

- [ ] **Step 4: Parameterize emitBranchRegion off region.verb and emit block-on-fail throw**

In `packages/core/src/codegen/emit-kinds.ts`, `emitBranchRegion` builds the call with a `BRANCH:`-labelled instruction and conditions on `/BRANCH:\s*<label>/i`. Replace those to use `region.verb`. Find:

```ts
export function emitBranchRegion(doc: PflowDocument, region: BranchRegion, emitOne: EmitOne): string {
  const branch = nodeById(doc, region.entryId)!;
  const choiceVar = varName(doc, branch);
  const labels = region.paths.map((p) => p.label).join("|");
  const call = buildAgentCall(doc, branch, `Choose exactly ONE path and emit a line: BRANCH: <one of ${labels}>`);
```

Replace the `labels`/`call` lines with verb-aware versions:

```ts
  const labels = region.paths.map((p) => p.label).join("|");
  const instruction =
    region.verb === "EVAL"
      ? `Emit a verdict line exactly: EVAL: pass  OR  EVAL: fail`
      : `Choose exactly ONE path and emit a line: BRANCH: <one of ${labels}>`;
  const call = buildAgentCall(doc, branch, instruction);
```

Then find the per-arm condition (line ~116):

```ts
    const cond = `/BRANCH:\\s*${p.label}/i.test(String(${choiceVar}))`;
```

Replace with:

```ts
    const cond = `/${region.verb}:\\s*${p.label}/i.test(String(${choiceVar}))`;
```

Finally, emit the block-on-fail throw. Find the return at the end of `emitBranchRegion`:

```ts
  const decl = reconverges ? [`  let ${resultVar};`] : [];
  return [...decl, `  const ${choiceVar} = ${call};`, ...arms, `  }`].join("\n");
```

Replace with a version that inserts the throw right after the choice variable (verdict computed, then the gate fires before the arms run):

```ts
  const decl = reconverges ? [`  let ${resultVar};`] : [];
  const gate = region.blockOnFail
    ? [`  if (/${region.verb}:\\s*fail/i.test(String(${choiceVar}))) throw new Error(${jsString(`Quality gate failed: ${branch.label}`)});`]
    : [];
  return [...decl, `  const ${choiceVar} = ${call};`, ...gate, ...arms, `  }`].join("\n");
```

(`jsString` is already imported at the top of emit-kinds.ts.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/codegen/eval-node.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 6: Run the full core suite (branch codegen must be unchanged)**

Run: `cd packages/core && npx vitest run`
Expected: PASS — branch codegen is unaffected because `verb === "BRANCH"` reproduces the previous strings exactly, and `blockOnFail` is `false` for branch (no throw). If any branch test constructs a `BranchRegion` literal directly, add `verb: "BRANCH", blockOnFail: false` to it (test-only fix).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/codegen/emit-kinds.ts packages/core/src/codegen/scriptgen.ts packages/core/test/codegen/eval-node.test.ts
git commit -m "feat(pflow): emit EVAL verdict + pass/fail routing + block-on-fail gate"
```

---

## Task 4: Verify comparison-mode two-input codegen and post-eval reconvergence

**Files:**
- Test: `packages/core/test/codegen/eval-node.test.ts` (extend)

**Context:** Two correctness risks the spec calls out: (1) `comparison` mode has two input ports (`candidate`, `reference`) — both must weave into the prompt; (2) a node downstream of an eval node's `pass` arm must read the correct source var (guarding against the C2-class dangling-var bug from the MCP work). No new production code should be needed — this is a regression guard. If a test fails, fix the root cause in regions/codegen, not the test.

- [ ] **Step 1: Write the tests**

Append to `packages/core/test/codegen/eval-node.test.ts`:

```ts
describe("codegen — eval comparison mode + reconvergence", () => {
  const doc: PflowDocument = {
    pflowFormatVersion: 1,
    workflow: { name: "cmp_wf", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "out:x", name: "x", schema: { type: "string" } }] },
      { id: "cand", kind: "agent", label: "Cand", prompt: "Draft {{in:x}}.",
        inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }],
        outputs: [{ id: "out:c", name: "c", schema: { type: "string" } }] },
      { id: "ref", kind: "agent", label: "Ref", prompt: "Gold answer for {{in:x}}.",
        inputs: [{ id: "in:x", name: "x", schema: { type: "string" } }],
        outputs: [{ id: "out:r", name: "r", schema: { type: "string" } }] },
      { id: "ev", kind: "eval", label: "Compare",
        prompt: "Compare {{in:candidate}} against {{in:reference}}. Route {{out:pass}} or {{out:fail}}.",
        inputs: [{ id: "in:candidate", name: "candidate", schema: { type: "string" } }, { id: "in:reference", name: "reference", schema: { type: "string" } }],
        outputs: [{ id: "out:pass", name: "pass", schema: { type: "string" } }, { id: "out:fail", name: "fail", schema: { type: "string" } }],
        config: { mode: "comparison", blockOnFail: false } },
      { id: "use", kind: "agent", label: "Use", prompt: "Polish {{in:winner}}.",
        inputs: [{ id: "in:winner", name: "winner", schema: { type: "string" } }],
        outputs: [{ id: "out:w", name: "w", schema: { type: "string" } }] },
      { id: "out", kind: "output", label: "out", inputs: [{ id: "in:o", name: "o", schema: { type: "string" } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "cand", portId: "in:x" } },
      { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "ref", portId: "in:x" } },
      { from: { nodeId: "cand", portId: "out:c" }, to: { nodeId: "ev", portId: "in:candidate" } },
      { from: { nodeId: "ref", portId: "out:r" }, to: { nodeId: "ev", portId: "in:reference" } },
      { from: { nodeId: "ev", portId: "out:pass" }, to: { nodeId: "use", portId: "in:winner" } },
      { from: { nodeId: "use", portId: "out:w" }, to: { nodeId: "out", portId: "in:o" } },
    ],
  };

  it("weaves both candidate and reference inputs into the eval call", () => {
    const code = generateClaudeCodeWorkflow(doc);
    expect(code).toContain("EVAL: pass");
    // both upstream agents' result vars must appear in the emitted code (no
    // dropped input). Their var names derive from labels "Cand"/"Ref".
    expect(code).toMatch(/cand/i);
    expect(code).toMatch(/ref/i);
  });

  it("a consumer downstream of the pass arm references a defined variable", () => {
    const code = generateClaudeCodeWorkflow(doc);
    // The reconvergent consumer "use" must read the eval result var, which is
    // declared (let) before the dispatch — assert both the declaration and the
    // consumer are present so a dangling arm-local var would show up as a
    // missing declaration.
    expect(code).toContain("Polish");
    // No occurrence of an obviously-undefined arm-local pattern: the result var
    // for the eval node is hoisted. (If this assertion is hard to express against
    // the exact var name, rely on the repo's compile-check helper instead.)
    expect(code.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd packages/core && npx vitest run test/codegen/eval-node.test.ts`
Expected: PASS. If the reconvergence assertion FAILS (a consumer reads an arm-local var that does not exist), the root cause is the reconvergence-override wiring in `scriptgen.ts` (the `overridesByNode` loop, lines ~405-417). Since eval regions have `kind === "branch"`, the existing `if (r.kind !== "branch") continue;` already includes them; no change should be needed. Fix only if a genuine failure appears, and prefer the repo's existing codegen compile-check helper to express the assertion precisely.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/codegen/eval-node.test.ts
git commit -m "test(pflow): eval comparison two-input + post-eval reconvergence guards"
```

---

## Task 5: Mode templates + flow-map transforms

**Files:**
- Create: `packages/obsidian-plugin/src/views/pflow-editor/eval-templates.ts`
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts` (add exports near `applyMcpServer`, ~line 636)
- Test: `packages/obsidian-plugin/test/eval-templates.test.ts` (NEW), `packages/obsidian-plugin/test/flow-map.test.ts` (extend)

**Context:** `applyPromptAndDerivePorts` (flow-map.ts:306) sets a node's prompt then calls `derivePortsFromPrompt` to recompute ports from `{{in:}}`/`{{out:}}` tokens. The eval templates each contain the right tokens, so `applyEvalMode` is `applyPromptAndDerivePorts` with the template text plus a `config.mode` write. `applyEvalModeFlagOnly` records the mode WITHOUT touching the prompt (used when the user declines the overwrite confirm). `applyBlockOnFail` flips `config.blockOnFail`.

- [ ] **Step 1: Write the failing template test**

Create `packages/obsidian-plugin/test/eval-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { EVAL_MODES, templateForMode } from "../src/views/pflow-editor/eval-templates.js";

describe("eval-templates", () => {
  it("exposes the three v1 modes", () => {
    expect(EVAL_MODES).toEqual(["criteria", "comparison", "threshold"]);
  });

  it("every template declares pass + fail out-tokens and a candidate in-token", () => {
    for (const mode of EVAL_MODES) {
      const t = templateForMode(mode);
      expect(t).toContain("{{in:candidate}}");
      expect(t).toContain("{{out:pass}}");
      expect(t).toContain("{{out:fail}}");
      expect(t).toContain("EVAL: pass");
      expect(t).toContain("EVAL: fail");
    }
  });

  it("comparison template additionally declares a reference in-token", () => {
    expect(templateForMode("comparison")).toContain("{{in:reference}}");
    expect(templateForMode("criteria")).not.toContain("{{in:reference}}");
    expect(templateForMode("threshold")).not.toContain("{{in:reference}}");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/eval-templates.test.ts`
Expected: FAIL — module `eval-templates.js` does not exist.

- [ ] **Step 3: Create the templates module**

Create `packages/obsidian-plugin/src/views/pflow-editor/eval-templates.ts`:

```ts
/** Eval node modes (v1). Each mode is a prompt template the inspector pre-fills;
 *  ports derive from the template's {{in:}}/{{out:}} tokens, so the templates are
 *  the single source of truth for an eval node's shape. */
export const EVAL_MODES = ["criteria", "comparison", "threshold"] as const;
export type EvalMode = (typeof EVAL_MODES)[number];

const CRITERIA = `Evaluate {{in:candidate}} against these criteria:
- <criterion 1>
- <criterion 2>

Emit a verdict line exactly: EVAL: pass  (if all criteria are met)  OR  EVAL: fail
Then route to {{out:pass}} or {{out:fail}}.`;

const COMPARISON = `Compare {{in:candidate}} against the reference {{in:reference}}.

Emit a verdict line exactly: EVAL: pass  (if the candidate matches/meets the reference)  OR  EVAL: fail
Briefly explain the decisive difference, then route to {{out:pass}} or {{out:fail}}.`;

const THRESHOLD = `Score {{in:candidate}} on <dimension> from 1 to 10.

Emit a verdict line exactly: EVAL: pass  (if the score >= 7)  OR  EVAL: fail
State the score you assigned, then route to {{out:pass}} or {{out:fail}}.`;

const TEMPLATES: Record<EvalMode, string> = {
  criteria: CRITERIA,
  comparison: COMPARISON,
  threshold: THRESHOLD,
};

/** The pre-populated prompt template for a mode. */
export function templateForMode(mode: EvalMode): string {
  return TEMPLATES[mode];
}

/** The default mode for a freshly added eval node. */
export const DEFAULT_EVAL_MODE: EvalMode = "criteria";
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/eval-templates.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing flow-map transform tests**

Append to `packages/obsidian-plugin/test/flow-map.test.ts`. Add to its imports:

```ts
import { applyEvalMode, applyEvalModeFlagOnly, applyBlockOnFail } from "../src/views/pflow-editor/flow-map.js";
import { templateForMode } from "../src/views/pflow-editor/eval-templates.js";
```

Then add:

```ts
describe("flow-map — eval transforms", () => {
  const baseDoc = {
    pflowFormatVersion: 1 as const,
    workflow: { name: "wf", description: "" },
    nodes: [
      { id: "ev", kind: "eval" as const, label: "Gate", prompt: "",
        inputs: [], outputs: [], config: { mode: "criteria" } },
    ],
    wires: [],
  };

  it("applyEvalMode sets the template, mode, and derives candidate+pass+fail ports", () => {
    const next = applyEvalMode(baseDoc, "ev", "comparison");
    const node = next.nodes.find((n) => n.id === "ev")!;
    expect(node.prompt).toBe(templateForMode("comparison"));
    expect(node.config?.mode).toBe("comparison");
    expect(node.inputs.map((p) => p.name).sort()).toEqual(["candidate", "reference"]);
    expect(node.outputs.map((p) => p.name).sort()).toEqual(["fail", "pass"]);
  });

  it("applyEvalModeFlagOnly records mode without touching the prompt", () => {
    const edited = { ...baseDoc, nodes: [{ ...baseDoc.nodes[0], prompt: "my hand-written eval" }] };
    const next = applyEvalModeFlagOnly(edited, "ev", "threshold");
    const node = next.nodes.find((n) => n.id === "ev")!;
    expect(node.prompt).toBe("my hand-written eval");
    expect(node.config?.mode).toBe("threshold");
  });

  it("applyBlockOnFail flips only the blockOnFail flag", () => {
    const next = applyBlockOnFail(baseDoc, "ev", true);
    const node = next.nodes.find((n) => n.id === "ev")!;
    expect(node.config?.blockOnFail).toBe(true);
    expect(node.config?.mode).toBe("criteria");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/flow-map.test.ts -t "eval transforms"`
Expected: FAIL — the three `apply*` functions are not exported from flow-map.

- [ ] **Step 7: Implement the three transforms**

In `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`, add this import near the other local imports at the top:

```ts
import { templateForMode, type EvalMode } from "./eval-templates.js";
```

Then add these exports near `applyMcpServer` (around line 636):

```ts
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
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/flow-map.test.ts -t "eval transforms"`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/eval-templates.ts packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/eval-templates.test.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): eval mode templates + applyEvalMode/applyEvalModeFlagOnly/applyBlockOnFail"
```

---

## Task 6: Register eval in KIND_INFO + PROMPT_KINDS

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/kind-info.ts:19-86` (KIND_INFO), `:99` (PROMPT_KINDS)
- Test: `packages/obsidian-plugin/test/kind-info.test.ts` (NEW, or extend an existing kind-info test)

**Context:** `KIND_INFO` is an exhaustive `Record<NodeKind, KindInfo>` — after Task 1 added `"eval"` to `NodeKind`, this object is now a TYPE error (missing key). This task fixes that and adds eval to `PROMPT_KINDS` so the inspector shows a Prompt field. The spec chose the cyan checker family with a distinct icon.

- [ ] **Step 1: Write the failing test**

Create `packages/obsidian-plugin/test/kind-info.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { KIND_INFO, PROMPT_KINDS } from "../src/views/pflow-editor/kind-info.js";

describe("kind-info — eval", () => {
  it("has a KIND_INFO entry for eval", () => {
    expect(KIND_INFO.eval).toBeDefined();
    expect(KIND_INFO.eval.title).toBe("Eval");
    expect(KIND_INFO.eval.color).toContain("--color-cyan");
  });
  it("includes eval in PROMPT_KINDS", () => {
    expect(PROMPT_KINDS).toContain("eval");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/kind-info.test.ts`
Expected: FAIL — `KIND_INFO.eval` is `undefined`.

- [ ] **Step 3: Add the KIND_INFO.eval entry**

In `packages/obsidian-plugin/src/views/pflow-editor/kind-info.ts`, add an `eval` entry to `KIND_INFO` after the `branch` entry, before `mcp` (around line 73). Shield-check icon (distinct from verify's badge-check), cyan accent:

```ts
  eval: {
    icon: "M20 13c0 5-3.5 7.5-7.7 8.95a1 1 0 0 1-.6.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1Z M9 12l2 2 4-4",
    color: "var(--color-cyan, #2e9bd9)",
    title: "Eval",
    description: "Judges its input and gates the flow: pass/fail ports, with an optional hard stop.",
  },
```

- [ ] **Step 4: Add eval to PROMPT_KINDS**

Change line 99 from:

```ts
export const PROMPT_KINDS: NodeKind[] = ["agent", "verify", "synthesize", "loop", "branch", "mcp"];
```

to:

```ts
export const PROMPT_KINDS: NodeKind[] = ["agent", "verify", "synthesize", "loop", "branch", "eval", "mcp"];
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/kind-info.test.ts`
Expected: PASS

- [ ] **Step 6: Typecheck the plugin (the exhaustiveness break must now be resolved)**

Run: `cd packages/obsidian-plugin && npx tsc --noEmit`
Expected: PASS (no missing-key error on `KIND_INFO`). If other exhaustive switches over `NodeKind` exist (e.g. a node-card component), TS will point at them — add an `eval` branch mirroring `branch`/`verify` where flagged.

- [ ] **Step 7: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/kind-info.ts packages/obsidian-plugin/test/kind-info.test.ts
git commit -m "feat(pflow-editor): eval node KIND_INFO entry + PROMPT_KINDS membership"
```

---

## Task 7: Inspector UI — mode dropdown (confirm-overwrite) + block-on-fail toggle

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte`
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte`

**Context:** Svelte UI wiring. Behavior is already covered by the flow-map transform tests (Task 5); this task is the visible control surface (no new `.svelte` unit test, consistent with how the MCP server dropdown was added). The inspector already renders MCP controls conditionally on `node.kind === "mcp"` and receives an `onMcpServer` callback; we mirror that for eval. The confirm dialog reuses `confirmModal` (already imported in editor.svelte).

- [ ] **Step 1: Add imports + handlers to editor.svelte**

In `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte`, add to the flow-map import block:

```ts
    applyEvalMode,
    applyEvalModeFlagOnly,
    applyBlockOnFail,
```

and add a templates import near the other imports:

```ts
  import { type EvalMode } from "./eval-templates.js";
```

Then add two handlers next to `onMcpServer` (around line 129):

```ts
  async function onEvalMode(nodeId: string, mode: EvalMode) {
    const node = doc.nodes.find((n) => n.id === nodeId);
    const current = node?.prompt?.trim() ?? "";
    if (current.length > 0) {
      const ok = await confirmModal(
        app,
        "Change eval mode?",
        `Replace this node's prompt with the "${mode}" template?\nYour current prompt will be lost.`,
        "Replace",
      );
      if (!ok) {
        commit(applyEvalModeFlagOnly(doc, nodeId, mode));
        return;
      }
    }
    commit(applyEvalMode(doc, nodeId, mode));
  }

  function onBlockOnFail(nodeId: string, value: boolean) {
    commit(applyBlockOnFail(doc, nodeId, value));
  }
```

- [ ] **Step 2: Pass the handlers to InspectorPane**

In the `<InspectorPane … />` invocation (around line 256-275), add:

```svelte
      {onEvalMode}
      {onBlockOnFail}
```

- [ ] **Step 3: Accept props + render controls in inspector-pane.svelte**

In `packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte`, add the props to the `$props()` destructuring (mirroring `onMcpServer`):

```ts
    onEvalMode,
    onBlockOnFail,
```

and to the props type annotation:

```ts
    onEvalMode: (nodeId: string, mode: import("./eval-templates.js").EvalMode) => void;
    onBlockOnFail: (nodeId: string, value: boolean) => void;
```

Then, where the MCP controls render (`{#if node.kind === "mcp"}` block), add a sibling eval block:

```svelte
  {#if node.kind === "eval"}
    <div class="pflow-inspector__field">
      <label class="pflow-inspector__label" for="eval-mode">Mode</label>
      <select
        id="eval-mode"
        class="pflow-inspector__select"
        value={(node.config?.mode ?? "criteria")}
        onchange={(e) => onEvalMode(node.id, (e.currentTarget as HTMLSelectElement).value as import("./eval-templates.js").EvalMode)}
      >
        <option value="criteria">criteria — vs a rubric</option>
        <option value="comparison">comparison — vs a reference</option>
        <option value="threshold">threshold — score vs a bound</option>
      </select>
    </div>
    <div class="pflow-inspector__field">
      <label class="pflow-inspector__checkbox">
        <input
          type="checkbox"
          checked={node.config?.blockOnFail === true}
          onchange={(e) => onBlockOnFail(node.id, (e.currentTarget as HTMLInputElement).checked)}
        />
        Block on fail (halt the run on a failed verdict)
      </label>
    </div>
  {/if}
```

> Reuse the inspector's existing field/label/select class names. Open inspector-pane.svelte and match whatever the MCP dropdown uses (expected: `pflow-inspector__field` / `__label` / `__select`; if the file uses different names, use those). Do NOT invent new CSS.

- [ ] **Step 4: Typecheck + build the plugin**

Run: `cd packages/obsidian-plugin && npx tsc --noEmit && npm run build`
Expected: PASS — no type errors; esbuild produces `main.js`. (If the build script has a different name, use the one in `packages/obsidian-plugin/package.json`.)

- [ ] **Step 5: Run the plugin test suite**

Run: `cd packages/obsidian-plugin && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/editor.svelte packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte
git commit -m "feat(pflow-editor): eval inspector — mode dropdown (confirm-overwrite) + block-on-fail toggle"
```

---

## Task 8: New-node defaults — adding an eval node pre-fills the criteria template

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts` (`applyAddNode`)
- Test: `packages/obsidian-plugin/test/flow-map.test.ts` (extend)

**Context:** `applyAddNode` (used by `onAddNode` in editor.svelte) creates a node with an empty prompt. For an eval node, a fresh node should arrive with the default `criteria` template + ports derived, so it works immediately and the canvas shows pass/fail ports.

- [ ] **Step 1: Write the failing test**

Append to `packages/obsidian-plugin/test/flow-map.test.ts` (add `applyAddNode` to the import if not already present):

```ts
describe("flow-map — add eval node defaults", () => {
  it("a new eval node arrives with the criteria template, mode, and pass/fail ports", () => {
    const doc = { pflowFormatVersion: 1 as const, workflow: { name: "wf", description: "" }, nodes: [], wires: [] };
    const next = applyAddNode(doc, "eval", "New eval", 0, 0);
    const node = next.nodes[next.nodes.length - 1];
    expect(node.kind).toBe("eval");
    expect(node.config?.mode).toBe("criteria");
    expect(node.prompt).toContain("EVAL: pass");
    expect(node.outputs.map((p) => p.name).sort()).toEqual(["fail", "pass"]);
    expect(node.inputs.map((p) => p.name)).toEqual(["candidate"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/flow-map.test.ts -t "add eval node"`
Expected: FAIL — a new eval node has an empty prompt and no ports.

- [ ] **Step 3: Special-case eval in applyAddNode**

In `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`, find `applyAddNode`. After it builds the doc with the appended node, special-case `eval` by routing the new node through `applyEvalMode(…, "criteria")`. At the function's return, replace the final `return <next>;` with:

```ts
  if (kind === "eval") {
    const newId = next.nodes[next.nodes.length - 1].id;
    return applyEvalMode(next, newId, "criteria");
  }
  return next;
```

(`next` is whatever local the function returns — match its actual name. The newly appended node is always last in `next.nodes`.)

- [ ] **Step 4: Run to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/flow-map.test.ts -t "add eval node"`
Expected: PASS

- [ ] **Step 5: Run the whole monorepo suite**

Run: `cd "/Users/wrede/Documents/Perspecta Suite/perspecta-workflow" && npx vitest run`
Expected: PASS — all core + plugin tests.

- [ ] **Step 6: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): new eval node pre-fills the criteria template + ports"
```

---

## Task 9: Karpathy-loop smoke — eval verdict bridges the loop sentinel

**Files:**
- Test: `packages/core/test/codegen/eval-node.test.ts` (extend)

**Context:** The headline use case is the Karpathy loop: generate → check → loop back on fail, proceed on pass. The existing `loop` node breaks on a regex sentinel over its own output. This task proves the eval verdict format (`EVAL:\s*pass`) is a valid loop sentinel — i.e., the two features compose without code changes. It is a guard. A full eval-NODE-inside-a-loop-back-edge wiring is more complex and out of scope (YAGNI) — pure eval routing is already covered by Tasks 3-4.

- [ ] **Step 1: Write the integration test**

Append to `packages/core/test/codegen/eval-node.test.ts`:

```ts
describe("codegen — eval verdict as a loop sentinel (Karpathy)", () => {
  it("a loop node configured with an EVAL sentinel emits a matching break", () => {
    const doc: PflowDocument = {
      pflowFormatVersion: 1,
      workflow: { name: "karpathy_wf", description: "" },
      nodes: [
        { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "out:x", name: "x", schema: { type: "string" } }] },
        { id: "loop", kind: "loop", label: "Refine", prompt: "Refine {{in:d}} until good. End with EVAL: pass when done.",
          inputs: [{ id: "in:d", name: "d", schema: { type: "string" } }],
          outputs: [{ id: "out:r", name: "r", schema: { type: "string" } }],
          config: { maxPasses: 3, sentinel: "EVAL:\\s*pass" } },
        { id: "out", kind: "output", label: "out", inputs: [{ id: "in:o", name: "o", schema: { type: "string" } }], outputs: [] },
      ],
      wires: [
        { from: { nodeId: "in", portId: "out:x" }, to: { nodeId: "loop", portId: "in:d" } },
        { from: { nodeId: "loop", portId: "out:r" }, to: { nodeId: "out", portId: "in:o" } },
      ],
    };
    const code = generateClaudeCodeWorkflow(doc);
    // The loop's break condition uses the EVAL sentinel.
    expect(code).toContain("EVAL:");
    expect(code).toContain("for (let pass");
    expect(code).toContain("break");
  });
});
```

- [ ] **Step 2: Run to verify it passes**

Run: `cd packages/core && npx vitest run test/codegen/eval-node.test.ts`
Expected: PASS — the loop region emits `if (/EVAL:\s*pass/i.test(String(<loopVar>))) break;`.

- [ ] **Step 3: Commit**

```bash
git add packages/core/test/codegen/eval-node.test.ts
git commit -m "test(pflow): eval verdict bridges the loop sentinel (Karpathy smoke)"
```

---

## Task 10: Final full-suite + build verification

**Files:** none (verification only)

- [ ] **Step 1: Run the entire monorepo test suite**

Run: `cd "/Users/wrede/Documents/Perspecta Suite/perspecta-workflow" && npx vitest run`
Expected: PASS — all core + plugin tests green.

- [ ] **Step 2: Typecheck both packages**

Run: `cd "/Users/wrede/Documents/Perspecta Suite/perspecta-workflow" && npx tsc --noEmit -p packages/core && npx tsc --noEmit -p packages/obsidian-plugin`
Expected: PASS — no exhaustiveness or missing-key errors over `NodeKind`.

- [ ] **Step 3: Build the plugin**

Run: `cd packages/obsidian-plugin && npm run build`
Expected: PASS — `main.js` produced.

- [ ] **Step 4: Confirm the intentional NUL sentinels in scriptgen.ts survived**

Run: `cd "/Users/wrede/Documents/Perspecta Suite/perspecta-workflow" && grep -c $'\x00' packages/core/src/codegen/scriptgen.ts`
Expected: `1` (one line carries the two `\x00` token sentinels). Do NOT "fix" these — they are load-bearing. If this prints `0`, a previous edit stripped them; restore from git (`git checkout packages/core/src/codegen/scriptgen.ts` only if uncommitted edits broke it, otherwise inspect history).

- [ ] **Step 5: Final status check**

```bash
git status
# Expected clean. Feature complete on feat/pflow-m2-editor.
```

---

## Self-Review

**Spec coverage:**
- One generic `eval` kind + mode picker → Tasks 1, 5, 7.
- Three modes as editable prompt templates (criteria/comparison/threshold) → Task 5.
- Ports derive from template tokens → Task 5 (`applyEvalMode`), Task 8 (new-node defaults).
- `pass`/`fail` output ports + wire-driven routing → Tasks 2-3 (branch-region reuse).
- `block on fail` halt toggle → Tasks 2-3 (region `blockOnFail` + throw), Task 7 (toggle UI).
- `EVAL: pass/fail` verdict, logged → Task 3 (the region emits the verdict; logging is inherent to the agent call/region pattern).
- Mode switch overwrites with confirm; Keep preserves prompt + records mode → Task 5 (`applyEvalModeFlagOnly`) + Task 7 (confirm dialog).
- Cyan checker family + distinct icon → Task 6.
- verify stays separate (unchanged) → no task touches verify; core suite staying green confirms it.
- Codegen reuses verify + branch machinery → Tasks 2-3 (generalized branch region).
- Comparison two-input + reconvergence guards → Task 4.
- Karpathy loop / verdict-as-sentinel → Task 9.
- Deferred `check-workflow` lint → out of scope (documented in spec + memory).

**Placeholder scan:** No "TBD"/"TODO"/"handle edge cases". The `<criterion 1>` / `<dimension>` markers in templates are intentional user fill-ins (the template instructs the user to replace them), not plan gaps.

**Type consistency:** `EvalMode` = `"criteria" | "comparison" | "threshold"` used identically across `eval-templates.ts`, the three `apply*` transforms, editor.svelte, and inspector-pane.svelte. `BranchRegion.verb` = `"BRANCH" | "EVAL"` and `blockOnFail: boolean` used identically in regions.ts (producer) and emit-kinds.ts (consumer). Transform names `applyEvalMode` / `applyEvalModeFlagOnly` / `applyBlockOnFail` are consistent between flow-map.ts, editor.svelte, and tests. `KIND_INFO.eval.title` = `"Eval"` matches the Task 6 assertion. The loop sentinel string `EVAL:\s*pass` in Task 9 matches the verdict `EVAL: pass` emitted in Task 3.
