# pflow Resizable Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the pflow editor's inspector sidebar resizable by dragging a divider, with the width persisted across reloads.

**Architecture:** A draggable divider between the canvas and inspector drives a local `$state` width during the drag (smooth, no per-pixel document writes); the width persists once on pointer-release into a new additive `editor.inspectorWidth` field on the document. An immutable `applyInspectorWidth` helper clamps and upserts the value.

**Tech Stack:** Svelte 5 (runes), Zod schema (`@perspecta/core`), vitest, pointer events.

---

### Task 1: Schema — add optional `editor.inspectorWidth`

**Files:**
- Modify: `packages/core/src/pflow/schema.ts:67-80`
- Test: `packages/core/test/` (locate the existing pflow schema test; if none, add `packages/core/test/pflow-schema.test.ts`)

- [ ] **Step 1: Find the schema test (if any)**

Run: `cd packages/core && rg -l "parsePflow|PflowDocumentZ" test/`
Expected: a path, or no output (then create the new test file in Step 2).

- [ ] **Step 2: Write the failing test**

If an existing pflow schema test was found, ADD these cases there. Otherwise create `packages/core/test/pflow-schema.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePflow } from "../src/pflow/schema.js";

const BASE = {
  pflowFormatVersion: 1 as const,
  workflow: { name: "demo", description: "d" },
  nodes: [],
  wires: [],
};

describe("editor.inspectorWidth", () => {
  it("parses a document that carries inspectorWidth", () => {
    const doc = parsePflow(
      JSON.stringify({
        ...BASE,
        editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [], inspectorWidth: 420 },
      }),
    );
    expect(doc.editor!.inspectorWidth).toBe(420);
  });
  it("parses a document with editor but no inspectorWidth (backward compat)", () => {
    const doc = parsePflow(
      JSON.stringify({
        ...BASE,
        editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
      }),
    );
    expect(doc.editor!.inspectorWidth).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/pflow-schema.test.ts` (or the existing test path)
Expected: the "carries inspectorWidth" case FAILS — Zod strips/loses the unknown key, so `inspectorWidth` is `undefined` and the `toBe(420)` assertion fails. (If the project's Zod is in strict mode it may instead throw; either is a valid red.)

- [ ] **Step 4: Add the field**

In `packages/core/src/pflow/schema.ts`, inside the `editor` object (after `nodePositions: z.array(...)`, before the closing `})` of the object), add:

```ts
      inspectorWidth: z.number().optional(),
```

The `editor` object becomes:

```ts
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
      inspectorWidth: z.number().optional(),
    })
    .optional(),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/pflow-schema.test.ts`
Expected: PASS (both cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pflow/schema.ts packages/core/test/pflow-schema.test.ts
git commit -m "feat(pflow): add optional editor.inspectorWidth to schema"
```

---

### Task 2: flow-map — constants + `applyInspectorWidth`

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts` (add constants near `NODE_WIDTH` ~line 23; add helper near `applyNodePosition` ~line 71)
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/obsidian-plugin/test/flow-map.test.ts`:

```ts
import {
  applyInspectorWidth,
  MIN_INSPECTOR_WIDTH,
  MAX_INSPECTOR_WIDTH,
} from "../src/views/pflow-editor/flow-map.js";

describe("applyInspectorWidth", () => {
  it("upserts the width into a doc, creating editor if absent", () => {
    const noEditor: PflowDocument = { ...DOC, editor: undefined };
    const next = applyInspectorWidth(noEditor, 400);
    expect(next.editor!.inspectorWidth).toBe(400);
    expect(next.editor!.nodePositions).toEqual([]);
  });
  it("clamps below the minimum", () => {
    expect(applyInspectorWidth(DOC, 10).editor!.inspectorWidth).toBe(MIN_INSPECTOR_WIDTH);
  });
  it("clamps above the maximum", () => {
    expect(applyInspectorWidth(DOC, 9999).editor!.inspectorWidth).toBe(MAX_INSPECTOR_WIDTH);
  });
  it("rounds to an integer", () => {
    expect(applyInspectorWidth(DOC, 321.7).editor!.inspectorWidth).toBe(322);
  });
  it("does not mutate the input document", () => {
    applyInspectorWidth(DOC, 400);
    expect(DOC.editor!.inspectorWidth).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/flow-map.test.ts`
Expected: FAIL — `applyInspectorWidth` / `MIN_INSPECTOR_WIDTH` / `MAX_INSPECTOR_WIDTH` are not exported (import or reference error).

- [ ] **Step 3: Add constants**

In `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`, after the `NODE_WIDTH` export (~line 23), add:

```ts
/** Inspector sidebar width bounds (px). DEFAULT is used when a document has no
 *  saved width; MIN/MAX clamp both the live drag and the persisted value. */
export const DEFAULT_INSPECTOR_WIDTH = 320;
export const MIN_INSPECTOR_WIDTH = 240;
export const MAX_INSPECTOR_WIDTH = 640;
```

- [ ] **Step 4: Add the helper**

In the same file, after `applyNodePosition` (~line 76), add:

```ts
/** Return a new document with the inspector width set (clamped to the
 *  MIN/MAX bounds and rounded). Creates the editor block if absent. Immutable. */
export function applyInspectorWidth(doc: PflowDocument, width: number): PflowDocument {
  const clamped = Math.max(
    MIN_INSPECTOR_WIDTH,
    Math.min(MAX_INSPECTOR_WIDTH, Math.round(width)),
  );
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  return { ...doc, editor: { ...editor, inspectorWidth: clamped } };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/flow-map.test.ts`
Expected: PASS (all cases, including the existing suite).

- [ ] **Step 6: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): applyInspectorWidth helper + width bounds"
```

---

### Task 3: editor.svelte — divider + drag + persist

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte` (script: imports + width state + drag handlers; markup: divider; style: grid + divider + drag guard)

This task has no unit test (Svelte component, no component-test harness in this plugin — consistent with the inspector redesign). Verified by build + typecheck + manual reload, per the spec.

- [ ] **Step 1: Import the helper + constants**

In `editor.svelte`, extend the existing `flow-map.js` import block (currently ends with `applyArgDefault,`) to add:

```ts
    applyInspectorWidth,
    DEFAULT_INSPECTOR_WIDTH,
```

(MIN/MAX are enforced inside `applyInspectorWidth` and the inline drag clamp; import them too if you prefer to clamp the live drag with the named constants rather than re-deriving — import `MIN_INSPECTOR_WIDTH, MAX_INSPECTOR_WIDTH` as well.)

- [ ] **Step 2: Add width state + re-sync effect**

After the existing `let selectedId = $state<string | null>(null);` and the `$effect(() => { doc = file; });`, add:

```ts
  // Inspector width: local state during a drag (smooth, no per-pixel doc write),
  // persisted once on release. Re-sync from the document when it changes
  // (e.g. external reload), mirroring `doc = file`.
  let inspectorWidth = $state<number>(file.editor?.inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH);
  $effect(() => {
    inspectorWidth = doc.editor?.inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH;
  });

  let draggingDivider = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  function onDividerPointerDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingDivider = true;
    dragStartX = e.clientX;
    dragStartWidth = inspectorWidth;
    e.preventDefault();
  }
  function onDividerPointerMove(e: PointerEvent) {
    if (!draggingDivider) return;
    // Inspector is on the RIGHT: dragging the divider left (clientX decreases)
    // widens it, so subtract the delta. Clamp live to the same bounds the
    // persisted helper uses.
    const next = dragStartWidth - (e.clientX - dragStartX);
    inspectorWidth = Math.max(MIN_INSPECTOR_WIDTH, Math.min(MAX_INSPECTOR_WIDTH, next));
  }
  function endDividerDrag() {
    if (!draggingDivider) return;
    draggingDivider = false;
    commit(applyInspectorWidth(doc, inspectorWidth)); // single persisted write
  }
  function onDividerDblClick() {
    inspectorWidth = DEFAULT_INSPECTOR_WIDTH;
    commit(applyInspectorWidth(doc, DEFAULT_INSPECTOR_WIDTH));
  }
```

Note: this references `MIN_INSPECTOR_WIDTH` / `MAX_INSPECTOR_WIDTH` — ensure they are imported (Step 1).

- [ ] **Step 3: Add the divider to the markup**

In the `.pflow-editor` div, insert a divider element BETWEEN `.pflow-editor__canvas` and `.pflow-editor__inspector`:

```svelte
<div class="pflow-editor" class:pflow-editor--dragging={draggingDivider}>
  <div class="pflow-editor__canvas">
    <CanvasPane
      {flowNodes}
      {flowEdges}
      {onMove}
      {onConnect}
      {onAddNode}
      {onDeleteRequest}
      selectedId={selectedId}
      onSelect={(id) => (selectedId = id)}
    />
  </div>
  <div
    class="pflow-editor__divider"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize inspector"
    onpointerdown={onDividerPointerDown}
    onpointermove={onDividerPointerMove}
    onpointerup={endDividerDrag}
    onlostpointercapture={endDividerDrag}
    ondblclick={onDividerDblClick}
  ></div>
  <div class="pflow-editor__inspector" style:width={`${inspectorWidth}px`}>
    <InspectorPane
      node={selectedNode}
      {workflow}
      {argDefaults}
      {onPrompt}
      {onRename}
      {onKindChange}
      {onWorkflowMeta}
      {onArgDefault}
    />
  </div>
</div>
```

- [ ] **Step 4: Update the styles**

Replace the existing `<style>` block's `.pflow-editor` grid and inspector rules. The grid changes from `1fr 320px` to `1fr auto auto` (divider + inspector size themselves; the inspector's width comes from the inline `style:width`). Add the divider + dragging-guard rules:

```svelte
<style>
  .pflow-editor {
    display: grid;
    grid-template-columns: 1fr auto auto;
    grid-template-rows: 100%;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  /* While dragging the divider, suppress text selection and keep the resize
     cursor across the whole editor so the drag feels anchored. */
  .pflow-editor--dragging {
    user-select: none;
    cursor: col-resize;
  }
  .pflow-editor__canvas {
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }
  .pflow-editor__divider {
    width: 6px;
    height: 100%;
    cursor: col-resize;
    background: var(--background-modifier-border);
    flex: none;
    transition: background 80ms ease-out;
  }
  .pflow-editor__divider:hover,
  .pflow-editor--dragging .pflow-editor__divider {
    background: var(--interactive-accent);
  }
  .pflow-editor__inspector {
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    /* width comes from the inline style:width binding */
  }
</style>
```

(The previous inspector rule had `border-left: 1px solid var(--background-modifier-border)`; the 6px divider now provides that separation, so the border-left is dropped to avoid a double line.)

- [ ] **Step 5: Build + typecheck**

Run: `cd packages/obsidian-plugin && npm run build && npm run typecheck` (use the repo's actual script names if different — check `package.json`)
Expected: clean build, no type errors.

- [ ] **Step 6: Run the full plugin test suite**

Run: `cd packages/obsidian-plugin && npx vitest run`
Expected: all tests pass (the divider has no unit test; nothing regressed).

- [ ] **Step 7: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/editor.svelte
git commit -m "feat(pflow-editor): resizable inspector via draggable divider"
```

---

### Task 4: Deploy + manual verification

**Files:** none (deploy + manual).

- [ ] **Step 1: Deploy to the vault and verify byte-identical**

Run the repo's existing deploy step for the plugin (the same one used in prior tasks — e.g. the build copies `main.js`/`styles.css`/`manifest.json` into the Intelligence Impact vault's `.obsidian/plugins/...`). After deploying, confirm the deployed `main.js`/`styles.css` match the freshly built ones (`cmp` byte-identical), per the verify-deployed-artifacts discipline.

- [ ] **Step 2: Manual check in Obsidian**

Reload the plugin, open a `.pflow` file, then:
- Drag the divider left → inspector widens; drag right → narrows.
- Confirm it stops at MIN (240) and MAX (640).
- Double-click the divider → resets to 320.
- Reload the file → the last dragged width persisted.

- [ ] **Step 3: Final commit (only if Step 1/2 surfaced fixes)**

If the manual check surfaced a fix, commit it with a descriptive message. Otherwise nothing to commit here.
