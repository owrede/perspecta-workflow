# Pflow M1: Typed-Port IR + Claude Code Codegen — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the headless `@perspecta/core` foundation that validates a typed-port dataflow document (`.pflow` JSON) and deterministically compiles it to a native Claude Code dynamic workflow script.

**Architecture:** A Zod-defined IR (`PflowDocument`) with per-node typed input/output ports and data wires. Pure functions validate the graph (typed-port compatibility, balanced split/join regions, acyclic-except-bounded-loops), derive a topological control order, and emit a deterministic CC workflow `.js` string. A post-emit lint rejects non-deterministic / sandbox-illegal tokens. No Obsidian, no UI — all unit-testable in Vitest.

**Tech Stack:** TypeScript (ES2022, strict), Zod 4, Vitest 4. All work is in `packages/core`.

**Scope:** Milestone M1 from `docs/specs/2026-06-05-pflow-visual-workflow-compiler-design.md`. M2 (the Svelte Flow editor) is a separate plan that renders this proven IR. Deliverable: hand-author a `.pflow` JSON file and export a 100%-native CC workflow.

**Reference:** Read `docs/specs/2026-06-05-pflow-visual-workflow-compiler-design.md` sections 3 (IR), 4 (vocabulary), 6 (codegen) before starting.

---

## File Structure

All paths under `packages/core/`:

- `src/pflow/schema.ts` — Zod schemas + inferred TS types for the IR (`PortSchema`, `Port`, `PflowNode`, `Wire`, `PflowDocument`) and `parsePflow()`.
- `src/pflow/validate.ts` — `validatePflow(doc)` (typed-port + split/join + required-input rules) and `schemaCompatible`.
- `src/pflow/topo.ts` — `topoOrder(doc)` (dataflow -> control order) and wire/node helpers.
- `src/codegen/emit-lint.ts` — `lintEmittedScript(code)` (banned-token gate).
- `src/codegen/scriptgen.ts` — `generateClaudeCodeWorkflow(doc)` (IR -> CC `.js`) plus `renderMeta`, `jsString`.
- `src/index.ts` — barrel: add the new exports.
- `test/pflow/*.test.ts`, `test/codegen/*.test.ts` — Vitest suites.
- `test/fixtures/pflow/*.pflow` and `*.expected.js` — golden files.

Naming follows existing core conventions: pure functions, `{ ok, errors }` result shapes (mirroring `linter.ts`), `.js` extension on relative imports (ESM).

---

## Task 1: Add Zod dependency to core

**Files:** Modify `packages/core/package.json`

- [ ] **Step 1: Add the dependency.** Edit `packages/core/package.json` so `dependencies` reads (keep `yaml`):

```json
  "dependencies": {
    "yaml": "^2.9.0",
    "zod": "^4.4.3"
  }
```

(`^4.4.3` matches `packages/mcp-server/package.json` so the monorepo resolves one Zod.)

- [ ] **Step 2: Install.** Run: `npm install` — Expected: completes; `node_modules/zod` present at repo root.

- [ ] **Step 3: Verify Zod resolves.** Run: `node -e "import('zod').then(z => console.log(typeof z.z.object))"` — Expected: prints `function`.

- [ ] **Step 4: Commit.**

```bash
git add packages/core/package.json package-lock.json
git commit -m "build: add zod to @perspecta/core for the pflow IR"
```

---

## Task 2: PortSchema — the per-port type

**Files:** Create `packages/core/src/pflow/schema.ts`; Test `packages/core/test/pflow/schema.test.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/pflow/schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { PortSchemaZ } from "../../src/pflow/schema.js";

describe("PortSchema", () => {
  it("accepts a scalar type", () => {
    expect(PortSchemaZ.parse({ type: "string" })).toEqual({ type: "string" });
  });
  it("accepts an array with item type", () => {
    const s = { type: "array", items: { type: "string" } };
    expect(PortSchemaZ.parse(s)).toEqual(s);
  });
  it("accepts a nested object schema", () => {
    const s = { type: "object", properties: { title: { type: "string" }, n: { type: "number" } }, required: ["title"] };
    expect(PortSchemaZ.parse(s)).toEqual(s);
  });
  it("rejects an unknown type", () => {
    expect(() => PortSchemaZ.parse({ type: "blob" })).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/pflow/schema.test.ts` — Expected: FAIL, cannot find module.

- [ ] **Step 3: Write minimal implementation.** Create `packages/core/src/pflow/schema.ts`:

```ts
import { z } from "zod";

/** JSON-Schema-like description of a port value. Recursive. Reused verbatim as
 *  the agent({ schema }) argument at codegen time. */
export type PortSchema =
  | { type: "string" | "number" | "boolean" | "any" }
  | { type: "array"; items?: PortSchema }
  | { type: "object"; properties?: Record<string, PortSchema>; required?: string[] };

export const PortSchemaZ: z.ZodType<PortSchema> = z.lazy(() =>
  z.union([
    z.object({ type: z.enum(["string", "number", "boolean", "any"]) }),
    z.object({ type: z.literal("array"), items: PortSchemaZ.optional() }),
    z.object({
      type: z.literal("object"),
      properties: z.record(z.string(), PortSchemaZ).optional(),
      required: z.array(z.string()).optional(),
    }),
  ]),
);
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/pflow/schema.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/pflow/schema.ts packages/core/test/pflow/schema.test.ts
git commit -m "feat(pflow): add PortSchema typed-port value descriptor"
```

---

## Task 3: Port, PflowNode, Wire, PflowDocument schemas + parsePflow

**Files:** Modify `packages/core/src/pflow/schema.ts`; extend `packages/core/test/pflow/schema.test.ts`

- [ ] **Step 1: Write the failing test (append).** Append to `packages/core/test/pflow/schema.test.ts`:

```ts
import { parsePflow, NODE_KINDS } from "../../src/pflow/schema.js";

const MINIMAL = {
  pflowFormatVersion: 1,
  workflow: { name: "demo", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "args", schema: { type: "any" } }] },
    { id: "out", kind: "output", label: "Output", inputs: [{ id: "i", name: "result", schema: { type: "any" } }], outputs: [] },
  ],
  wires: [{ from: { nodeId: "in", portId: "o" }, to: { nodeId: "out", portId: "i" } }],
  editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
};

describe("parsePflow", () => {
  it("parses a minimal valid document", () => {
    const doc = parsePflow(JSON.stringify(MINIMAL));
    expect(doc.workflow.name).toBe("demo");
    expect(doc.nodes).toHaveLength(2);
    expect(doc.wires[0].from.nodeId).toBe("in");
  });
  it("throws on malformed JSON", () => {
    expect(() => parsePflow("{not json")).toThrow();
  });
  it("throws when a node kind is unknown", () => {
    const bad = { ...MINIMAL, nodes: [{ id: "x", kind: "frobnicate", label: "X", inputs: [], outputs: [] }] };
    expect(() => parsePflow(JSON.stringify(bad))).toThrow();
  });
  it("exposes the full node-kind vocabulary", () => {
    expect(NODE_KINDS).toContain("split");
    expect(NODE_KINDS).toContain("join");
    expect(NODE_KINDS).toContain("verify");
    expect(NODE_KINDS).toContain("script");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/pflow/schema.test.ts` — Expected: FAIL, `parsePflow`/`NODE_KINDS` not exported.

- [ ] **Step 3: Write minimal implementation (append to schema.ts).**

```ts
/** Full node vocabulary (spec section 4). */
export const NODE_KINDS = [
  "input", "output", "agent",
  "split", "join",
  "loop", "verify", "synthesize", "branch",
  "script",
] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export const PortZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  schema: PortSchemaZ,
  required: z.boolean().optional(),
});
export type Port = z.infer<typeof PortZ>;

export const PflowNodeZ = z.object({
  id: z.string().min(1),
  kind: z.enum(NODE_KINDS),
  label: z.string(),
  prompt: z.string().optional(),
  inputs: z.array(PortZ),
  outputs: z.array(PortZ),
  phase: z.string().optional(),
  log: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});
export type PflowNode = z.infer<typeof PflowNodeZ>;

export const WireZ = z.object({
  from: z.object({ nodeId: z.string(), portId: z.string() }),
  to: z.object({ nodeId: z.string(), portId: z.string() }),
});
export type Wire = z.infer<typeof WireZ>;

export const PflowDocumentZ = z.object({
  pflowFormatVersion: z.literal(1),
  workflow: z.object({
    name: z.string().min(1),
    description: z.string(),
    args: PortSchemaZ.optional(),
  }),
  nodes: z.array(PflowNodeZ),
  wires: z.array(WireZ),
  editor: z
    .object({
      viewport: z.object({ x: z.number(), y: z.number(), zoom: z.number() }),
      nodePositions: z.array(
        z.object({
          nodeId: z.string(),
          x: z.number(),
          y: z.number(),
          width: z.number().optional(),
          height: z.number().optional(),
        }),
      ),
    })
    .optional(),
});
export type PflowDocument = z.infer<typeof PflowDocumentZ>;

/** Parse + validate a .pflow file's JSON text. Throws ZodError / SyntaxError. */
export function parsePflow(text: string): PflowDocument {
  return PflowDocumentZ.parse(JSON.parse(text));
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/pflow/schema.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/pflow/schema.ts packages/core/test/pflow/schema.test.ts
git commit -m "feat(pflow): add Port/Node/Wire/Document schemas and parsePflow"
```

---

## Task 4: Topological control order + node/wire helpers

**Files:** Create `packages/core/src/pflow/topo.ts`; Test `packages/core/test/pflow/topo.test.ts`

`topoOrder` derives execution order from data wires and must be deterministic: ready-set ties broken by declared node order (index in `doc.nodes`). Cycles throw (the bounded-`loop` back-edge is handled by validate/codegen later, not here).

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/pflow/topo.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { topoOrder, nodeById, outWires, inWires } from "../../src/pflow/topo.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function doc(nodes: string[], wires: [string, string][]): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "t", description: "" },
    nodes: nodes.map((id) => ({ id, kind: "agent", label: id, inputs: [{ id: "i", name: "i", schema: { type: "any" } }], outputs: [{ id: "o", name: "o", schema: { type: "any" } }] })),
    wires: wires.map(([f, t]) => ({ from: { nodeId: f, portId: "o" }, to: { nodeId: t, portId: "i" } })),
  } as PflowDocument;
}

describe("topoOrder", () => {
  it("orders a linear chain", () => {
    expect(topoOrder(doc(["a", "b", "c"], [["a", "b"], ["b", "c"]]))).toEqual(["a", "b", "c"]);
  });
  it("breaks ties by declared node order", () => {
    expect(topoOrder(doc(["a", "b", "c"], [["a", "b"], ["a", "c"]]))).toEqual(["a", "b", "c"]);
  });
  it("throws on a cycle", () => {
    expect(() => topoOrder(doc(["a", "b"], [["a", "b"], ["b", "a"]]))).toThrow(/cycle/i);
  });
});

describe("graph helpers", () => {
  const d = doc(["a", "b"], [["a", "b"]]);
  it("nodeById finds a node", () => { expect(nodeById(d, "a")?.label).toBe("a"); });
  it("outWires returns outgoing wires", () => { expect(outWires(d, "a")).toHaveLength(1); });
  it("inWires returns incoming wires", () => { expect(inWires(d, "b")).toHaveLength(1); });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/pflow/topo.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation.** Create `packages/core/src/pflow/topo.ts`:

```ts
import type { PflowDocument, PflowNode, Wire } from "./schema.js";

export function nodeById(doc: PflowDocument, id: string): PflowNode | undefined {
  return doc.nodes.find((n) => n.id === id);
}
export function outWires(doc: PflowDocument, nodeId: string): Wire[] {
  return doc.wires.filter((w) => w.from.nodeId === nodeId);
}
export function inWires(doc: PflowDocument, nodeId: string): Wire[] {
  return doc.wires.filter((w) => w.to.nodeId === nodeId);
}

/** Deterministic topological order of node ids from data wires. Ready-set ties
 *  broken by declared order. Throws on a cycle (non-loop cycles are authoring
 *  errors; bounded loops handled by validate/codegen). */
export function topoOrder(doc: PflowDocument): string[] {
  const order = doc.nodes.map((n) => n.id);
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const indegree = new Map(order.map((id) => [id, 0] as const));
  for (const w of doc.wires) {
    indegree.set(w.to.nodeId, (indegree.get(w.to.nodeId) ?? 0) + 1);
  }
  const ready = order.filter((id) => (indegree.get(id) ?? 0) === 0);
  const result: string[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => (rank.get(a)! - rank.get(b)!));
    const id = ready.shift()!;
    result.push(id);
    for (const w of outWires(doc, id)) {
      const t = w.to.nodeId;
      const next = (indegree.get(t) ?? 0) - 1;
      indegree.set(t, next);
      if (next === 0) ready.push(t);
    }
  }
  if (result.length !== order.length) {
    throw new Error("pflow graph has a cycle (outside a bounded loop region)");
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/pflow/topo.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/pflow/topo.ts packages/core/test/pflow/topo.test.ts
git commit -m "feat(pflow): deterministic topological order and wire helpers"
```

---

## Task 5: Port-schema compatibility check

**Files:** Create `packages/core/src/pflow/validate.ts`; Test `packages/core/test/pflow/compat.test.ts`

M1 compatibility is intentionally shallow (spec section 9): `any` joins anything; same scalar `type` joins; `array` requires matching `items.type`; object joins object.

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/pflow/compat.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { schemaCompatible } from "../../src/pflow/validate.js";

describe("schemaCompatible", () => {
  it("any joins anything", () => {
    expect(schemaCompatible({ type: "any" }, { type: "string" })).toBe(true);
    expect(schemaCompatible({ type: "number" }, { type: "any" })).toBe(true);
  });
  it("same scalar type joins", () => {
    expect(schemaCompatible({ type: "string" }, { type: "string" })).toBe(true);
  });
  it("different scalar types do not join", () => {
    expect(schemaCompatible({ type: "string" }, { type: "number" })).toBe(false);
  });
  it("arrays must share item type", () => {
    expect(schemaCompatible({ type: "array", items: { type: "string" } }, { type: "array", items: { type: "string" } })).toBe(true);
    expect(schemaCompatible({ type: "array", items: { type: "string" } }, { type: "array", items: { type: "number" } })).toBe(false);
  });
  it("array items default to any when omitted", () => {
    expect(schemaCompatible({ type: "array" }, { type: "array", items: { type: "string" } })).toBe(true);
  });
  it("object joins object (shallow)", () => {
    expect(schemaCompatible({ type: "object" }, { type: "object", properties: {} })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/pflow/compat.test.ts` — Expected: FAIL, not exported.

- [ ] **Step 3: Write minimal implementation.** Create `packages/core/src/pflow/validate.ts`:

```ts
import type { PortSchema } from "./schema.js";

/** Shallow M1 port-compatibility (spec section 9). `any` joins anything;
 *  scalars must match exactly; arrays must agree on item type (missing items ===
 *  any); objects join objects without deep property subtyping. */
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
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/pflow/compat.test.ts` — Expected: PASS (6 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/pflow/validate.ts packages/core/test/pflow/compat.test.ts
git commit -m "feat(pflow): shallow port-schema compatibility check"
```

---

## Task 6: validatePflow — wires, required inputs, dangling ports

**Files:** Modify `packages/core/src/pflow/validate.ts`; Test `packages/core/test/pflow/validate.test.ts`

Result shape mirrors `linter.ts` (`{ ok, errors: { rule, message, nodeId? }[] }`).

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/pflow/validate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePflow } from "../../src/pflow/validate.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function base(): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "t", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
      { id: "ag", kind: "agent", label: "ag", prompt: "do", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "res", schema: { type: "string" } }] },
      { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "res", schema: { type: "string" }, required: true }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "i" } },
      { from: { nodeId: "ag", portId: "r" }, to: { nodeId: "out", portId: "i" } },
    ],
  };
}

describe("validatePflow", () => {
  it("passes a well-formed document", () => {
    expect(validatePflow(base()).ok).toBe(true);
  });
  it("flags a required input with no incoming wire", () => {
    const d = base();
    d.wires = d.wires.filter((w) => w.to.nodeId !== "ag");
    const r = validatePflow(d);
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "required-input-unwired" && e.nodeId === "ag")).toBe(true);
  });
  it("flags a wire to a missing node", () => {
    const d = base();
    d.wires.push({ from: { nodeId: "ag", portId: "r" }, to: { nodeId: "ghost", portId: "i" } });
    expect(validatePflow(d).errors.some((e) => e.rule === "wire-missing-node")).toBe(true);
  });
  it("flags a wire to a missing port", () => {
    const d = base();
    d.wires.push({ from: { nodeId: "ag", portId: "nope" }, to: { nodeId: "out", portId: "i" } });
    expect(validatePflow(d).errors.some((e) => e.rule === "wire-missing-port")).toBe(true);
  });
  it("flags incompatible wired schemas", () => {
    const d = base();
    d.nodes[1].outputs[0].schema = { type: "number" };
    expect(validatePflow(d).errors.some((e) => e.rule === "wire-type-mismatch")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/pflow/validate.test.ts` — Expected: FAIL, `validatePflow` not exported.

- [ ] **Step 3: Write minimal implementation (append to validate.ts).**

```ts
import type { PflowDocument, Port } from "./schema.js";
import { nodeById, inWires } from "./topo.js";

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

  return { ok: errors.length === 0, errors };
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/pflow/` — Expected: PASS (validate + compat, no regression).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/pflow/validate.ts packages/core/test/pflow/validate.test.ts
git commit -m "feat(pflow): validate wires, ports, and required inputs"
```

---

## Task 7: Split/join region validation

**Files:** Modify `packages/core/src/pflow/validate.ts`; Test `packages/core/test/pflow/regions.test.ts`

Rules (spec section 4): split/join counts must be equal; every `split` has an array-typed input; a `join` must be reachable downstream of its `split`. Full nesting analysis is deferred; these catch the common authoring mistakes.

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/pflow/regions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { validatePflow } from "../../src/pflow/validate.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

function withRegion(opts: { joinKind?: "join" | "output"; splitInput?: "array" | "string" }): PflowDocument {
  const splitInput = opts.splitInput ?? "array";
  return {
    pflowFormatVersion: 1,
    workflow: { name: "t", description: "" },
    nodes: [
      { id: "in", kind: "input", label: "in", inputs: [], outputs: [{ id: "o", name: "items", schema: { type: "array", items: { type: "string" } } }] },
      { id: "sp", kind: "split", label: "sp", inputs: [{ id: "i", name: "items", schema: splitInput === "array" ? { type: "array", items: { type: "string" } } : { type: "string" } }], outputs: [{ id: "item", name: "item", schema: { type: "string" } }] },
      { id: "work", kind: "agent", label: "work", prompt: "p", inputs: [{ id: "i", name: "item", schema: { type: "string" } }], outputs: [{ id: "r", name: "r", schema: { type: "string" } }] },
      { id: "jn", kind: opts.joinKind ?? "join", label: "jn", inputs: [{ id: "i", name: "r", schema: { type: "string" } }], outputs: [{ id: "all", name: "all", schema: { type: "array", items: { type: "string" } } }] },
      { id: "out", kind: "output", label: "out", inputs: [{ id: "i", name: "all", schema: { type: "array", items: { type: "string" } } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "o" }, to: { nodeId: "sp", portId: "i" } },
      { from: { nodeId: "sp", portId: "item" }, to: { nodeId: "work", portId: "i" } },
      { from: { nodeId: "work", portId: "r" }, to: { nodeId: "jn", portId: "i" } },
      { from: { nodeId: "jn", portId: "all" }, to: { nodeId: "out", portId: "i" } },
    ],
  };
}

describe("split/join regions", () => {
  it("accepts a balanced region", () => {
    expect(validatePflow(withRegion({})).ok).toBe(true);
  });
  it("rejects a split whose input is not an array", () => {
    expect(validatePflow(withRegion({ splitInput: "string" })).errors.some((e) => e.rule === "split-needs-array" && e.nodeId === "sp")).toBe(true);
  });
  it("rejects an unbalanced split with no join", () => {
    expect(validatePflow(withRegion({ joinKind: "output" })).errors.some((e) => e.rule === "split-join-unbalanced")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/pflow/regions.test.ts` — Expected: FAIL on the two negative cases.

- [ ] **Step 3: Write minimal implementation.** In `validate.ts`, insert this block inside `validatePflow` immediately before `return { ok: errors.length === 0, errors };`:

```ts
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
```

Then add this helper at the end of `validate.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/pflow/` — Expected: PASS (all pflow suites green).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/pflow/validate.ts packages/core/test/pflow/regions.test.ts
git commit -m "feat(pflow): validate split/join region balance and array fan-out"
```

---

## Task 8: Emit-lint — banned-token gate

**Files:** Create `packages/core/src/codegen/emit-lint.ts`; Test `packages/core/test/codegen/emit-lint.test.ts`

Protects the resume-cache + sandbox contracts (spec section 6.4). Hard gate.

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/codegen/emit-lint.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { lintEmittedScript } from "../../src/codegen/emit-lint.js";

describe("lintEmittedScript", () => {
  it("passes clean deterministic code", () => {
    const r = lintEmittedScript("const x = await agent('hi');\nreturn x;\n");
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it.each([
    ["Date.now()", "Date.now"],
    ["Math.random()", "Math.random"],
    ["new Date()", "new Date"],
    ["require('fs')", "require"],
    ["await fetch('http://x')", "fetch"],
    ["fs.readFileSync('x')", "fs."],
    ["await import('node:fs')", "import("],
  ])("rejects %s", (snippet, token) => {
    const r = lintEmittedScript(`const v = ${snippet};\n`);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.token === token)).toBe(true);
  });
  it("allows new Date(arg) with an argument", () => {
    expect(lintEmittedScript("const d = new Date(args.iso);\n").ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/codegen/emit-lint.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation.** Create `packages/core/src/codegen/emit-lint.ts`:

```ts
export interface EmitViolation { token: string; index: number; }
export interface EmitLintResult { ok: boolean; violations: EmitViolation[]; }

/** Banned tokens that would break the resume-cache (non-determinism) or the
 *  sandbox (fs/shell/network/require). `new Date(` is banned only when argless. */
const BANNED: { token: string; re: RegExp }[] = [
  { token: "Date.now", re: /\bDate\.now\b/ },
  { token: "Math.random", re: /\bMath\.random\b/ },
  { token: "new Date", re: /\bnew\s+Date\s*\(\s*\)/ },
  { token: "require", re: /\brequire\s*\(/ },
  { token: "import(", re: /\bimport\s*\(/ },
  { token: "fetch", re: /\bfetch\s*\(/ },
  { token: "fs.", re: /\bfs\./ },
];

/** Scan emitted workflow code for non-deterministic / sandbox-illegal tokens.
 *  A hit must FAIL the export (spec section 6.4). */
export function lintEmittedScript(code: string): EmitLintResult {
  const violations: EmitViolation[] = [];
  for (const { token, re } of BANNED) {
    const m = re.exec(code);
    if (m) violations.push({ token, index: m.index });
  }
  return { ok: violations.length === 0, violations };
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/codegen/emit-lint.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/codegen/emit-lint.ts packages/core/test/codegen/emit-lint.test.ts
git commit -m "feat(codegen): banned-token emit-lint gate"
```

---

## Task 9: scriptgen — meta literal + string escaping

**Files:** Create `packages/core/src/codegen/scriptgen.ts`; Test `packages/core/test/codegen/meta.test.ts`

Build `meta` as a serialized literal (spec section 6.2).

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/codegen/meta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderMeta, jsString } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

describe("jsString", () => {
  it("escapes quotes, backslashes, and newlines", () => {
    expect(jsString(`a"b\\c\nd`)).toBe(`"a\\"b\\\\c\\nd"`);
  });
});

describe("renderMeta", () => {
  it("emits a pure-literal meta with phases", () => {
    const doc = {
      pflowFormatVersion: 1,
      workflow: { name: "audit", description: "Audit endpoints" },
      nodes: [
        { id: "a", kind: "agent", label: "a", phase: "Scan", inputs: [], outputs: [] },
        { id: "b", kind: "agent", label: "b", phase: "Verify", inputs: [], outputs: [] },
      ],
      wires: [],
    } as unknown as PflowDocument;
    const out = renderMeta(doc);
    expect(out).toContain("export const meta = {");
    expect(out).toContain('name: "audit"');
    expect(out).toContain('description: "Audit endpoints"');
    expect(out).toContain('{ title: "Scan" }');
    expect(out).toContain('{ title: "Verify" }');
    expect(out).not.toContain("${");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/codegen/meta.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Write minimal implementation.** Create `packages/core/src/codegen/scriptgen.ts`:

```ts
import type { PflowDocument } from "../pflow/schema.js";

/** JSON.stringify yields a spec-compliant double-quoted JS string literal with
 *  correct escaping of quotes, backslashes, and control chars. */
export function jsString(value: string): string {
  return JSON.stringify(value);
}

/** Render `export const meta = {...}` as a pure literal (spec section 6.2).
 *  Phases are the distinct, declaration-ordered `phase` annotations on nodes. */
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
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/codegen/meta.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/codegen/scriptgen.ts packages/core/test/codegen/meta.test.ts
git commit -m "feat(codegen): render pure-literal meta block and JS string escaping"
```

---

## Task 10: scriptgen — full body emission for the linear subset

**Files:** Modify `packages/core/src/codegen/scriptgen.ts`; Test `packages/core/test/codegen/scriptgen.test.ts`

M1 emits the linear core subset: `input` -> `agent`(s) -> `output`. Fan-out/loop/verify codegen are deferred; split/join/loop/verify/synthesize/branch nodes throw a clear "not yet supported" error so an unsupported export fails loudly.

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/codegen/scriptgen.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

const LINEAR: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "summarize", description: "Summarize a topic" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "research", kind: "agent", label: "Research", phase: "Research", prompt: "Research the topic thoroughly.", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "notes", schema: { type: "string" } }] },
    { id: "out", kind: "output", label: "Output", inputs: [{ id: "i", name: "notes", schema: { type: "string" }, required: true }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "research", portId: "i" } },
    { from: { nodeId: "research", portId: "r" }, to: { nodeId: "out", portId: "i" } },
  ],
};

describe("generateClaudeCodeWorkflow", () => {
  it("emits a runnable linear workflow", () => {
    const code = generateClaudeCodeWorkflow(LINEAR);
    expect(code).toContain("export const meta = {");
    expect(code).toContain("await agent(");
    expect(code).toContain('"Research the topic thoroughly."');
    expect(code).toContain("return");
  });
  it("is deterministic — identical output across two emissions", () => {
    expect(generateClaudeCodeWorkflow(LINEAR)).toBe(generateClaudeCodeWorkflow(LINEAR));
  });
  it("passes its own emit-lint (does not throw)", () => {
    expect(() => generateClaudeCodeWorkflow(LINEAR)).not.toThrow();
  });
  it("throws a clear error when a required input is unwired", () => {
    const bad = structuredClone(LINEAR);
    bad.wires = bad.wires.filter((w) => w.to.nodeId !== "research");
    expect(() => generateClaudeCodeWorkflow(bad)).toThrow(/validation/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/codegen/scriptgen.test.ts` — Expected: FAIL, `generateClaudeCodeWorkflow` not exported.

- [ ] **Step 3: Write minimal implementation (append to scriptgen.ts).**

```ts
import { topoOrder, inWires, nodeById } from "../pflow/topo.js";
import { validatePflow } from "../pflow/validate.js";
import { lintEmittedScript } from "./emit-lint.js";
import type { PflowNode } from "../pflow/schema.js";

/** A safe JS identifier for a node's output variable. */
function varName(node: PflowNode): string {
  const base = (node.label || node.id).replace(/[^A-Za-z0-9_]/g, "_").replace(/^([0-9])/, "_$1");
  return `${base}_${node.id}`.replace(/[^A-Za-z0-9_]/g, "_");
}

/** The source variable feeding a node's single input (linear subset). */
function inputVar(doc: PflowDocument, node: PflowNode): string {
  const wires = inWires(doc, node.id);
  if (wires.length === 0) return "args";
  const src = nodeById(doc, wires[0].from.nodeId)!;
  return src.kind === "input" ? "args" : varName(src);
}

function emitNode(doc: PflowDocument, node: PflowNode): string {
  switch (node.kind) {
    case "input":
      return "";
    case "agent": {
      const v = varName(node);
      const prompt = jsString(node.prompt ?? node.label);
      const label = jsString(node.label);
      return `  const ${v} = await agent(${prompt}, { label: ${label} });`;
    }
    case "output": {
      const v = inputVar(doc, node);
      return `  return ${v};`;
    }
    case "split":
    case "join":
    case "loop":
    case "verify":
    case "synthesize":
    case "branch":
      throw new Error(`scriptgen M1: node kind "${node.kind}" (node ${node.id}) is not yet supported by the Claude Code emitter`);
    case "script":
      return `  // script node ${node.id}\n${(node.config?.body as string) ?? ""}`;
  }
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
  const order = topoOrder(doc);
  const header = `// Generated by Perspecta Workflow from ${doc.workflow.name}.pflow — do not hand-edit.`;
  const body = order
    .map((id) => emitNode(doc, nodeById(doc, id)!))
    .filter((line) => line.length > 0)
    .join("\n");
  const code = [header, "", renderMeta(doc), "", body, ""].join("\n");

  const lint = lintEmittedScript(code);
  if (!lint.ok) {
    const msg = lint.violations.map((v) => `  - banned token "${v.token}" at index ${v.index}`).join("\n");
    throw new Error(`emit-lint failed (non-deterministic or sandbox-illegal output):\n${msg}`);
  }
  return code;
}
```

- [ ] **Step 4: Run test to verify it passes.** Run: `cd packages/core && npx vitest run test/codegen/scriptgen.test.ts` — Expected: PASS (4 tests).

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/codegen/scriptgen.ts packages/core/test/codegen/scriptgen.test.ts
git commit -m "feat(codegen): emit deterministic linear Claude Code workflow"
```

---

## Task 11: Golden-file test (fixture .pflow -> expected .js)

**Files:** Create `packages/core/test/fixtures/pflow/summarize.pflow`, `summarize.expected.js`; Test `packages/core/test/codegen/golden.test.ts`

Locks byte-exact output; the regression guard against silent format drift (spec sections 6.3, 9).

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/codegen/golden.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePflow } from "../../src/pflow/schema.js";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "pflow");

describe("golden: summarize", () => {
  it("emits byte-identical expected output", () => {
    const doc = parsePflow(readFileSync(join(FIX, "summarize.pflow"), "utf8"));
    const expected = readFileSync(join(FIX, "summarize.expected.js"), "utf8");
    expect(generateClaudeCodeWorkflow(doc)).toBe(expected);
  });
});
```

- [ ] **Step 2: Create the fixture .pflow.** Create `packages/core/test/fixtures/pflow/summarize.pflow`:

```json
{
  "pflowFormatVersion": 1,
  "workflow": { "name": "summarize", "description": "Summarize a topic" },
  "nodes": [
    { "id": "in", "kind": "input", "label": "Input", "inputs": [], "outputs": [{ "id": "o", "name": "topic", "schema": { "type": "string" } }] },
    { "id": "research", "kind": "agent", "label": "Research", "phase": "Research", "prompt": "Research the topic thoroughly.", "inputs": [{ "id": "i", "name": "topic", "schema": { "type": "string" }, "required": true }], "outputs": [{ "id": "r", "name": "notes", "schema": { "type": "string" } }] },
    { "id": "out", "kind": "output", "label": "Output", "inputs": [{ "id": "i", "name": "notes", "schema": { "type": "string" }, "required": true }], "outputs": [] }
  ],
  "wires": [
    { "from": { "nodeId": "in", "portId": "o" }, "to": { "nodeId": "research", "portId": "i" } },
    { "from": { "nodeId": "research", "portId": "r" }, "to": { "nodeId": "out", "portId": "i" } }
  ]
}
```

- [ ] **Step 3: Generate the expected file, then read it to confirm.** Run a one-off generator that writes the exact emitted text (uses tsx to run the TypeScript source directly):

```bash
cd packages/core && npx tsx --eval "import('./src/pflow/schema.ts').then(async (s)=>{const {generateClaudeCodeWorkflow}=await import('./src/codegen/scriptgen.ts');const {readFileSync,writeFileSync}=await import('node:fs');const doc=s.parsePflow(readFileSync('test/fixtures/pflow/summarize.pflow','utf8'));writeFileSync('test/fixtures/pflow/summarize.expected.js', generateClaudeCodeWorkflow(doc));})"
```

Then **read** `packages/core/test/fixtures/pflow/summarize.expected.js` and confirm it contains: the `// Generated by Perspecta Workflow` header, `export const meta = {`, `{ title: "Research" }`, `await agent("Research the topic thoroughly.", { label: "Research" });`, and `return Research_research;` — and no `${`, no `Date.now`.

- [ ] **Step 4: Run the golden test.** Run: `cd packages/core && npx vitest run test/codegen/golden.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/test/fixtures/pflow/summarize.pflow packages/core/test/fixtures/pflow/summarize.expected.js packages/core/test/codegen/golden.test.ts
git commit -m "test(codegen): golden-file lock for linear workflow output"
```

---

## Task 12: Barrel exports + full build/test gate

**Files:** Modify `packages/core/src/index.ts`; Test `packages/core/test/pflow/exports.test.ts`

- [ ] **Step 1: Write the failing test.** Create `packages/core/test/pflow/exports.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as core from "../../src/index.js";

describe("public API surface", () => {
  it("re-exports the pflow IR and codegen", () => {
    expect(typeof core.parsePflow).toBe("function");
    expect(typeof core.validatePflow).toBe("function");
    expect(typeof core.topoOrder).toBe("function");
    expect(typeof core.generateClaudeCodeWorkflow).toBe("function");
    expect(typeof core.lintEmittedScript).toBe("function");
    expect(core.NODE_KINDS).toContain("split");
  });
});
```

- [ ] **Step 2: Run test to verify it fails.** Run: `cd packages/core && npx vitest run test/pflow/exports.test.ts` — Expected: FAIL, `core.parsePflow` undefined.

- [ ] **Step 3: Add the exports.** In `packages/core/src/index.ts`, add after the existing export lines:

```ts
export * from "./pflow/schema.js";
export * from "./pflow/validate.js";
export * from "./pflow/topo.js";
export * from "./codegen/emit-lint.js";
export * from "./codegen/scriptgen.js";
```

- [ ] **Step 4: Run test + full suite + build.**

Run: `cd packages/core && npx vitest run test/pflow/exports.test.ts` — Expected: PASS.
Run from repo root: `npm test` — Expected: all suites pass (existing 139 + new).
Run from repo root: `npm run build` — Expected: all three workspaces compile, no TS errors.

- [ ] **Step 5: Commit.**

```bash
git add packages/core/src/index.ts packages/core/test/pflow/exports.test.ts
git commit -m "feat(core): export pflow IR and Claude Code codegen from barrel"
```

---

## Done criteria

- [ ] `npm test` green (existing + new suites).
- [ ] `npm run build` clean across all workspaces.
- [ ] A hand-authored `.pflow` JSON file compiles via `generateClaudeCodeWorkflow` to a deterministic CC workflow script that passes emit-lint.
- [ ] Golden-file test locks byte-exact output.
- [ ] No banned token can reach emitted output (proven by tests).

Delivers the M1 headless core. The M2 plan (Svelte Flow editor) imports these functions to render and export `.pflow` documents visually.
