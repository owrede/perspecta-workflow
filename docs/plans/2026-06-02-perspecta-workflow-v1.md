# Perspecta Workflow v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript MCP server ("Perspecta Workflow") that validates Obsidian Canvas files as agentic workflows (linter + auto-color) and walks them node-by-node via a cursor/stepper API.

**Architecture:** Pure-logic core (canvas parsing, graph model, linter, stepper with a call-stack of cursors and a shared context bag) wrapped by a thin MCP adapter exposing `workflow_*` tools. The canvas is the program; this server is the interpreter; the consumer (Claude Code today, a headless runtime later) is interchangeable.

**Tech Stack:** Node 24, TypeScript, `@modelcontextprotocol/sdk`, `zod` (input validation), `vitest` (TDD). Repo: `/Users/wrede/Documents/GitHub/perspecta-workflow`.

**Spec:** `/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/docs/superpowers/specs/2026-06-02-canvas-agentic-workflows-design.md`

---

## File Structure

```
perspecta-workflow/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    types.ts            # Canvas + WorkflowNode + workflow-graph types
    canvas.ts           # parse .canvas JSON, read node-note frontmatter
    graph.ts            # build WorkflowGraph from a canvas (nodes+edges, resolve subworkflow file-nodes)
    linter.ts           # validation rules 1–8 + auto-color
    context.ts          # the shared context bag + {{template}} resolution
    stepper.ts          # cursor + call-stack traversal over a WorkflowGraph
    server.ts           # MCP adapter: registers workflow_* tools
  test/
    fixtures/           # sample .canvas + node-note files
    canvas.test.ts
    graph.test.ts
    linter.test.ts
    context.test.ts
    stepper.test.ts
```

**Responsibilities (one per file):**
- `types.ts` — shared type definitions, no logic.
- `canvas.ts` — filesystem + JSON/YAML parsing only.
- `graph.ts` — turn a parsed canvas into a typed workflow graph; resolve which file-nodes are WorkflowNodes vs subworkflows.
- `linter.ts` — pure validation over a graph + color rewrite.
- `context.ts` — context bag data structure + template resolver.
- `stepper.ts` — stateful traversal; depends on graph + context.
- `server.ts` — MCP wiring only; no business logic.

---

## Task 1: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/index.ts`

- [ ] **Step 1: Initialize git repo and npm**

Run:
```bash
cd /Users/wrede/Documents/GitHub/perspecta-workflow
git init -b main
npm init -y
```
Expected: creates `.git/` and `package.json`.

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install @modelcontextprotocol/sdk zod
npm install -D typescript vitest @types/node tsx
```
Expected: `node_modules/` populated, deps appear in `package.json`.

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Set `"type": "module"` and scripts in `package.json`**

Merge these keys into `package.json`:
```json
{
  "type": "module",
  "name": "perspecta-workflow",
  "bin": { "perspecta-workflow": "dist/server.js" },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx src/server.ts"
  }
}
```

- [ ] **Step 5: Write `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 6: Write `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 7: Write a placeholder `src/index.ts` so build succeeds**

```typescript
export const VERSION = "0.1.0";
```

- [ ] **Step 8: Verify build and empty test run**

Run:
```bash
npm run build && npx vitest run
```
Expected: build succeeds; vitest reports "no test files found" (exit 0) — acceptable at this stage.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold perspecta-workflow TypeScript MCP project"
```

---

## Task 2: Core types

**Files:**
- Create: `src/types.ts`
- Test: `test/types.test.ts`

- [ ] **Step 1: Write the failing test**

`test/types.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { NODE_TYPES, NODE_COLORS } from "../src/types.js";

describe("node type constants", () => {
  it("defines all eight workflow node types", () => {
    expect(NODE_TYPES).toEqual([
      "start", "end", "prompt", "tool", "data", "contract", "loop", "config",
    ]);
  });

  it("maps every node type to a canvas color string", () => {
    for (const t of NODE_TYPES) {
      expect(typeof NODE_COLORS[t]).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/types.test.ts`
Expected: FAIL — cannot find module `../src/types.js`.

- [ ] **Step 3: Write `src/types.ts`**

```typescript
// Obsidian JSON Canvas raw shapes (subset we use)
export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number; y: number; width: number; height: number;
  text?: string;
  file?: string;   // present when type === "file"
  color?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const NODE_TYPES = [
  "start", "end", "prompt", "tool", "data", "contract", "loop", "config",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// Canvas colors are "1".."6" preset strings; map per spec.
export const NODE_COLORS: Record<NodeType, string> = {
  start: "4",     // green
  end: "1",       // red
  prompt: "6",    // purple
  tool: "2",      // orange
  data: "5",      // cyan
  contract: "5",  // (blue not a preset → reuse cyan family; hex override applied in linter)
  loop: "3",      // yellow
  config: "0",    // gray (no color key → linter omits/uses default)
};

// Hex overrides where a preset doesn't exist (contract = blue, config = gray)
export const NODE_COLOR_HEX: Partial<Record<NodeType, string>> = {
  contract: "#4363d8",
  config: "#a9a9a9",
};

// A node-note's parsed frontmatter
export interface WorkflowNodeFrontmatter {
  class: "WorkflowNode";
  node_type: NodeType;
  outputs?: string[];
  tool?: string;
  params?: Record<string, unknown>;
  contract?: string;
  source?: string;
  condition?: string;
}

// A resolved workflow node in the graph
export interface WorkflowNode {
  canvasNodeId: string;
  kind: NodeType | "subworkflow";
  filePath?: string;                 // node-note path or child .canvas path
  frontmatter?: WorkflowNodeFrontmatter;
  body?: string;                     // node-note body (instruction text)
  childCanvasPath?: string;          // when kind === "subworkflow"
}

export interface WorkflowEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export interface WorkflowGraph {
  canvasPath: string;
  nodes: Map<string, WorkflowNode>; // keyed by canvasNodeId
  edges: WorkflowEdge[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts test/types.test.ts
git commit -m "feat: core types for canvas, node types, workflow graph"
```

---

## Task 3: Canvas + frontmatter parsing

**Files:**
- Create: `src/canvas.ts`
- Test: `test/canvas.test.ts`, fixtures under `test/fixtures/`

- [ ] **Step 1: Create fixtures**

`test/fixtures/start-note.md`:
```markdown
---
class: WorkflowNode
node_type: start
---
Begin the workflow.
```

`test/fixtures/mini.canvas`:
```json
{
  "nodes": [
    { "id": "n1", "type": "file", "file": "start-note.md", "x": 0, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": []
}
```

- [ ] **Step 2: Write the failing test**

`test/canvas.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseCanvas, parseNodeNote } from "../src/canvas.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("parseCanvas", () => {
  it("loads nodes and edges from a .canvas file", () => {
    const c = parseCanvas(join(FIX, "mini.canvas"));
    expect(c.nodes).toHaveLength(1);
    expect(c.nodes[0].file).toBe("start-note.md");
    expect(c.edges).toEqual([]);
  });
});

describe("parseNodeNote", () => {
  it("extracts frontmatter and body", () => {
    const note = parseNodeNote(join(FIX, "start-note.md"));
    expect(note.frontmatter.class).toBe("WorkflowNode");
    expect(note.frontmatter.node_type).toBe("start");
    expect(note.body.trim()).toBe("Begin the workflow.");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/canvas.test.ts`
Expected: FAIL — cannot find module `../src/canvas.js`.

- [ ] **Step 4: Write `src/canvas.ts`**

```typescript
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Canvas, WorkflowNodeFrontmatter } from "./types.js";

export function parseCanvas(path: string): Canvas {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { nodes: raw.nodes ?? [], edges: raw.edges ?? [] };
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface ParsedNote {
  frontmatter: WorkflowNodeFrontmatter;
  body: string;
}

export function parseNodeNote(path: string): ParsedNote {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`No frontmatter in node note: ${path}`);
  const frontmatter = parseYaml(m[1]) as WorkflowNodeFrontmatter;
  return { frontmatter, body: m[2] ?? "" };
}
```

- [ ] **Step 5: Install the `yaml` dependency**

Run: `npm install yaml`
Expected: `yaml` added to dependencies.

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/canvas.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/canvas.ts test/canvas.test.ts test/fixtures/
git commit -m "feat: parse .canvas files and node-note frontmatter"
```

---

## Task 4: Build the workflow graph

**Files:**
- Create: `src/graph.ts`
- Test: `test/graph.test.ts`, more fixtures

- [ ] **Step 1: Create fixtures for a 3-node linear workflow**

`test/fixtures/end-note.md`:
```markdown
---
class: WorkflowNode
node_type: end
---
Done.
```

`test/fixtures/prompt-note.md`:
```markdown
---
class: WorkflowNode
node_type: prompt
outputs: [summary]
---
Summarize {{topic}}.
```

`test/fixtures/linear.canvas`:
```json
{
  "nodes": [
    { "id": "s", "type": "file", "file": "start-note.md",  "x": 0,   "y": 0, "width": 200, "height": 60 },
    { "id": "p", "type": "file", "file": "prompt-note.md", "x": 300, "y": 0, "width": 200, "height": 60 },
    { "id": "e", "type": "file", "file": "end-note.md",    "x": 600, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": [
    { "id": "e1", "fromNode": "s", "toNode": "p" },
    { "id": "e2", "fromNode": "p", "toNode": "e" }
  ]
}
```

`test/fixtures/child.canvas` (for subworkflow resolution):
```json
{
  "nodes": [
    { "id": "cs", "type": "file", "file": "start-note.md", "x": 0,   "y": 0, "width": 200, "height": 60 },
    { "id": "ce", "type": "file", "file": "end-note.md",   "x": 300, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": [ { "id": "ce1", "fromNode": "cs", "toNode": "ce" } ]
}
```

`test/fixtures/parent.canvas`:
```json
{
  "nodes": [
    { "id": "s",   "type": "file", "file": "start-note.md", "x": 0,   "y": 0, "width": 200, "height": 60 },
    { "id": "sub", "type": "file", "file": "child.canvas",  "x": 300, "y": 0, "width": 200, "height": 60 },
    { "id": "e",   "type": "file", "file": "end-note.md",   "x": 600, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": [
    { "id": "pe1", "fromNode": "s",   "toNode": "sub" },
    { "id": "pe2", "fromNode": "sub", "toNode": "e" }
  ]
}
```

- [ ] **Step 2: Write the failing test**

`test/graph.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildGraph } from "../src/graph.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("buildGraph", () => {
  it("resolves node-note file-nodes into typed workflow nodes", () => {
    const g = buildGraph(join(FIX, "linear.canvas"));
    expect(g.nodes.get("s")!.kind).toBe("start");
    expect(g.nodes.get("p")!.kind).toBe("prompt");
    expect(g.nodes.get("p")!.frontmatter!.outputs).toEqual(["summary"]);
    expect(g.nodes.get("e")!.kind).toBe("end");
    expect(g.edges).toHaveLength(2);
  });

  it("marks a file-node pointing at a .canvas as a subworkflow", () => {
    const g = buildGraph(join(FIX, "parent.canvas"));
    const sub = g.nodes.get("sub")!;
    expect(sub.kind).toBe("subworkflow");
    expect(sub.childCanvasPath!.endsWith("child.canvas")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/graph.test.ts`
Expected: FAIL — cannot find module `../src/graph.js`.

- [ ] **Step 4: Write `src/graph.ts`**

```typescript
import { dirname, resolve } from "node:path";
import { parseCanvas, parseNodeNote } from "./canvas.js";
import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from "./types.js";

export function buildGraph(canvasPath: string): WorkflowGraph {
  const canvas = parseCanvas(canvasPath);
  const baseDir = dirname(canvasPath);
  const nodes = new Map<string, WorkflowNode>();

  for (const cn of canvas.nodes) {
    if (cn.type !== "file" || !cn.file) continue; // ignore text/group nodes in v1
    const target = resolve(baseDir, cn.file);

    if (cn.file.endsWith(".canvas")) {
      nodes.set(cn.id, {
        canvasNodeId: cn.id,
        kind: "subworkflow",
        filePath: target,
        childCanvasPath: target,
      });
      continue;
    }

    const note = parseNodeNote(target);
    nodes.set(cn.id, {
      canvasNodeId: cn.id,
      kind: note.frontmatter.node_type,
      filePath: target,
      frontmatter: note.frontmatter,
      body: note.body,
    });
  }

  const edges: WorkflowEdge[] = canvas.edges.map((e) => ({
    fromId: e.fromNode,
    toId: e.toNode,
    label: e.label,
  }));

  return { canvasPath, nodes, edges };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/graph.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/graph.ts test/graph.test.ts test/fixtures/
git commit -m "feat: build typed workflow graph, resolve subworkflow nodes"
```

---

## Task 5: Linter — structural rules

**Files:**
- Create: `src/linter.ts`
- Test: `test/linter.test.ts`, invalid fixtures

- [ ] **Step 1: Create invalid fixtures**

`test/fixtures/no-start.canvas`:
```json
{
  "nodes": [
    { "id": "e", "type": "file", "file": "end-note.md", "x": 0, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": []
}
```

`test/fixtures/dangling.canvas`:
```json
{
  "nodes": [
    { "id": "s", "type": "file", "file": "start-note.md", "x": 0, "y": 0, "width": 200, "height": 60 },
    { "id": "e", "type": "file", "file": "end-note.md",   "x": 300, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": [ { "id": "x", "fromNode": "s", "toNode": "MISSING" } ]
}
```

- [ ] **Step 2: Write the failing test**

`test/linter.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildGraph } from "../src/graph.js";
import { lint } from "../src/linter.js";

const FIX = join(import.meta.dirname, "fixtures");
const lintFile = (f: string) => lint(buildGraph(join(FIX, f)));

describe("lint structural rules", () => {
  it("passes a valid linear workflow", () => {
    const r = lintFile("linear.canvas");
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("fails when there is no start node", () => {
    const r = lintFile("no-start.canvas");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "one-start")).toBe(true);
  });

  it("fails on a dangling edge", () => {
    const r = lintFile("dangling.canvas");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "no-dangling-edges")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/linter.test.ts`
Expected: FAIL — cannot find module `../src/linter.js`.

- [ ] **Step 4: Write `src/linter.ts` (structural rules only)**

```typescript
import type { WorkflowGraph, NodeType } from "./types.js";

export interface LintError { rule: string; message: string; nodeId?: string; }
export interface LintResult { ok: boolean; errors: LintError[]; }

export function lint(graph: WorkflowGraph): LintResult {
  const errors: LintError[] = [];
  const nodes = [...graph.nodes.values()];

  // Rule 1: exactly one start
  const starts = nodes.filter((n) => n.kind === "start");
  if (starts.length !== 1) {
    errors.push({ rule: "one-start", message: `Expected exactly 1 start node, found ${starts.length}` });
  }

  // Rule 2: at least one end, all reachable from start
  const ends = nodes.filter((n) => n.kind === "end");
  if (ends.length === 0) {
    errors.push({ rule: "has-end", message: "Workflow has no end node" });
  }
  if (starts.length === 1) {
    const reachable = reachableFrom(graph, starts[0].canvasNodeId);
    for (const e of ends) {
      if (!reachable.has(e.canvasNodeId)) {
        errors.push({ rule: "end-reachable", message: `End node ${e.canvasNodeId} is unreachable from start`, nodeId: e.canvasNodeId });
      }
    }
  }

  // Rule 4: no dangling edges
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.fromId) || !graph.nodes.has(edge.toId)) {
      errors.push({ rule: "no-dangling-edges", message: `Edge ${edge.fromId}->${edge.toId} references a missing node` });
    }
  }

  // Rule 5: every non-end node has >=1 outgoing edge
  for (const n of nodes) {
    if (n.kind === "end") continue;
    const out = graph.edges.filter((e) => e.fromId === n.canvasNodeId);
    if (out.length === 0) {
      errors.push({ rule: "no-dead-ends", message: `Non-end node ${n.canvasNodeId} (${n.kind}) has no outgoing edge`, nodeId: n.canvasNodeId });
    }
  }

  // Rule 6: branch/loop nodes with multiple out-edges need distinct labels
  for (const n of nodes) {
    const out = graph.edges.filter((e) => e.fromId === n.canvasNodeId);
    if (out.length > 1) {
      const labels = out.map((e) => e.label ?? "");
      const distinct = new Set(labels);
      if (distinct.size !== labels.length || labels.includes("")) {
        errors.push({ rule: "distinct-branch-labels", message: `Node ${n.canvasNodeId} has multiple outgoing edges that need distinct, non-empty labels`, nodeId: n.canvasNodeId });
      }
    }
  }

  // Rule 3: every workflow node has a valid node_type (subworkflow exempt)
  const VALID: NodeType[] = ["start","end","prompt","tool","data","contract","loop","config"];
  for (const n of nodes) {
    if (n.kind === "subworkflow") continue;
    if (!VALID.includes(n.kind as NodeType)) {
      errors.push({ rule: "valid-node-type", message: `Node ${n.canvasNodeId} has invalid node_type "${n.kind}"`, nodeId: n.canvasNodeId });
    }
  }

  return { ok: errors.length === 0, errors };
}

function reachableFrom(graph: WorkflowGraph, startId: string): Set<string> {
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.fromId === cur && !seen.has(e.toId)) {
        seen.add(e.toId);
        stack.push(e.toId);
      }
    }
  }
  return seen;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/linter.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/linter.ts test/linter.test.ts test/fixtures/
git commit -m "feat: linter structural rules (start/end/reachability/dangling/dead-ends/labels)"
```

---

## Task 6: Linter — infinite-loop-in-embedded rule

**Files:**
- Modify: `src/linter.ts`
- Test: `test/linter.test.ts` (add cases), fixtures

**Loop classification (used here and in the stepper):** a `loop` node is **infinite** iff it has exactly one outgoing edge AND that edge has no label AND the node frontmatter has no `condition`. Otherwise it is a bounded (while) loop.

- [ ] **Step 1: Create fixtures**

`test/fixtures/loop-note.md`:
```markdown
---
class: WorkflowNode
node_type: loop
---
Loop back.
```

`test/fixtures/infinite-child.canvas` — a minimal child with an infinite loop (single unlabeled back-edge, no condition). It is intentionally invalid as a *top-level* workflow (no reachable end), which is irrelevant here: the embed rule must fire regardless of the child's standalone validity, because `findInfiniteLoops` scans for infinite-loop nodes directly rather than running the full child lint.
```json
{
  "nodes": [
    { "id": "cs", "type": "file", "file": "start-note.md", "x": 0,   "y": 0, "width": 200, "height": 60 },
    { "id": "cl", "type": "file", "file": "loop-note.md",  "x": 300, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": [
    { "id": "k1", "fromNode": "cs", "toNode": "cl" },
    { "id": "k2", "fromNode": "cl", "toNode": "cs" }
  ]
}
```

`test/fixtures/embeds-infinite.canvas`:
```json
{
  "nodes": [
    { "id": "s",   "type": "file", "file": "start-note.md",      "x": 0,   "y": 0, "width": 200, "height": 60 },
    { "id": "sub", "type": "file", "file": "infinite-child.canvas","x": 300, "y": 0, "width": 200, "height": 60 },
    { "id": "e",   "type": "file", "file": "end-note.md",        "x": 600, "y": 0, "width": 200, "height": 60 }
  ],
  "edges": [
    { "id": "a1", "fromNode": "s",   "toNode": "sub" },
    { "id": "a2", "fromNode": "sub", "toNode": "e" }
  ]
}
```

- [ ] **Step 2: Write the failing tests (append to `test/linter.test.ts`)**

```typescript
import { isInfiniteLoop } from "../src/linter.js";

describe("loop classification", () => {
  it("classifies a single unlabeled back-edge loop as infinite", () => {
    const g = buildGraph(join(FIX, "infinite-child.canvas"));
    expect(isInfiniteLoop(g, "cl")).toBe(true);
  });
});

describe("embed rule: infinite loop forbidden in embedded workflow", () => {
  it("fails a parent that embeds a child containing an infinite loop", () => {
    const r = lintFile("embeds-infinite.canvas");
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.rule === "infinite-loop-in-embedded");
    expect(err).toBeDefined();
    expect(err!.message).toContain("infinite-child.canvas");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/linter.test.ts`
Expected: FAIL — `isInfiniteLoop` not exported; embed rule not implemented.

- [ ] **Step 4: Add `isInfiniteLoop` and the embed rule to `src/linter.ts`**

Add this exported helper:
```typescript
export function isInfiniteLoop(graph: WorkflowGraph, loopNodeId: string): boolean {
  const node = graph.nodes.get(loopNodeId);
  if (!node || node.kind !== "loop") return false;
  const out = graph.edges.filter((e) => e.fromId === loopNodeId);
  const hasCondition = Boolean(node.frontmatter?.condition);
  return out.length === 1 && !out[0].label && !hasCondition;
}
```

Add this import at the top of `src/linter.ts`:
```typescript
import { buildGraph } from "./graph.js";
```

Inside `lint`, after the existing rules and before `return`, add the embed check:
```typescript
  // Rule 7+8: any embedded child must contain no infinite-loop nodes (recursively).
  for (const n of nodes) {
    if (n.kind !== "subworkflow" || !n.childCanvasPath) continue;
    const childInfinites = findInfiniteLoops(n.childCanvasPath);
    if (childInfinites.length > 0) {
      errors.push({
        rule: "infinite-loop-in-embedded",
        message: `Embedded workflow ${n.childCanvasPath} contains infinite-loop node(s) [${childInfinites.join(", ")}]; embedded workflows must not contain infinite loops.`,
        nodeId: n.canvasNodeId,
      });
    }
  }
```

Add this module-level helper (recurses into grandchildren):
```typescript
function findInfiniteLoops(canvasPath: string): string[] {
  const child = buildGraph(canvasPath);
  const found: string[] = [];
  for (const n of child.nodes.values()) {
    if (n.kind === "loop" && isInfiniteLoop(child, n.canvasNodeId)) {
      found.push(n.canvasNodeId);
    }
    if (n.kind === "subworkflow" && n.childCanvasPath) {
      found.push(...findInfiniteLoops(n.childCanvasPath));
    }
  }
  return found;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/linter.test.ts`
Expected: PASS (all linter tests).

- [ ] **Step 6: Commit**

```bash
git add src/linter.ts test/linter.test.ts test/fixtures/
git commit -m "feat: linter rule forbidding infinite loops in embedded workflows"
```

---

## Task 7: Auto-color

**Files:**
- Modify: `src/linter.ts` (add `applyColors`)
- Test: `test/linter.test.ts` (add color test)

- [ ] **Step 1: Write the failing test (append)**

```typescript
import { applyColors } from "../src/linter.js";
import { parseCanvas } from "../src/canvas.js";
import { writeFileSync, copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

describe("applyColors", () => {
  it("rewrites canvas node colors from node_type", () => {
    const dir = mkdtempSync(join(tmpdir(), "pw-"));
    // copy note fixtures + a canvas into temp so we can mutate the canvas
    for (const f of ["start-note.md", "prompt-note.md", "end-note.md"]) {
      copyFileSync(join(FIX, f), join(dir, f));
    }
    const canvasPath = join(dir, "linear.canvas");
    copyFileSync(join(FIX, "linear.canvas"), canvasPath);

    const changed = applyColors(buildGraph(canvasPath), canvasPath);
    expect(changed).toBeGreaterThan(0);

    const after = parseCanvas(canvasPath);
    const start = after.nodes.find((n) => n.id === "s")!;
    expect(start.color).toBe("4"); // green per NODE_COLORS.start
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/linter.test.ts`
Expected: FAIL — `applyColors` not exported.

- [ ] **Step 3: Add `applyColors` to `src/linter.ts`**

```typescript
import { readFileSync, writeFileSync } from "node:fs";
import { NODE_COLORS, NODE_COLOR_HEX, type NodeType } from "./types.js";

/** Rewrite each workflow node's canvas color from its node_type. Returns count changed. */
export function applyColors(graph: WorkflowGraph, canvasPath: string): number {
  const raw = JSON.parse(readFileSync(canvasPath, "utf8"));
  let changed = 0;
  for (const cn of raw.nodes ?? []) {
    const wf = graph.nodes.get(cn.id);
    if (!wf || wf.kind === "subworkflow") continue;
    const hex = NODE_COLOR_HEX[wf.kind as NodeType];
    const preset = NODE_COLORS[wf.kind as NodeType];
    const desired = hex ?? preset;
    if (desired && cn.color !== desired) {
      cn.color = desired;
      changed++;
    }
  }
  if (changed > 0) writeFileSync(canvasPath, JSON.stringify(raw, null, 2) + "\n", "utf8");
  return changed;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/linter.test.ts`
Expected: PASS (all linter tests including color).

- [ ] **Step 5: Commit**

```bash
git add src/linter.ts test/linter.test.ts
git commit -m "feat: auto-apply canvas node colors from node_type"
```

---

## Task 8: Context bag + template resolution

**Files:**
- Create: `src/context.ts`
- Test: `test/context.test.ts`

- [ ] **Step 1: Write the failing test**

`test/context.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { ContextBag, resolveTemplate } from "../src/context.js";

describe("ContextBag", () => {
  it("stores and retrieves named values", () => {
    const ctx = new ContextBag();
    ctx.set("summary", "hello");
    expect(ctx.get("summary")).toBe("hello");
    expect(ctx.all()).toEqual({ summary: "hello" });
  });
});

describe("resolveTemplate", () => {
  it("replaces {{name}} placeholders from the context", () => {
    const ctx = new ContextBag();
    ctx.set("topic", "the meeting");
    expect(resolveTemplate("Summarize {{topic}}.", ctx)).toBe("Summarize the meeting.");
  });

  it("leaves unknown placeholders untouched and records them", () => {
    const ctx = new ContextBag();
    const { text, missing } = resolveTemplateDetailed("Use {{a}} and {{b}}.", ctx);
    expect(missing).toEqual(["a", "b"]);
    expect(text).toBe("Use {{a}} and {{b}}.");
  });
});

import { resolveTemplateDetailed } from "../src/context.js";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/context.test.ts`
Expected: FAIL — cannot find module `../src/context.js`.

- [ ] **Step 3: Write `src/context.ts`**

```typescript
export class ContextBag {
  private store = new Map<string, unknown>();
  set(name: string, value: unknown): void { this.store.set(name, value); }
  get(name: string): unknown { return this.store.get(name); }
  has(name: string): boolean { return this.store.has(name); }
  all(): Record<string, unknown> { return Object.fromEntries(this.store); }
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function resolveTemplateDetailed(
  text: string,
  ctx: ContextBag,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(PLACEHOLDER, (whole, name: string) => {
    if (ctx.has(name)) return String(ctx.get(name));
    if (!missing.includes(name)) missing.push(name);
    return whole; // leave untouched
  });
  return { text: out, missing };
}

export function resolveTemplate(text: string, ctx: ContextBag): string {
  return resolveTemplateDetailed(text, ctx).text;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/context.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/context.ts test/context.test.ts
git commit -m "feat: shared context bag and {{template}} resolution"
```

---

## Task 9: Stepper — linear traversal

**Files:**
- Create: `src/stepper.ts`
- Test: `test/stepper.test.ts`

- [ ] **Step 1: Write the failing test**

`test/stepper.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { Stepper } from "../src/stepper.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("Stepper linear walk", () => {
  it("starts at the start node", () => {
    const s = new Stepper(join(FIX, "linear.canvas"));
    const cur = s.current();
    expect(cur.kind).toBe("start");
    expect(cur.outgoing).toHaveLength(1);
    expect(cur.outgoing[0].toId).toBe("p");
  });

  it("advances along the only edge and resolves templates", () => {
    const s = new Stepper(join(FIX, "linear.canvas"));
    s.advance({ outputs: { topic: "the meeting" } }); // from start -> p
    const cur = s.current();
    expect(cur.kind).toBe("prompt");
    expect(cur.instruction).toBe("Summarize the meeting.");
  });

  it("reaches the end node and reports done", () => {
    const s = new Stepper(join(FIX, "linear.canvas"));
    s.advance();                         // start -> p
    s.advance({ outputs: { summary: "x" } }); // p -> e
    expect(s.current().kind).toBe("end");
    expect(s.status().atEnd).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/stepper.test.ts`
Expected: FAIL — cannot find module `../src/stepper.js`.

- [ ] **Step 3: Write `src/stepper.ts` (linear; subworkflow support added in Task 10)**

```typescript
import { buildGraph } from "./graph.js";
import { ContextBag, resolveTemplate } from "./context.js";
import type { WorkflowGraph, WorkflowEdge } from "./types.js";

interface Frame { graph: WorkflowGraph; currentId: string; }

export interface CurrentNode {
  canvasNodeId: string;
  kind: string;
  instruction: string;                 // resolved body text
  frontmatter?: Record<string, unknown>;
  outgoing: { toId: string; label?: string }[];
}

export interface AdvanceArgs {
  edge?: string;                       // edge label to follow (required at branch points)
  outputs?: Record<string, unknown>;   // values this node produced
}

export class Stepper {
  private stack: Frame[];
  private ctx = new ContextBag();

  constructor(canvasPath: string) {
    const graph = buildGraph(canvasPath);
    const start = [...graph.nodes.values()].find((n) => n.kind === "start");
    if (!start) throw new Error(`No start node in ${canvasPath}`);
    this.stack = [{ graph, currentId: start.canvasNodeId }];
  }

  private frame(): Frame { return this.stack[this.stack.length - 1]; }

  current(): CurrentNode {
    const { graph, currentId } = this.frame();
    const node = graph.nodes.get(currentId)!;
    const outgoing = graph.edges
      .filter((e: WorkflowEdge) => e.fromId === currentId)
      .map((e) => ({ toId: e.toId, label: e.label }));
    return {
      canvasNodeId: currentId,
      kind: node.kind,
      instruction: resolveTemplate(node.body ?? "", this.ctx),
      frontmatter: node.frontmatter as unknown as Record<string, unknown>,
      outgoing,
    };
  }

  advance(args: AdvanceArgs = {}): void {
    // record outputs into the shared context bag
    if (args.outputs) {
      for (const [k, v] of Object.entries(args.outputs)) this.ctx.set(k, v);
    }
    const { graph, currentId } = this.frame();
    const out = graph.edges.filter((e) => e.fromId === currentId);
    if (out.length === 0) throw new Error(`Node ${currentId} has no outgoing edge`);

    let chosen: WorkflowEdge;
    if (out.length === 1) {
      chosen = out[0];
    } else {
      if (!args.edge) throw new Error(`Node ${currentId} is a branch; an edge label is required`);
      const match = out.find((e) => e.label === args.edge);
      if (!match) throw new Error(`No outgoing edge labeled "${args.edge}" from ${currentId}`);
      chosen = match;
    }
    this.frame().currentId = chosen.toId;
  }

  status(): { atEnd: boolean; depth: number; currentId: string } {
    const { graph, currentId } = this.frame();
    return { atEnd: graph.nodes.get(currentId)!.kind === "end", depth: this.stack.length, currentId };
  }

  context(): Record<string, unknown> { return this.ctx.all(); }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/stepper.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/stepper.ts test/stepper.test.ts
git commit -m "feat: stepper linear traversal with context-resolved instructions"
```

---

## Task 10: Stepper — subworkflow descent + pop

**Files:**
- Modify: `src/stepper.ts`
- Test: `test/stepper.test.ts` (add nested cases)

**Behavior:** when `advance` would move the cursor onto a `subworkflow` node, the stepper instead pushes a new frame for the child canvas positioned at the child's start node (shared context bag — same `ctx`). When the cursor is at the child's `end` node and `advance` is called, the stepper pops the frame and continues from the subworkflow node's outgoing edge in the parent.

- [ ] **Step 1: Write the failing test (append to `test/stepper.test.ts`)**

```typescript
describe("Stepper nested subworkflow", () => {
  it("descends into the child at its start and shares context", () => {
    const s = new Stepper(join(FIX, "parent.canvas"));
    expect(s.current().kind).toBe("start");      // parent start
    s.advance({ outputs: { fromParent: 1 } });   // parent start -> sub (descends)
    const cur = s.current();
    expect(cur.kind).toBe("start");              // child start
    expect(s.status().depth).toBe(2);
    expect(s.context().fromParent).toBe(1);      // shared bag
  });

  it("pops back to the parent after the child end and finishes", () => {
    const s = new Stepper(join(FIX, "parent.canvas"));
    s.advance();   // parent start -> descend into child start
    s.advance();   // child start -> child end
    expect(s.current().kind).toBe("end");        // child end
    s.advance();   // child end -> pop -> parent end
    expect(s.current().kind).toBe("end");        // parent end
    expect(s.status().depth).toBe(1);
    expect(s.status().atEnd).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/stepper.test.ts`
Expected: FAIL — current behavior lands on the subworkflow node itself / does not pop.

- [ ] **Step 3: Modify `advance` in `src/stepper.ts`**

Replace the final line `this.frame().currentId = chosen.toId;` with descent/pop logic:
```typescript
    const target = graph.nodes.get(chosen.toId)!;

    if (target.kind === "subworkflow" && target.childCanvasPath) {
      // move cursor onto the subworkflow node first (so a later pop returns to its out-edge)
      this.frame().currentId = chosen.toId;
      // then descend: push a frame for the child at its start node
      const childGraph = buildGraph(target.childCanvasPath);
      const childStart = [...childGraph.nodes.values()].find((n) => n.kind === "start");
      if (!childStart) throw new Error(`Embedded workflow ${target.childCanvasPath} has no start node`);
      this.stack.push({ graph: childGraph, currentId: childStart.canvasNodeId });
      return;
    }

    this.frame().currentId = chosen.toId;
```

Then handle the pop: at the very top of `advance`, before recording outputs, detect "at a child end → pop":
```typescript
    // If we are at a child's end node, advancing pops back to the parent and
    // continues from the subworkflow node's outgoing edge.
    {
      const f = this.frame();
      const node = f.graph.nodes.get(f.currentId)!;
      if (node.kind === "end" && this.stack.length > 1) {
        this.stack.pop();
        // now in parent, cursor sits on the subworkflow node; fall through to
        // normal edge-following from there using this same advance call.
      }
    }
```

The method order becomes: (1) pop-if-child-end, (2) record outputs, (3) follow edge with descent handling.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/stepper.test.ts`
Expected: PASS (all stepper tests, linear + nested).

- [ ] **Step 5: Commit**

```bash
git add src/stepper.ts test/stepper.test.ts
git commit -m "feat: stepper descends into and pops out of embedded subworkflows"
```

---

## Task 11: MCP server adapter

**Files:**
- Create: `src/server.ts`
- Test: `test/server.test.ts` (smoke test of tool handlers via direct calls)

**Note:** test the handler functions directly (export them) rather than spinning a stdio transport, to keep tests fast and deterministic.

- [ ] **Step 1: Write the failing test**

`test/server.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { handlers, resetSessions } from "../src/server.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("MCP handlers", () => {
  it("workflow_lint returns ok for a valid workflow", async () => {
    const r = await handlers.workflow_lint({ canvas: join(FIX, "linear.canvas") });
    expect(r.ok).toBe(true);
  });

  it("workflow_start + workflow_current returns the start node", async () => {
    resetSessions();
    const started = await handlers.workflow_start({ canvas: join(FIX, "linear.canvas") });
    expect(started.session).toBeTruthy();
    const cur = await handlers.workflow_current({ session: started.session });
    expect(cur.kind).toBe("start");
  });

  it("workflow_advance moves the cursor", async () => {
    resetSessions();
    const started = await handlers.workflow_start({ canvas: join(FIX, "linear.canvas") });
    await handlers.workflow_advance({ session: started.session, outputs: { topic: "x" } });
    const cur = await handlers.workflow_current({ session: started.session });
    expect(cur.kind).toBe("prompt");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/server.test.ts`
Expected: FAIL — cannot find module `../src/server.js`.

- [ ] **Step 3: Write `src/server.ts`**

```typescript
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { buildGraph } from "./graph.js";
import { lint, applyColors } from "./linter.js";
import { Stepper } from "./stepper.js";

const sessions = new Map<string, Stepper>();
export function resetSessions() { sessions.clear(); }

export const handlers = {
  async workflow_lint({ canvas, fix = false }: { canvas: string; fix?: boolean }) {
    const graph = buildGraph(canvas);
    const result = lint(graph);
    let recolored = 0;
    if (fix && result.ok) recolored = applyColors(graph, canvas);
    return { ...result, recolored };
  },

  async workflow_start({ canvas }: { canvas: string }) {
    const graph = buildGraph(canvas);
    const result = lint(graph);
    if (!result.ok) return { ok: false, errors: result.errors };
    const session = randomUUID();
    sessions.set(session, new Stepper(canvas));
    return { ok: true, session };
  },

  async workflow_current({ session }: { session: string }) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    return s.current();
  },

  async workflow_advance(
    { session, edge, outputs }: { session: string; edge?: string; outputs?: Record<string, unknown> },
  ) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    s.advance({ edge, outputs });
    return { ok: true, ...s.status() };
  },

  async workflow_context({ session }: { session: string }) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    return s.context();
  },

  async workflow_status({ session }: { session: string }) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    return s.status();
  },
};

export function buildServer(): McpServer {
  const server = new McpServer({ name: "perspecta-workflow", version: "0.1.0" });

  server.tool("workflow_lint", "Validate a canvas workflow; optionally auto-fix colors",
    { canvas: z.string(), fix: z.boolean().optional() },
    async (a) => ({ content: [{ type: "text", text: JSON.stringify(await handlers.workflow_lint(a)) }] }));

  server.tool("workflow_start", "Start walking a canvas workflow; returns a session id",
    { canvas: z.string() },
    async (a) => ({ content: [{ type: "text", text: JSON.stringify(await handlers.workflow_start(a)) }] }));

  server.tool("workflow_current", "Get the current node (resolved instruction + outgoing edges)",
    { session: z.string() },
    async (a) => ({ content: [{ type: "text", text: JSON.stringify(await handlers.workflow_current(a)) }] }));

  server.tool("workflow_advance", "Advance the cursor; record outputs; choose an edge label at branches",
    { session: z.string(), edge: z.string().optional(), outputs: z.record(z.unknown()).optional() },
    async (a) => ({ content: [{ type: "text", text: JSON.stringify(await handlers.workflow_advance(a)) }] }));

  server.tool("workflow_context", "Inspect the current context bag",
    { session: z.string() },
    async (a) => ({ content: [{ type: "text", text: JSON.stringify(await handlers.workflow_context(a)) }] }));

  server.tool("workflow_status", "Cursor position, call-stack depth, at-end flag",
    { session: z.string() },
    async (a) => ({ content: [{ type: "text", text: JSON.stringify(await handlers.workflow_status(a)) }] }));

  return server;
}

// Entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/server.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the full suite + build**

Run: `npm run build && npx vitest run`
Expected: build succeeds; ALL tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/server.ts test/server.test.ts
git commit -m "feat: MCP server adapter exposing workflow_* tools"
```

---

## Task 12: WorkflowNode class note + vault MCP registration + README

**Files:**
- Create: `/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/_src/classes/WorkflowNode.md`
- Modify: `/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/_src/classes/Klassen.md`
- Modify: `/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/.mcp.json`
- Create: `README.md` (in the new repo)

- [ ] **Step 1: Create the `WorkflowNode` class note**

`_src/classes/WorkflowNode.md`:
```markdown
---
class: Class
status: etabliert
template:
storage: anywhere (referenced by .canvas file-nodes)
count: 0
---

# WorkflowNode

Ein Knoten in einem Canvas-basierten Agenten-Workflow (Perspecta Workflow). Wird von einem `file`-Node in einer `.canvas`-Datei referenziert; das Frontmatter ist die Source of Truth, die Farbe wird vom Linter aus `node_type` abgeleitet.

## Status

**Etabliert** — eingeführt mit Perspecta Workflow v1 (Repo: `~/Documents/GitHub/perspecta-workflow`).

## Frontmatter-Felder

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `class` | ✓ | `WorkflowNode` |
| `node_type` | ✓ | start \| end \| prompt \| tool \| data \| contract \| loop \| config |
| `outputs` | – | Namen, die dieser Knoten in den Context-Bag schreibt |
| `tool` | – | (node_type: tool) Tool-Name |
| `params` | – | (node_type: tool) Tool-Parameter, mit `{{...}}`-Templates |
| `contract` | – | (node_type: contract) vault-memory-Contract-Name |
| `source` | – | (node_type: data) Wikilink/Quelle |
| `condition` | – | (node_type: loop) Bedingung für while-Loop |

## Beziehungen

- referenziert von `.canvas`-Workflow-Dateien (file-nodes)
- `contract`-Knoten rufen vault-memory-Contracts auf
- Spec: `docs/superpowers/specs/2026-06-02-canvas-agentic-workflows-design.md`
```

- [ ] **Step 2: Add WorkflowNode to the class index**

In `_src/classes/Klassen.md`, under the "Etabliert" list, add this line after the `[[Notes]]` entry:
```markdown
- [[WorkflowNode]] — Knoten in einem Canvas-Agenten-Workflow (Perspecta Workflow) (0)
```

- [ ] **Step 3: Register the MCP server in the vault**

Read the current `.mcp.json` first:
Run: `cat "/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/.mcp.json"`

Add a `perspecta-workflow` entry to the `mcpServers` object (merge, don't replace):
```json
"perspecta-workflow": {
  "command": "node",
  "args": ["/Users/wrede/Documents/GitHub/perspecta-workflow/dist/server.js"]
}
```

- [ ] **Step 4: Write the repo README**

`README.md`:
```markdown
# Perspecta Workflow

An MCP server that turns Obsidian Canvas files into walkable agentic workflows.
Nodes are prompts, tool calls, data sources, or vault-memory contracts, chained
as a directed flowchart from a `start` node to an `end` node. Workflows compose
(a canvas can embed another canvas) and may loop.

## Tools

- `workflow_lint(canvas, fix?)` — validate a workflow canvas; `fix` re-colors nodes by type.
- `workflow_start(canvas)` — lint + begin a walk, returns a session id.
- `workflow_current(session)` — current node: resolved instruction + outgoing edges.
- `workflow_advance(session, edge?, outputs?)` — record outputs, follow an edge (label required at branches).
- `workflow_context(session)` — inspect the shared context bag.
- `workflow_status(session)` — cursor position, call-stack depth, at-end flag.

## Develop

    npm install
    npm test          # vitest
    npm run build     # tsc -> dist/

## Spec

See the design spec in the Intelligence Impact vault:
`docs/superpowers/specs/2026-06-02-canvas-agentic-workflows-design.md`
```

- [ ] **Step 5: Build so the registered path exists**

Run:
```bash
cd /Users/wrede/Documents/GitHub/perspecta-workflow && npm run build
```
Expected: `dist/server.js` exists.

- [ ] **Step 6: Commit (two repos)**

```bash
cd /Users/wrede/Documents/GitHub/perspecta-workflow
git add README.md
git commit -m "docs: README for perspecta-workflow"

cd "/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact"
git add "_src/classes/WorkflowNode.md" "_src/classes/Klassen.md" ".mcp.json"
git commit -m "feat: register WorkflowNode class + perspecta-workflow MCP server"
```

---

## Self-Review

**Spec coverage:**
- Three-layer architecture → Tasks 2–11 (core) + Task 11 (MCP adapter). ✓
- Node schema + `node_type` + auto-color → Tasks 2, 7. ✓
- `WorkflowNode` Class note → Task 12. ✓
- Edge semantics (directed, labeled, agent chooses branch) → Tasks 5 (label rule), 9 (branch requires edge). ✓
- Loop semantics (while vs infinite via edges) → Task 6 (`isInfiniteLoop`). ✓
- Composability: subworkflow node, step-in, shared context, call-stack → Tasks 4 (resolve), 10 (descent/pop). ✓
- Infinite-loop-forbidden-in-embedded → Task 6. ✓
- Named context bag + `{{template}}` → Task 8, wired in Task 9. ✓
- Cursor/stepper API surface → Tasks 9–11. ✓
- Linter rules 1–8 → Tasks 5, 6. ✓
- MCP placement alongside vault-memory → Task 12 (.mcp.json). ✓

**Deferred per spec (correctly absent):** `config` runtime behavior (lint-inert only — Task 2 includes the type, no runtime task), headless runtime, authoring helper, context namespacing.

**Placeholder scan:** Task 6 fixture section contains exploratory prose ("Wait — …") that resolves to a final fixture; the final fixture block is explicit. Acceptable as reasoning, but the FINAL `infinite-child.canvas` is the one to use.

**Type consistency:** `buildGraph`, `lint`, `applyColors`, `isInfiniteLoop`, `Stepper`, `ContextBag`, `resolveTemplate`, `handlers` names are consistent across tasks. `NODE_COLORS`/`NODE_COLOR_HEX` defined in Task 2, used in Task 7. `AdvanceArgs.outputs` / `edge` consistent between Tasks 9, 10, 11.
