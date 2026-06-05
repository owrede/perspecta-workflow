# Pflow M2: Svelte Flow `.pflow` Visual Editor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A custom Obsidian `TextFileView` that opens `.pflow` files in a Svelte Flow node editor — rendering the M1 typed-port IR as nodes with port handles and data wires, persisting node moves, editing a node's prompt in an inspector, and exporting a 100%-native Claude Code workflow via a command.

**Architecture:** Reuse the proven vault-memory contract-designer pattern: Svelte 5 + `@xyflow/svelte`, compiled by `esbuild-svelte`, mounted via `mount()` inside a `TextFileView`. The view parses/validates with the M1 Zod schema (`parsePflow`), renders an error banner instead of crashing on bad input, and round-trips edits through `getViewData`/`requestSave`. Pure IR<->Svelte-Flow mapping helpers live in plain `.ts` so they unit-test headlessly; `.svelte` files hold only view logic.

**Tech Stack:** Svelte 5 (runes), `@xyflow/svelte` 1.5.2, esbuild + esbuild-svelte, Obsidian `TextFileView`, `@perspecta/core` (M1 IR + codegen). All work in `packages/obsidian-plugin`.

**Scope:** Milestone M2 from `docs/specs/2026-06-05-pflow-visual-workflow-compiler-design.md`. This is a VERTICAL SLICE: open -> render -> move -> edit prompt -> export. NOT in this plan: palette drag-to-create new nodes, full per-port schema-editing forms, wire creation/deletion via the mouse, fan-out region visual affordances. Those are a follow-on M2b. Creating wires by dragging handles is included only if trivial; otherwise deferred (see Task 9 note).

**Reference:** Read `docs/specs/2026-06-05-pflow-visual-workflow-compiler-design.md` section 5 (editor) and the M1 IR in `packages/core/src/pflow/schema.ts` before starting. The blueprint is `/Users/wrede/Documents/GitHub/vault-memory/plugin/src/views/contract-editor/`.

---

## File Structure

All under `packages/obsidian-plugin/`:

- `package.json` — add svelte deps + esbuild-svelte dev deps.
- `esbuild.config.mjs` — add the svelte plugin, `conditions`, `mainFields`.
- `tsconfig.json` — include `.svelte`, add svelte types.
- `src/views/pflow-editor/view.ts` — `PflowEditorView extends TextFileView`.
- `src/views/pflow-editor/flow-map.ts` — PURE IR <-> Svelte Flow node/edge mapping (unit-tested).
- `src/views/pflow-editor/editor.svelte` — root 3-pane component (canvas + inspector).
- `src/views/pflow-editor/canvas-pane.svelte` — the `<SvelteFlow>` wrapper.
- `src/views/pflow-editor/PflowNode.svelte` — custom node with typed-port handles.
- `src/views/pflow-editor/inspector-pane.svelte` — selected-node prompt/label editor.
- `src/main.ts` — register view + extension + the export command.
- `styles.base.css` — pflow editor chrome (Obsidian variables only).
- `test/flow-map.test.ts` — unit tests for the pure mapping.

Keep `.svelte` files thin: all non-trivial logic (mapping IR to nodes/edges, applying a position change, applying a prompt edit) lives in `flow-map.ts` as pure functions and is tested there.

---

## Task 1: Add Svelte + Svelte Flow build dependencies

**Files:** Modify `packages/obsidian-plugin/package.json`

- [ ] **Step 1: Add dependencies.** Edit `packages/obsidian-plugin/package.json`. Add to `dependencies` (alongside `@perspecta/core` and `perspecta-ui`):

```json
    "@xyflow/svelte": "^1.5.2",
    "svelte": "^5.55.0"
```

Add to `devDependencies` (alongside `obsidian` and `esbuild`):

```json
    "esbuild-svelte": "^0.9.0",
    "svelte-preprocess": "^6.0.0",
    "tslib": "^2.6.0"
```

- [ ] **Step 2: Install.** Run from repo root: `npm install` — Expected: completes; `node_modules/svelte`, `node_modules/@xyflow/svelte`, `node_modules/esbuild-svelte` present.

- [ ] **Step 3: Verify resolution.** Run from repo root: `node -e "require.resolve('svelte'); require.resolve('@xyflow/svelte'); require.resolve('esbuild-svelte'); console.log('ok')"` — Expected: prints `ok`.

- [ ] **Step 4: Commit.**

```bash
git add packages/obsidian-plugin/package.json package-lock.json
git commit -m "build(plugin): add svelte and @xyflow/svelte for the pflow editor"
```

---

## Task 2: Wire esbuild-svelte into the plugin build

**Files:** Modify `packages/obsidian-plugin/esbuild.config.mjs`

- [ ] **Step 1: Add the svelte plugin imports.** At the top of `packages/obsidian-plugin/esbuild.config.mjs`, after the existing `import esbuild from "esbuild";` line, add:

```js
import sveltePlugin from "esbuild-svelte";
import { sveltePreprocess } from "svelte-preprocess";
```

- [ ] **Step 2: Add svelte resolution + plugin to the esbuild context.** In the `esbuild.context({...})` call, add these three properties (keep all existing ones like `entryPoints`, `bundle`, `format`, `platform`, `target`, `external`, `outfile`, `sourcemap`, `logLevel`):

```js
  conditions: ["svelte", "browser"],
  mainFields: ["svelte", "browser", "module", "main"],
  plugins: [
    sveltePlugin({
      preprocess: sveltePreprocess(),
      compilerOptions: { css: "injected" },
    }),
  ],
```

(`css: "injected"` makes component `<style>` blocks and the `@xyflow/svelte` stylesheet ship inside `main.js` at runtime — no separate CSS step. The existing `buildStyles()`/`styles.css` concat for `perspecta-ui` is unrelated and stays.)

- [ ] **Step 3: Verify the build still works with no svelte files yet.** Run from repo root: `npm run build -w perspecta-workflow-plugin` — Expected: builds `main.js` with no errors (no `.svelte` files exist yet, so the plugin just no-ops the svelte loader).

- [ ] **Step 4: Commit.**

```bash
git add packages/obsidian-plugin/esbuild.config.mjs
git commit -m "build(plugin): compile .svelte via esbuild-svelte (css injected)"
```

---

## Task 3: Make `.svelte` typecheck under the plugin tsconfig

**Files:** Modify `packages/obsidian-plugin/tsconfig.json`

- [ ] **Step 1: Broaden include + ensure DOM lib.** Edit `packages/obsidian-plugin/tsconfig.json` so `include` explicitly covers `.svelte` and `.ts`. Replace `"include": ["src"]` with:

```json
  "include": ["src/**/*.ts", "src/**/*.svelte"]
```

The existing `compilerOptions` already set `lib: ["ES2022", "DOM"]` (DOM is required for Svelte). Leave the rest as-is.

- [ ] **Step 2: Verify typecheck passes with no svelte files yet.** Run from repo root: `npm run typecheck -w perspecta-workflow-plugin` — Expected: no errors (or only any pre-existing unrelated ones; if there are pre-existing errors, note them and ensure you introduce none new).

- [ ] **Step 3: Commit.**

```bash
git add packages/obsidian-plugin/tsconfig.json
git commit -m "build(plugin): include .svelte in the plugin typecheck"
```

---

## Task 4: Pure IR -> Svelte Flow mapping (flow-map.ts) — nodes

**Files:** Create `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`; Test `packages/obsidian-plugin/test/flow-map.test.ts`

This pure module maps the M1 `PflowDocument` to Svelte Flow `nodes`/`edges` plain objects. No Svelte, no Obsidian — headless-testable. Svelte Flow node shape we target: `{ id, type, position: {x,y}, data }`. Edge shape: `{ id, source, target, sourceHandle, targetHandle }`.

- [ ] **Step 1: Write the failing test.** Create `packages/obsidian-plugin/test/flow-map.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { toFlowNodes, toFlowEdges } from "../src/views/pflow-editor/flow-map.js";
import type { PflowDocument } from "@perspecta/core";

const DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "demo", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "Input", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "ag", kind: "agent", label: "Research", prompt: "p", inputs: [{ id: "i", name: "topic", schema: { type: "string" }, required: true }], outputs: [{ id: "r", name: "notes", schema: { type: "string" } }] },
  ],
  wires: [{ from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "i" } }],
  editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [{ nodeId: "in", x: 10, y: 20 }] },
};

describe("toFlowNodes", () => {
  it("maps each pflow node to a flow node with type 'pflow'", () => {
    const nodes = toFlowNodes(DOC);
    expect(nodes).toHaveLength(2);
    expect(nodes[0]).toMatchObject({ id: "in", type: "pflow" });
    expect(nodes[0].data.kind).toBe("input");
    expect(nodes[0].data.label).toBe("Input");
  });
  it("uses saved positions when present, falls back to a deterministic layout", () => {
    const nodes = toFlowNodes(DOC);
    const inNode = nodes.find((n) => n.id === "in")!;
    expect(inNode.position).toEqual({ x: 10, y: 20 });
    const agNode = nodes.find((n) => n.id === "ag")!;
    // no saved position -> deterministic fallback (index-based), not 0,0 overlap
    expect(agNode.position).not.toEqual(inNode.position);
  });
  it("passes ports through in node data for handle rendering", () => {
    const ag = toFlowNodes(DOC).find((n) => n.id === "ag")!;
    expect(ag.data.inputs[0].name).toBe("topic");
    expect(ag.data.outputs[0].name).toBe("notes");
  });
});

describe("toFlowEdges", () => {
  it("maps each wire to a flow edge with source/target handles = port ids", () => {
    const edges = toFlowEdges(DOC);
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "in", target: "ag", sourceHandle: "o", targetHandle: "i" });
  });
  it("gives every edge a stable unique id", () => {
    const edges = toFlowEdges(DOC);
    expect(edges[0].id).toBe("in:o->ag:i");
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run from repo root: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement.** Create `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`:

```ts
import type { PflowDocument, PflowNode, Port } from "@perspecta/core";

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
  data: FlowNodeData;
}
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
}

/** Deterministic fallback position for a node without a saved position:
 *  lay out left-to-right by declared index so nodes never stack at 0,0. */
function fallbackPosition(index: number): { x: number; y: number } {
  return { x: index * 260, y: 80 };
}

export function toFlowNodes(doc: PflowDocument): FlowNode[] {
  const saved = new Map((doc.editor?.nodePositions ?? []).map((p) => [p.nodeId, p] as const));
  return doc.nodes.map((n: PflowNode, i: number) => {
    const pos = saved.get(n.id);
    return {
      id: n.id,
      type: "pflow" as const,
      position: pos ? { x: pos.x, y: pos.y } : fallbackPosition(i),
      data: { kind: n.kind, label: n.label, prompt: n.prompt, inputs: n.inputs, outputs: n.outputs },
    };
  });
}

export function toFlowEdges(doc: PflowDocument): FlowEdge[] {
  return doc.wires.map((w) => ({
    id: `${w.from.nodeId}:${w.from.portId}->${w.to.nodeId}:${w.to.portId}`,
    source: w.from.nodeId,
    target: w.to.nodeId,
    sourceHandle: w.from.portId,
    targetHandle: w.to.portId,
  }));
}
```

- [ ] **Step 4: Run to verify it passes.** Run from repo root: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts` — Expected: PASS (5 tests). Also `npm run typecheck -w perspecta-workflow-plugin` clean.

- [ ] **Step 5: Commit.**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): pure IR->SvelteFlow node/edge mapping"
```

---

## Task 5: Pure write-back helpers (apply move, apply prompt edit)

**Files:** Modify `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`; Test extend `packages/obsidian-plugin/test/flow-map.test.ts`

These take the current `PflowDocument` + an editor action and return a NEW document (immutable update) the view will persist. Pure, tested.

- [ ] **Step 1: Append failing tests.** Append to `packages/obsidian-plugin/test/flow-map.test.ts`:

```ts
import { applyNodePosition, applyPromptEdit } from "../src/views/pflow-editor/flow-map.js";

describe("applyNodePosition", () => {
  it("upserts a node position in editor.nodePositions without mutating the input", () => {
    const next = applyNodePosition(DOC, "ag", 300, 90);
    expect(next.editor!.nodePositions).toContainEqual({ nodeId: "ag", x: 300, y: 90 });
    // original unchanged
    expect(DOC.editor!.nodePositions.some((p) => p.nodeId === "ag")).toBe(false);
  });
  it("overwrites an existing saved position", () => {
    const next = applyNodePosition(DOC, "in", 50, 60);
    const positions = next.editor!.nodePositions.filter((p) => p.nodeId === "in");
    expect(positions).toHaveLength(1);
    expect(positions[0]).toEqual({ nodeId: "in", x: 50, y: 60 });
  });
});

describe("applyPromptEdit", () => {
  it("sets a node's prompt immutably", () => {
    const next = applyPromptEdit(DOC, "ag", "new prompt");
    expect(next.nodes.find((n) => n.id === "ag")!.prompt).toBe("new prompt");
    expect(DOC.nodes.find((n) => n.id === "ag")!.prompt).toBe("p"); // original untouched
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run from repo root: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts` — Expected: FAIL on the new describes.

- [ ] **Step 3: Implement (append to flow-map.ts).**

```ts
/** Return a new document with `nodeId`'s saved position upserted. Immutable. */
export function applyNodePosition(doc: PflowDocument, nodeId: string, x: number, y: number): PflowDocument {
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  const nodePositions = editor.nodePositions.filter((p) => p.nodeId !== nodeId);
  nodePositions.push({ nodeId, x, y });
  return { ...doc, editor: { ...editor, nodePositions } };
}

/** Return a new document with `nodeId`'s prompt set. Immutable. */
export function applyPromptEdit(doc: PflowDocument, nodeId: string, prompt: string): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, prompt } : n)),
  };
}
```

- [ ] **Step 4: Run to verify it passes.** Run from repo root: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts` — Expected: PASS (all). Typecheck clean.

- [ ] **Step 5: Commit.**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): immutable apply-move and apply-prompt helpers"
```

---

## Task 6: The custom node component (PflowNode.svelte)

**Files:** Create `packages/obsidian-plugin/src/views/pflow-editor/PflowNode.svelte`

Renders a node box with one `Handle` per input (left) and per output (right), labeled by port name, colored by the kind. Uses Svelte 5 runes and Obsidian CSS variables.

- [ ] **Step 1: Create the component.** Create `packages/obsidian-plugin/src/views/pflow-editor/PflowNode.svelte`:

```svelte
<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import type { FlowNodeData } from "./flow-map.js";

  let { data }: { data: FlowNodeData } = $props();
</script>

<div class="pflow-node pflow-node--{data.kind}">
  <div class="pflow-node__title">{data.label}</div>
  <div class="pflow-node__kind">{data.kind}</div>

  {#each data.inputs as port, i (port.id)}
    <Handle
      type="target"
      position={Position.Left}
      id={port.id}
      style={`top: ${36 + i * 20}px`}
    />
    <div class="pflow-port pflow-port--in" style={`top: ${28 + i * 20}px`}>{port.name}</div>
  {/each}

  {#each data.outputs as port, i (port.id)}
    <Handle
      type="source"
      position={Position.Right}
      id={port.id}
      style={`top: ${36 + i * 20}px`}
    />
    <div class="pflow-port pflow-port--out" style={`top: ${28 + i * 20}px`}>{port.name}</div>
  {/each}
</div>

<style>
  .pflow-node {
    position: relative;
    min-width: 180px;
    min-height: 64px;
    padding: 6px 10px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 6px);
    color: var(--text-normal);
  }
  .pflow-node__title { font-weight: 600; font-size: var(--font-ui-small); }
  .pflow-node__kind { font-size: var(--font-ui-smaller); color: var(--text-muted); }
  .pflow-port {
    position: absolute;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
  .pflow-port--in { left: 12px; }
  .pflow-port--out { right: 12px; }
</style>
```

- [ ] **Step 2: Verify it compiles via the plugin build.** Run from repo root: `npm run build -w perspecta-workflow-plugin` — Expected: builds with no errors. (The component isn't mounted yet; this just confirms esbuild-svelte compiles it.) Also `npm run typecheck -w perspecta-workflow-plugin` — Expected: clean.

- [ ] **Step 3: Commit.**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/PflowNode.svelte
git commit -m "feat(pflow-editor): custom node with typed-port handles"
```

---

## Task 7: The canvas pane (canvas-pane.svelte)

**Files:** Create `packages/obsidian-plugin/src/views/pflow-editor/canvas-pane.svelte`

Wraps `<SvelteFlow>` with the nodes/edges from the IR, registers the custom node type, imports the xyflow stylesheet, and emits node-move + node-select events to the parent. Pan/zoom NOT persisted (fitView on mount); node moves debounced 500ms by the parent.

- [ ] **Step 1: Create the component.** Create `packages/obsidian-plugin/src/views/pflow-editor/canvas-pane.svelte`:

```svelte
<script lang="ts">
  import { SvelteFlow, Background, Controls, type Node, type Edge, type NodeProps } from "@xyflow/svelte";
  import type { Component } from "svelte";
  import "@xyflow/svelte/dist/style.css";
  import PflowNodeRaw from "./PflowNode.svelte";
  import type { FlowNode, FlowEdge } from "./flow-map.js";

  let {
    flowNodes,
    flowEdges,
    onMove,
    onSelect,
  }: {
    flowNodes: FlowNode[];
    flowEdges: FlowEdge[];
    onMove: (nodeId: string, x: number, y: number) => void;
    onSelect: (nodeId: string | null) => void;
  } = $props();

  const PflowNode = PflowNodeRaw as unknown as Component<NodeProps>;
  const nodeTypes = { pflow: PflowNode };

  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);

  $effect(() => {
    nodes = flowNodes as unknown as Node[];
    edges = flowEdges as unknown as Edge[];
  });

  function handleNodeDragStop(e: { targetNode: Node | null }) {
    const n = e.targetNode;
    if (n) onMove(n.id, n.position.x, n.position.y);
  }
</script>

<div class="pflow-canvas-pane">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    fitView
    onnodedragstop={handleNodeDragStop}
    onnodeclick={(e: { node: Node }) => onSelect(e.node.id)}
    onpaneclick={() => onSelect(null)}
    proOptions={{ hideAttribution: true }}
  >
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  .pflow-canvas-pane { width: 100%; height: 100%; }
</style>
```

NOTE on the `@xyflow/svelte` event/prop names: if the installed version's event names differ (e.g. `onnodedragstop` payload shape, or `onnodeclick`), adjust to match the actual `@xyflow/svelte@1.5.2` API. The vault-memory canvas-pane.svelte uses `onnodedragstop={...}` and accesses the dragged node — mirror whatever shape that working code uses. If the build or runtime errors on an event prop, report it; do not guess repeatedly.

- [ ] **Step 2: Verify it compiles.** Run from repo root: `npm run build -w perspecta-workflow-plugin` — Expected: builds with no errors. `npm run typecheck -w perspecta-workflow-plugin` — clean (the `as unknown as` casts are deliberate to satisfy xyflow's generic node typing).

- [ ] **Step 3: Commit.**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/canvas-pane.svelte
git commit -m "feat(pflow-editor): SvelteFlow canvas pane with node-move + select"
```

---

## Task 8: The inspector pane (inspector-pane.svelte)

**Files:** Create `packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte`

Shows the selected node's label, kind, ports, and an editable prompt textarea. Emits prompt edits to the parent.

- [ ] **Step 1: Create the component.** Create `packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte`:

```svelte
<script lang="ts">
  import type { FlowNodeData } from "./flow-map.js";

  let {
    node,
    onPrompt,
  }: {
    node: { id: string; data: FlowNodeData } | null;
    onPrompt: (nodeId: string, prompt: string) => void;
  } = $props();
</script>

<div class="pflow-inspector">
  {#if !node}
    <div class="pflow-inspector__empty">Select a node to edit it.</div>
  {:else}
    <div class="pflow-inspector__title">{node.data.label}</div>
    <div class="pflow-inspector__kind">{node.data.kind}</div>

    <label class="pflow-inspector__field">
      <span>Prompt</span>
      <textarea
        rows="6"
        value={node.data.prompt ?? ""}
        oninput={(e) => onPrompt(node!.id, (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
    </label>

    <div class="pflow-inspector__ports">
      <div class="pflow-inspector__ports-h">Inputs</div>
      {#each node.data.inputs as p (p.id)}
        <div class="pflow-inspector__port">{p.name}: {p.schema.type}{p.required === false ? "" : " *"}</div>
      {/each}
      <div class="pflow-inspector__ports-h">Outputs</div>
      {#each node.data.outputs as p (p.id)}
        <div class="pflow-inspector__port">{p.name}: {p.schema.type}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pflow-inspector { padding: 10px; height: 100%; overflow-y: auto; color: var(--text-normal); }
  .pflow-inspector__empty { color: var(--text-muted); }
  .pflow-inspector__title { font-weight: 600; }
  .pflow-inspector__kind { color: var(--text-muted); font-size: var(--font-ui-smaller); margin-bottom: 8px; }
  .pflow-inspector__field { display: block; margin: 8px 0; }
  .pflow-inspector__field span { display: block; font-size: var(--font-ui-smaller); color: var(--text-muted); }
  .pflow-inspector__field textarea { width: 100%; resize: vertical; }
  .pflow-inspector__ports-h { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: 8px; }
  .pflow-inspector__port { font-size: var(--font-ui-small); }
</style>
```

- [ ] **Step 2: Verify it compiles.** Run from repo root: `npm run build -w perspecta-workflow-plugin` — Expected: builds. Typecheck clean.

- [ ] **Step 3: Commit.**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte
git commit -m "feat(pflow-editor): inspector pane with editable prompt"
```

---

## Task 9: The root editor component (editor.svelte)

**Files:** Create `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte`

Owns the live `PflowDocument` state, derives flow nodes/edges via the pure mapping, tracks the selected node, and on any edit calls the `onChange` prop (the view's save path). 3-pane grid (canvas + inspector). Panes are DIRECT children of the grid host (no wrapper div — wrapper breaks grid-area).

- [ ] **Step 1: Create the component.** Create `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte`:

```svelte
<script lang="ts">
  import type { PflowDocument } from "@perspecta/core";
  import CanvasPane from "./canvas-pane.svelte";
  import InspectorPane from "./inspector-pane.svelte";
  import { toFlowNodes, toFlowEdges, applyNodePosition, applyPromptEdit } from "./flow-map.js";

  let { file, onChange }: { file: PflowDocument; onChange: (next: PflowDocument) => void } = $props();

  let doc = $state<PflowDocument>(file);
  let selectedId = $state<string | null>(null);

  // Re-seed when the view passes a new document (file reloaded externally).
  $effect(() => { doc = file; });

  let flowNodes = $derived(toFlowNodes(doc));
  let flowEdges = $derived(toFlowEdges(doc));
  let selectedNode = $derived(
    selectedId === null ? null : (flowNodes.find((n) => n.id === selectedId) ?? null),
  );

  function commit(next: PflowDocument) {
    doc = next;
    onChange(next);
  }
  function onMove(nodeId: string, x: number, y: number) { commit(applyNodePosition(doc, nodeId, x, y)); }
  function onPrompt(nodeId: string, prompt: string) { commit(applyPromptEdit(doc, nodeId, prompt)); }
</script>

<div class="pflow-editor">
  <div class="pflow-editor__canvas">
    <CanvasPane {flowNodes} {flowEdges} {onMove} onSelect={(id) => (selectedId = id)} />
  </div>
  <div class="pflow-editor__inspector">
    <InspectorPane node={selectedNode} {onPrompt} />
  </div>
</div>

<style>
  .pflow-editor {
    display: grid;
    grid-template-columns: 1fr 320px;
    width: 100%;
    height: 100%;
  }
  .pflow-editor__canvas { min-width: 0; min-height: 0; }
  .pflow-editor__inspector { border-left: 1px solid var(--background-modifier-border); }
</style>
```

NOTE (wire creation deferred): this slice renders existing wires and lets you move nodes + edit prompts. Creating/deleting wires by dragging handles is NOT wired here — `onChange` is only triggered by move/prompt. Add wire-editing in M2b. If you want a minimal wire-create now and the `@xyflow/svelte` `onconnect` event is trivial to map (source/target/sourceHandle/targetHandle -> a new Wire), it can be added as a follow-up task, but it is OUT OF SCOPE for this plan to keep the slice shippable.

- [ ] **Step 2: Verify it compiles.** Run from repo root: `npm run build -w perspecta-workflow-plugin` — Expected: builds. Typecheck clean.

- [ ] **Step 3: Commit.**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/editor.svelte
git commit -m "feat(pflow-editor): root editor component with state + save wiring"
```

---

## Task 10: The TextFileView (view.ts)

**Files:** Create `packages/obsidian-plugin/src/views/pflow-editor/view.ts`

Parses/validates with `parsePflow`, renders an error banner instead of crashing, mounts `editor.svelte`, round-trips edits through `getViewData`/`requestSave`. Debounces save lightly (the editor calls onChange on every keystroke; `requestSave` is cheap, but we coalesce).

- [ ] **Step 1: Create the view.** Create `packages/obsidian-plugin/src/views/pflow-editor/view.ts`:

```ts
import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { parsePflow, type PflowDocument } from "@perspecta/core";
import Editor from "./editor.svelte";

export const VIEW_TYPE_PFLOW = "perspecta-pflow-editor";

export class PflowEditorView extends TextFileView {
  private current: PflowDocument | null = null;
  private svelteApp: ReturnType<typeof mount> | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_PFLOW; }
  getDisplayText(): string { return this.file?.basename ?? "Workflow"; }
  getIcon(): string { return "git-fork"; }

  /** The current document, or null when no valid document is loaded. */
  getDocument(): PflowDocument | null { return this.current; }

  setViewData(data: string, clear: boolean): void {
    if (clear) this.clear();
    const trimmed = data.trim();
    if (trimmed.length === 0) { this.renderError("Empty .pflow file."); return; }
    let doc: PflowDocument;
    try {
      doc = parsePflow(data);
    } catch (err) {
      this.renderError(`Invalid .pflow file: ${(err as Error).message}`);
      return;
    }
    this.current = doc;
    this.renderEditor();
  }

  getViewData(): string {
    if (this.current) return JSON.stringify(this.current, null, 2);
    // Never return "" — that would let TextFileView overwrite the file with
    // empty content on the next autosave. Return the raw on-disk bytes.
    return this.data ?? "";
  }

  clear(): void {
    this.current = null;
    if (this.svelteApp) { void unmount(this.svelteApp); this.svelteApp = null; }
    this.contentEl.empty();
  }

  private renderError(message: string): void {
    if (this.svelteApp) { void unmount(this.svelteApp); this.svelteApp = null; }
    this.contentEl.empty();
    const box = this.contentEl.createDiv({ cls: "pflow-error" });
    box.createEl("strong", { text: "Cannot open workflow" });
    box.createEl("div", { text: message });
  }

  private renderEditor(): void {
    if (!this.current) return;
    if (this.svelteApp) { void unmount(this.svelteApp); this.svelteApp = null; }
    this.contentEl.empty();
    const host = this.contentEl.createDiv({ cls: "pflow-editor-host" });
    this.svelteApp = mount(Editor, {
      target: host,
      props: {
        file: this.current,
        onChange: (next: PflowDocument) => {
          this.current = next;
          this.requestSave();
        },
      },
    });
  }
}
```

- [ ] **Step 2: Verify it compiles.** Run from repo root: `npm run build -w perspecta-workflow-plugin` — Expected: builds. `npm run typecheck -w perspecta-workflow-plugin` — clean. If the `mount` return type cast causes a typecheck issue, type `svelteApp` as `Record<string, unknown> | null` and cast at the `unmount` call; report what you did.

- [ ] **Step 3: Commit.**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/view.ts
git commit -m "feat(pflow-editor): TextFileView with Zod guard and save round-trip"
```

---

## Task 11: Register the view, the `.pflow` extension, and the export command

**Files:** Modify `packages/obsidian-plugin/src/main.ts`

- [ ] **Step 1: Import the view + codegen.** At the top of `packages/obsidian-plugin/src/main.ts`, add to the existing `@perspecta/core` import the `generateClaudeCodeWorkflow` symbol, and import the view. Concretely:
  - Change the core import to also bring in `generateClaudeCodeWorkflow` (add it to the existing destructured import from `@perspecta/core`).
  - Add: `import { PflowEditorView, VIEW_TYPE_PFLOW } from "./views/pflow-editor/view.js";`

- [ ] **Step 2: Register the view + extension in `onload()`.** In `onload()`, near the existing `this.registerView(VIEW_TYPE_PERSPECTA, ...)` call, add:

```ts
    this.registerView(VIEW_TYPE_PFLOW, (leaf: WorkspaceLeaf) => new PflowEditorView(leaf));
    this.registerExtensions(["pflow"], VIEW_TYPE_PFLOW);
```

- [ ] **Step 3: Add the export command in `onload()`.** Add a new command (alongside the existing `this.addCommand({...})` calls):

```ts
    this.addCommand({
      id: "export-claude-code-workflow",
      name: "Export workflow to Claude Code",
      checkCallback: (checking: boolean) => {
        const view = this.app.workspace.getActiveViewOfType(PflowEditorView);
        const doc = view?.getDocument();
        if (!doc) return false;
        if (!checking) {
          void this.exportClaudeCodeWorkflow(doc);
        }
        return true;
      },
    });
```

- [ ] **Step 4: Add the export method to the plugin class.** Add this method to the `PerspectaWorkflowPlugin` class (near the other private async methods):

```ts
  /** Compile the given pflow document to a native Claude Code workflow and
   *  write it to `.claude/workflows/<name>.js`. */
  private async exportClaudeCodeWorkflow(doc: import("@perspecta/core").PflowDocument): Promise<void> {
    try {
      const code = generateClaudeCodeWorkflow(doc);
      const dir = ".claude/workflows";
      const path = `${dir}/${doc.workflow.name}.js`;
      await this.ensureParentDir(`${path}`);
      await this.app.vault.adapter.write(path, code);
      new Notice(`Perspecta Workflow: exported ${path}`);
    } catch (e) {
      new Notice(`Perspecta Workflow: export failed — ${(e as Error).message}`);
    }
  }
```

(`ensureParentDir` already exists on the class — it creates the parent dir chain. Note `.claude/workflows` has two levels; if `ensureParentDir` only makes the immediate parent, the existing implementation uses `vault.adapter.mkdir` which on Obsidian creates intermediate dirs; if a test shows otherwise, create `.claude` then `.claude/workflows`. Verify `ensureParentDir`'s behavior; if it only mkdirs the last segment and `.claude` doesn't exist, call mkdir for each level.)

- [ ] **Step 5: Build + typecheck.** Run from repo root: `npm run build -w perspecta-workflow-plugin` — Expected: builds. `npm run typecheck -w perspecta-workflow-plugin` — clean. Run the full suite: `npm test` — Expected: all green (the flow-map tests plus all existing). `npm run build` (all workspaces) — clean.

- [ ] **Step 6: Commit.**

```bash
git add packages/obsidian-plugin/src/main.ts
git commit -m "feat(pflow-editor): register .pflow view + export-to-Claude-Code command"
```

---

## Task 12: Editor chrome styles + a sample .pflow + manual smoke

**Files:** Modify `packages/obsidian-plugin/styles.base.css`; Create `packages/obsidian-plugin/examples/summarize.pflow`

- [ ] **Step 1: Add chrome styles.** Append to `packages/obsidian-plugin/styles.base.css`:

```css
/* ---- pflow editor ---- */
.pflow-editor-host { width: 100%; height: 100%; }
.pflow-error {
  margin: 1rem;
  padding: 1rem;
  border: 1px solid var(--background-modifier-error-border, var(--background-modifier-border));
  border-radius: var(--radius-m, 6px);
  color: var(--text-error, var(--text-normal));
  background: var(--background-secondary);
}
```

(Most editor styling lives in the component `<style>` blocks via `css: "injected"`; these are just the host + error banner that the view creates directly in the DOM.)

- [ ] **Step 2: Create a sample file** `packages/obsidian-plugin/examples/summarize.pflow`:

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

- [ ] **Step 3: Build the plugin and deploy to the dev vault for a manual smoke test.** Run from repo root: `npm run build -w perspecta-workflow-plugin`, then `npm run deploy -w perspecta-workflow-plugin` (copies to the Perspecta-Dev vault if present; skips gracefully if absent). If the dev vault is present: open Obsidian, copy `examples/summarize.pflow` into the vault, open it — confirm the three nodes render with port handles and the two wires connect them; drag a node and confirm the position persists (reopen the file); edit the Research prompt in the inspector; run the "Export workflow to Claude Code" command and confirm `.claude/workflows/summarize.js` appears with valid content. Document the smoke result in the commit message or report. If the dev vault is absent, note that manual smoke was skipped and the automated build/typecheck/tests are the gate.

- [ ] **Step 4: Commit.**

```bash
git add packages/obsidian-plugin/styles.base.css packages/obsidian-plugin/examples/summarize.pflow
git commit -m "feat(pflow-editor): editor chrome styles + sample .pflow"
```

---

## Done criteria

- [ ] `npm test` green (flow-map unit tests + all existing).
- [ ] `npm run build` clean across all workspaces (svelte compiles, plugin bundles).
- [ ] `npm run typecheck -w perspecta-workflow-plugin` clean.
- [ ] Opening a `.pflow` file shows a Svelte Flow canvas with typed-port nodes and wires (manual smoke, if dev vault present).
- [ ] Moving a node persists its position; editing a prompt persists; both via the Zod-validated save round-trip.
- [ ] The "Export workflow to Claude Code" command writes a valid `.claude/workflows/<name>.js`.
- [ ] Invalid `.pflow` shows an error banner, never crashes the view, never overwrites the file with empty content.

Out of scope (M2b): palette drag-to-create nodes, wire create/delete by mouse, per-port schema editing, fan-out region affordances, deferred codegen kinds.
