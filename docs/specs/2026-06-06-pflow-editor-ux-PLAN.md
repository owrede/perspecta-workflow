# pflow Editor UX — Implementation Plan (Phase 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `.pflow` visual editor authorable by hand — add/delete nodes, edit node name/type, edit workflow config, with confirm-on-destructive and visible selection — so faithful workflow graphs can be built without regenerating JSON.

**Architecture:** All document mutations are pure immutable helpers in `flow-map.ts` (unit-tested in isolation). The Svelte components (`editor.svelte`, `canvas-pane.svelte`, `inspector-pane.svelte`, `PflowNode.svelte`) wire those helpers to user events, using Obsidian's native `Menu` and a small `confirmModal` helper for dialogs. No `@perspecta/core` changes in this phase.

**Tech Stack:** Svelte 5 (runes), @xyflow/svelte 1.x, Obsidian API (`Menu`, `Modal`), esbuild-svelte, vitest.

Spec: `docs/specs/2026-06-06-pflow-editor-ux-and-loop-codegen-design.md`

---

## File structure

- `flow-map.ts` — add `applyAddNode`, `applyDeleteNode`, `applyLabelEdit`, `applyKindChange`, `orphanedWiresForKind`, `applyWorkflowMeta`, `applyArgDefault`, `defaultPortsForKind`, `COMPILABLE_KINDS`; update `FlowEdge.markerEnd` to 24px.
- `test/flow-map.test.ts` — unit tests for every new helper.
- `confirm-modal.ts` (new) — `confirmModal(app, title, body): Promise<boolean>` wrapping Obsidian `Modal`.
- `inspector-pane.svelte` — editable name, type `<select>`, workflow-config view when no node.
- `canvas-pane.svelte` — background `oncontextmenu` add-node menu; node selection visual; delete key.
- `PflowNode.svelte` — selected-state ring.
- `editor.svelte` — new commit handlers wiring the helpers + modals.

---

## Task 1: Bigger arrowheads

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

- [ ] **Step 1: Update the failing test**

Replace the existing markerEnd test body:

```ts
  it("gives every edge a target arrowhead marker sized for visibility", () => {
    const edges = toFlowEdges(DOC);
    expect(edges[0].markerEnd).toEqual({ type: MarkerType.ArrowClosed, width: 24, height: 24 });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t arrowhead`
Expected: FAIL (markerEnd lacks width/height).

- [ ] **Step 3: Update the type and mapping**

In `flow-map.ts`, change the `FlowEdge.markerEnd` field type:

```ts
  /** Arrowhead at the target end to show flow direction (sized up for visibility). */
  markerEnd: { type: MarkerType; width: number; height: number };
```

And in `toFlowEdges`:

```ts
    markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): enlarge edge arrowheads to 24px for visibility"
```

---

## Task 2: Default ports per kind + compilable-kinds list

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { defaultPortsForKind, COMPILABLE_KINDS } from "../src/views/pflow-editor/flow-map.js";

describe("defaultPortsForKind", () => {
  it("agent has one in and one out", () => {
    expect(defaultPortsForKind("agent")).toEqual({
      inputs: [{ id: "in", name: "in", schema: { type: "any" }, required: true }],
      outputs: [{ id: "out", name: "out", schema: { type: "any" } }],
    });
  });
  it("input has no inputs, one out", () => {
    const p = defaultPortsForKind("input");
    expect(p.inputs).toEqual([]);
    expect(p.outputs).toHaveLength(1);
  });
  it("output has one in, no outputs", () => {
    const p = defaultPortsForKind("output");
    expect(p.inputs).toHaveLength(1);
    expect(p.outputs).toEqual([]);
  });
  it("loop has one in and one out", () => {
    const p = defaultPortsForKind("loop");
    expect(p.inputs).toHaveLength(1);
    expect(p.outputs).toHaveLength(1);
  });
});

describe("COMPILABLE_KINDS", () => {
  it("is exactly the four kinds codegen supports", () => {
    expect(COMPILABLE_KINDS).toEqual(["input", "agent", "output", "loop"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t defaultPortsForKind`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement**

In `flow-map.ts`:

```ts
import type { NodeKind } from "@perspecta/core";

/** Kinds the M1 codegen can compile. The editor offers all kinds but ghosts
 *  the rest (they would build un-exportable graphs). */
export const COMPILABLE_KINDS: NodeKind[] = ["input", "agent", "output", "loop"];

/** Default input/output ports for a freshly-created node of a given kind. */
export function defaultPortsForKind(kind: NodeKind): { inputs: Port[]; outputs: Port[] } {
  const inPort: Port = { id: "in", name: "in", schema: { type: "any" }, required: true };
  const outPort: Port = { id: "out", name: "out", schema: { type: "any" } };
  switch (kind) {
    case "input": return { inputs: [], outputs: [outPort] };
    case "output": return { inputs: [inPort], outputs: [] };
    default: return { inputs: [inPort], outputs: [outPort] };
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): default ports per kind + compilable-kinds list"
```

---

## Task 3: applyAddNode

**Files:**
- Modify: `flow-map.ts`
- Test: `test/flow-map.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { applyAddNode } from "../src/views/pflow-editor/flow-map.js";

describe("applyAddNode", () => {
  it("appends a node with default ports and saves its position", () => {
    const next = applyAddNode(DOC, "agent", "New agent", 100, 200);
    const added = next.nodes[next.nodes.length - 1];
    expect(added.kind).toBe("agent");
    expect(added.label).toBe("New agent");
    expect(added.inputs).toHaveLength(1);
    expect(added.outputs).toHaveLength(1);
    expect(next.editor!.nodePositions).toContainEqual(
      expect.objectContaining({ nodeId: added.id, x: 100, y: 200 }),
    );
    // immutable
    expect(DOC.nodes).toHaveLength(2);
  });
  it("generates an id not already present", () => {
    const a = applyAddNode(DOC, "agent", "A", 0, 0);
    const b = applyAddNode(a, "agent", "B", 0, 0);
    const ids = b.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

(`DOC` in the test currently has 2 nodes `in`/`ag` — adjust the immutability assertion if the fixture differs; verify the fixture length before asserting.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t applyAddNode`
Expected: FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
/** Append a new node of `kind` at (x,y) with default ports. Immutable.
 *  Returns the new document; the new node is the last in `nodes`. */
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
  while (existing.has(id)) { i += 1; id = `node-${i}`; }
  const { inputs, outputs } = defaultPortsForKind(kind);
  const node: PflowNode = { id, kind, label, inputs, outputs };
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  return {
    ...doc,
    nodes: [...doc.nodes, node],
    editor: { ...editor, nodePositions: [...editor.nodePositions, { nodeId: id, x, y }] },
  };
}
```

(Add `PflowNode` to the `import type` from `@perspecta/core` if not already imported.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): applyAddNode immutable helper"
```

---

## Task 4: applyDeleteNode

**Files:**
- Modify: `flow-map.ts`
- Test: `test/flow-map.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { applyDeleteNode } from "../src/views/pflow-editor/flow-map.js";

describe("applyDeleteNode", () => {
  it("removes the node, its wires, and its saved position", () => {
    const next = applyDeleteNode(DOC, "ag");
    expect(next.nodes.some((n) => n.id === "ag")).toBe(false);
    expect(next.wires.some((w) => w.from.nodeId === "ag" || w.to.nodeId === "ag")).toBe(false);
    expect((next.editor?.nodePositions ?? []).some((p) => p.nodeId === "ag")).toBe(false);
    // immutable
    expect(DOC.nodes.some((n) => n.id === "ag")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t applyDeleteNode`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): applyDeleteNode immutable helper"
```

---

## Task 5: applyLabelEdit

**Files:**
- Modify: `flow-map.ts`
- Test: `test/flow-map.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { applyLabelEdit } from "../src/views/pflow-editor/flow-map.js";

describe("applyLabelEdit", () => {
  it("sets a node's label immutably", () => {
    const next = applyLabelEdit(DOC, "ag", "Renamed");
    expect(next.nodes.find((n) => n.id === "ag")!.label).toBe("Renamed");
    expect(DOC.nodes.find((n) => n.id === "ag")!.label).not.toBe("Renamed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t applyLabelEdit`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** Set a node's label. Immutable. */
export function applyLabelEdit(doc: PflowDocument, nodeId: string, label: string): PflowDocument {
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, label } : n)) };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): applyLabelEdit immutable helper"
```

---

## Task 6: orphanedWiresForKind + applyKindChange

**Files:**
- Modify: `flow-map.ts`
- Test: `test/flow-map.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { orphanedWiresForKind, applyKindChange } from "../src/views/pflow-editor/flow-map.js";

describe("orphanedWiresForKind", () => {
  it("flags wires that reference ports the new kind won't have", () => {
    // DOC: in(out:o) -> ag(in:i). Changing 'ag' to 'input' removes its inputs,
    // orphaning the incoming wire into ag.i.
    const orphans = orphanedWiresForKind(DOC, "ag", "input");
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toMatchObject({ to: { nodeId: "ag", portId: "i" } });
  });
  it("returns empty when the new kind keeps the used ports", () => {
    // 'ag' agent -> loop keeps in+out, so the incoming wire survives.
    expect(orphanedWiresForKind(DOC, "ag", "loop")).toHaveLength(0);
  });
});

describe("applyKindChange", () => {
  it("changes kind, resets ports to defaults, and drops orphaned wires", () => {
    const next = applyKindChange(DOC, "ag", "input");
    const node = next.nodes.find((n) => n.id === "ag")!;
    expect(node.kind).toBe("input");
    expect(node.inputs).toEqual([]);
    expect(next.wires.some((w) => w.to.nodeId === "ag")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t orphanedWiresForKind`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Wire } from "@perspecta/core";

/** Wires that would dangle if `nodeId` became `kind` (reference a port the new
 *  kind's default ports won't include). Both directions. */
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

/** Change a node's kind, reset its ports to the kind defaults, and drop any
 *  wires orphaned by the new ports. Immutable. Caller is responsible for
 *  confirming with the user first when orphanedWiresForKind is non-empty. */
export function applyKindChange(doc: PflowDocument, nodeId: string, kind: NodeKind): PflowDocument {
  const orphans = orphanedWiresForKind(doc, nodeId, kind);
  const orphanSet = new Set(orphans);
  const { inputs, outputs } = defaultPortsForKind(kind);
  return {
    ...doc,
    nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, kind, inputs, outputs } : n)),
    wires: doc.wires.filter((w) => !orphanSet.has(w)),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): kind change with orphaned-wire detection"
```

---

## Task 7: applyWorkflowMeta + applyArgDefault

**Files:**
- Modify: `flow-map.ts`
- Test: `test/flow-map.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { applyWorkflowMeta, applyArgDefault } from "../src/views/pflow-editor/flow-map.js";

describe("applyWorkflowMeta", () => {
  it("patches workflow name/description immutably", () => {
    const next = applyWorkflowMeta(DOC, { description: "new desc" });
    expect(next.workflow.description).toBe("new desc");
    expect(next.workflow.name).toBe(DOC.workflow.name);
    expect(DOC.workflow.description).not.toBe("new desc");
  });
});

describe("applyArgDefault", () => {
  it("sets a default on an args object property, creating args if absent", () => {
    const next = applyArgDefault(DOC, "target_folder", "Meetings/Follow-ups");
    const args = next.workflow.args as { type: "object"; properties: Record<string, unknown> };
    expect(args.type).toBe("object");
    expect(args.properties.target_folder).toMatchObject({ type: "string", default: "Meetings/Follow-ups" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts -t applyWorkflowMeta`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** Patch workflow-level name/description. Immutable. */
export function applyWorkflowMeta(
  doc: PflowDocument,
  patch: { name?: string; description?: string },
): PflowDocument {
  return { ...doc, workflow: { ...doc.workflow, ...patch } };
}

/** Set a string-typed arg default on the workflow args object. Creates the
 *  object-typed args schema if missing. Immutable. The `default` field is
 *  carried on the property; the codegen/runtime reads it as the arg default. */
export function applyArgDefault(doc: PflowDocument, key: string, value: string): PflowDocument {
  const args =
    doc.workflow.args && doc.workflow.args.type === "object"
      ? doc.workflow.args
      : { type: "object" as const, properties: {} as Record<string, unknown>, required: [] as string[] };
  const properties = { ...(args as { properties?: Record<string, unknown> }).properties };
  properties[key] = { type: "string", default: value };
  return {
    ...doc,
    workflow: { ...doc.workflow, args: { ...args, properties } as PflowDocument["workflow"]["args"] },
  };
}
```

NOTE: `PortSchema` does not currently include a `default` field. If `tsc`
rejects the `default` property, extend `PortSchema` in
`packages/core/src/pflow/schema.ts` to allow an optional `default?: unknown`
on the object/scalar variants, with a matching Zod `.optional()`, and add a
one-line core test. Do this as a sub-step here only if the build fails.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): workflow meta + arg-default helpers"
```

---

## Task 8: confirmModal helper

**Files:**
- Create: `packages/obsidian-plugin/src/views/pflow-editor/confirm-modal.ts`

No unit test (thin Obsidian `Modal` wrapper; verified via build + manual use).

- [ ] **Step 1: Implement**

```ts
import { App, Modal, Setting } from "obsidian";

/** Show a yes/no confirmation. Resolves true on confirm, false on cancel/close.
 *  `body` may contain newlines; rendered as paragraphs. */
export function confirmModal(app: App, title: string, body: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let decided = false;
    modal.titleEl.setText(title);
    for (const line of body.split("\n")) modal.contentEl.createEl("p", { text: line });
    new Setting(modal.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => modal.close()))
      .addButton((b) =>
        b.setButtonText("Delete").setWarning().onClick(() => { decided = true; modal.close(); resolve(true); }),
      );
    modal.onClose = () => { if (!decided) resolve(false); };
    modal.open();
  });
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd packages/obsidian-plugin && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/confirm-modal.ts
git commit -m "feat(pflow-editor): confirmModal Obsidian dialog helper"
```

---

## Task 9: Selected-state ring on PflowNode

**Files:**
- Modify: `PflowNode.svelte`

- [ ] **Step 1: Add `selected` to FlowNodeData and the node class**

In `flow-map.ts` `FlowNodeData` add `selected?: boolean` and set it in
`toFlowNodes` from a `selectedId` arg (thread `selectedId` into `toFlowNodes`
in `editor.svelte`'s `$derived`). Minimal change: give `toFlowNodes` an
optional second arg `selectedId?: string | null` and set
`data.selected = n.id === selectedId`.

In `PflowNode.svelte` add to the wrapper:

```svelte
<div class="pflow-node pflow-node--{data.kind}" class:pflow-node--selected={data.selected}>
```

And CSS:

```css
  .pflow-node--selected {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px var(--interactive-accent);
  }
```

- [ ] **Step 2: Build to verify**

Run: `cd packages/obsidian-plugin && node esbuild.config.mjs && npx tsc --noEmit`
Expected: build ok, exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/PflowNode.svelte packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/src/views/pflow-editor/editor.svelte
git commit -m "feat(pflow-editor): visible selected-state ring on nodes"
```

---

## Task 10: Background right-click add-node menu

**Files:**
- Modify: `canvas-pane.svelte`, `editor.svelte`

- [ ] **Step 1: Add onAddNode prop + contextmenu handler in canvas-pane**

`canvas-pane.svelte`: accept `onAddNode: (kind: NodeKind, x: number, y: number) => void` and the xyflow `screenToFlowPosition` (via `useSvelteFlow()`); on `oncontextmenu` of `.pflow-canvas-pane`, `event.preventDefault()`, build an Obsidian `Menu`:

```ts
import { Menu } from "obsidian";
import { NODE_KINDS } from "@perspecta/core";
import { COMPILABLE_KINDS } from "./flow-map.js";
// ...
function onPaneContextMenu(event: MouseEvent) {
  event.preventDefault();
  const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
  const menu = new Menu();
  for (const kind of NODE_KINDS) {
    const ok = COMPILABLE_KINDS.includes(kind);
    menu.addItem((item) => {
      item.setTitle(ok ? `Add ${kind}` : `Add ${kind} (not yet exportable)`);
      item.setDisabled(!ok);
      if (ok) item.onClick(() => onAddNode(kind, pos.x, pos.y));
    });
  }
  menu.showAtMouseEvent(event);
}
```

Wire `oncontextmenu={onPaneContextMenu}` on the wrapper div. `useSvelteFlow`
must be called inside the component that is a child of `<SvelteFlow>`, so add a
tiny inner wrapper or use the instance from context — verify against
@xyflow/svelte: `screenToFlowPosition` comes from `useSvelteFlow()`.

- [ ] **Step 2: Handle onAddNode in editor.svelte**

```ts
function onAddNode(kind: NodeKind, x: number, y: number) {
  const label = `New ${kind}`;
  const next = applyAddNode(doc, kind, label, x, y);
  commit(next);
  selectedId = next.nodes[next.nodes.length - 1].id;
}
```

Pass `{onAddNode}` to `<CanvasPane>`.

- [ ] **Step 3: Build + manual smoke**

Run: `cd packages/obsidian-plugin && node esbuild.config.mjs && npx tsc --noEmit`
Expected: ok. Manual: right-click canvas → menu shows 4 active + 6 ghosted; clicking an active kind adds a node.

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/canvas-pane.svelte packages/obsidian-plugin/src/views/pflow-editor/editor.svelte
git commit -m "feat(pflow-editor): background right-click add-node menu (advanced kinds ghosted)"
```

---

## Task 11: Delete node (menu + key, confirm if non-empty)

**Files:**
- Modify: `canvas-pane.svelte`, `editor.svelte`

- [ ] **Step 1: Node context menu + delete key in canvas-pane**

Add `onDeleteRequest: (nodeId: string) => void` prop. Wire
`onnodecontextmenu={({ node, event }) => { event.preventDefault(); const m = new Menu(); m.addItem(i => i.setTitle("Delete node").onClick(() => onDeleteRequest(node.id))); m.showAtMouseEvent(event); }}`.
Add a keydown listener on the pane: on `Delete`/`Backspace` when a node is
selected and `document.activeElement` is not an input/textarea, call
`onDeleteRequest(selectedId)`.

- [ ] **Step 2: editor.svelte handler with confirm**

```ts
import { confirmModal } from "./confirm-modal.js";
import { getApp } from "...";  // however the view passes App; see view.ts — thread app down as a prop

async function onDeleteRequest(nodeId: string) {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node) return;
  const nonEmpty = Boolean(node.prompt?.trim()) || Boolean((node.config?.body as string | undefined)?.trim());
  if (nonEmpty) {
    const ok = await confirmModal(app, "Delete node?", `"${node.label}" has instructions that will be lost.\nDelete it anyway?`);
    if (!ok) return;
  }
  commit(applyDeleteNode(doc, nodeId));
  if (selectedId === nodeId) selectedId = null;
}
```

`app: App` must be threaded from `view.ts` (the `TextFileView` has
`this.app`) into `Editor` props. Add `app` to the editor's `$props()` and pass
it from `view.ts` mount, and from `editor.svelte` down to where needed.

- [ ] **Step 3: Build + manual smoke**

Run: `cd packages/obsidian-plugin && node esbuild.config.mjs && npx tsc --noEmit`
Expected: ok. Manual: delete empty node → gone immediately; delete node with a
prompt → confirm modal; cancel keeps it.

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/
git commit -m "feat(pflow-editor): delete node via menu/key with non-empty confirm"
```

---

## Task 12: Inspector — editable name + type (with orphan confirm)

**Files:**
- Modify: `inspector-pane.svelte`, `editor.svelte`

- [ ] **Step 1: Inspector emits name + kind change requests**

`inspector-pane.svelte`: add props `onRename: (id, label) => void` and
`onKindChange: (id, kind) => void`. Replace the read-only title/kind with:

```svelte
<input class="pflow-inspector__name" value={node.data.label}
  oninput={(e) => onRename(node!.id, (e.currentTarget as HTMLInputElement).value)} />
<select class="pflow-inspector__type" value={node.data.kind}
  onchange={(e) => onKindChange(node!.id, (e.currentTarget as HTMLSelectElement).value)}>
  {#each NODE_KINDS as k}
    <option value={k} disabled={!COMPILABLE_KINDS.includes(k)}>{k}{COMPILABLE_KINDS.includes(k) ? "" : " (n/a)"}</option>
  {/each}
</select>
```

(Import `NODE_KINDS` from `@perspecta/core`, `COMPILABLE_KINDS` from
`flow-map.js`.)

- [ ] **Step 2: editor.svelte handlers**

```ts
function onRename(id: string, label: string) { commit(applyLabelEdit(doc, id, label)); }

async function onKindChange(id: string, kind: NodeKind) {
  const orphans = orphanedWiresForKind(doc, id, kind);
  if (orphans.length > 0) {
    const lines = orphans.map((w) => `• ${w.from.nodeId}.${w.from.portId} → ${w.to.nodeId}.${w.to.portId}`).join("\n");
    const ok = await confirmModal(app, "Change node type?", `This removes ${orphans.length} wire(s):\n${lines}`);
    if (!ok) return;
  }
  commit(applyKindChange(doc, id, kind));
}
```

(`confirmModal`'s confirm button text says "Delete"; make the button label a
param: extend `confirmModal(app, title, body, confirmText = "Confirm")` and pass
"Change" / "Delete" appropriately. Update Task 8's signature accordingly.)

- [ ] **Step 3: Build + manual smoke**

Run: `cd packages/obsidian-plugin && node esbuild.config.mjs && npx tsc --noEmit`
Expected: ok. Manual: rename updates node title live; change type with no wires
→ silent; change type that orphans a wire → modal lists it.

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/
git commit -m "feat(pflow-editor): editable node name + type with orphan-wire confirm"
```

---

## Task 13: Inspector — workflow config when nothing selected

**Files:**
- Modify: `inspector-pane.svelte`, `editor.svelte`

- [ ] **Step 1: Inspector workflow view**

When `node` is null, instead of "Select a node", render workflow fields. The
inspector needs the workflow data + change callbacks; add props
`workflow: { name: string; description: string }`,
`argDefaults: { target_folder: string; filename_template: string; on_exists: string }`,
`onWorkflowMeta: (patch) => void`, `onArgDefault: (key, value) => void`.

```svelte
{#if !node}
  <div class="pflow-inspector__title">Workflow</div>
  <label class="pflow-inspector__field"><span>Name</span>
    <input value={workflow.name} oninput={(e) => onWorkflowMeta({ name: e.currentTarget.value })} /></label>
  <label class="pflow-inspector__field"><span>Description</span>
    <textarea rows="3" value={workflow.description}
      oninput={(e) => onWorkflowMeta({ description: e.currentTarget.value })}></textarea></label>
  <div class="pflow-inspector__ports-h">Save defaults</div>
  <label class="pflow-inspector__field"><span>target_folder</span>
    <input value={argDefaults.target_folder}
      oninput={(e) => onArgDefault("target_folder", e.currentTarget.value)} /></label>
  <label class="pflow-inspector__field"><span>filename_template</span>
    <input value={argDefaults.filename_template}
      oninput={(e) => onArgDefault("filename_template", e.currentTarget.value)} /></label>
  <label class="pflow-inspector__field"><span>on_exists</span>
    <input value={argDefaults.on_exists}
      oninput={(e) => onArgDefault("on_exists", e.currentTarget.value)} /></label>
{:else}
  ... existing node view ...
{/if}
```

- [ ] **Step 2: editor.svelte derives + handlers**

```ts
let argDefaults = $derived.by(() => {
  const props = (doc.workflow.args && doc.workflow.args.type === "object" ? doc.workflow.args.properties : {}) ?? {};
  const read = (k: string) => (props[k] as { default?: string } | undefined)?.default ?? "";
  return {
    target_folder: read("target_folder"),
    filename_template: read("filename_template"),
    on_exists: read("on_exists"),
  };
});
function onWorkflowMeta(patch: { name?: string; description?: string }) { commit(applyWorkflowMeta(doc, patch)); }
function onArgDefault(key: string, value: string) { commit(applyArgDefault(doc, key, value)); }
```

Pass `workflow={{ name: doc.workflow.name, description: doc.workflow.description }}`,
`{argDefaults}`, `{onWorkflowMeta}`, `{onArgDefault}` to `<InspectorPane>`.

- [ ] **Step 3: Build + manual smoke**

Run: `cd packages/obsidian-plugin && node esbuild.config.mjs && npx tsc --noEmit`
Expected: ok. Manual: click empty canvas → inspector shows workflow + save
defaults; editing a default persists to the file (check the saved `.pflow`
args).

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/
git commit -m "feat(pflow-editor): workflow-config inspector when no node selected"
```

---

## Task 14: Phase-1 gate — full build, tests, deploy, verify artifacts

**Files:** none (verification only).

- [ ] **Step 1: Full test + typecheck**

Run: `npx vitest run && cd packages/obsidian-plugin && npx tsc --noEmit && cd ../core && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 2: Build + verify shipped artifacts (deployed-artifact lesson)**

Run from `packages/obsidian-plugin`:
```bash
node esbuild.config.mjs
grep -c "pflow-node--selected" main.js        # selected-state shipped
grep -c "not yet exportable" main.js          # add-menu ghosting shipped
```
Expected: both ≥ 1.

- [ ] **Step 3: Deploy to Intelligence Impact vault + byte-check**

```bash
PERSPECTA_VAULT_ROOT="/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact" bash scripts/deploy-dev.sh
DEST="/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/.obsidian/plugins/perspecta-workflow"
cmp main.js "$DEST/main.js" && cmp styles.css "$DEST/styles.css" && echo "byte-identical"
```
Expected: "byte-identical".

- [ ] **Step 4: Manual acceptance (user reload)**

Reload plugin, open `meeting-followup.pflow`, verify: bigger arrowheads;
right-click add menu; selection ring; delete-with-confirm; inspector rename +
type pulldown + orphan confirm; empty-canvas workflow config.

- [ ] **Step 5: Commit any final fixes**

```bash
git add -A && git commit -m "chore(pflow-editor): phase-1 editor UX gate (tests, build, deploy verified)"
```

---

## Self-review notes

- **Spec coverage:** §1 selection→T9; §2 add-menu→T10/T2; §3 delete→T11/T4/T8;
  §4 name+type→T12/T5/T6; §5 workflow config→T13/T7; §6 orphan check→T6/T12;
  §7 arrowheads→T1. All Phase-1 spec items have tasks.
- **Type consistency:** helpers use `PflowDocument`, `PflowNode`, `Port`,
  `Wire`, `NodeKind` from `@perspecta/core`; `confirmModal` signature is
  `(app, title, body, confirmText?)` after T12 refines it.
- **Known risk flagged inline:** `PortSchema.default` may need a core schema
  extension (T7); `useSvelteFlow().screenToFlowPosition` and `app` threading
  (T10/T11) are verified-against-library steps, not assumed.

Phases 2 (loop/output codegen) and 3 (faithful re-migration) get their own
plan after Phase 1 lands and the user confirms the editor is usable.
