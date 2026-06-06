# pflow editor — resizable inspector sidebar

Date: 2026-06-06
Branch: `feat/pflow-m2-editor`
Status: approved design, pre-implementation

## Motivation

The pflow editor's inspector is a fixed 320px column. The user wants it
resizable, the way Obsidian's own sidebars are — drag a divider to widen or
narrow it, and have the chosen width persist across reloads. (Moving the
inspector into a real Obsidian sidebar leaf is explicitly out of scope for now;
see "Out of scope".)

## Decisions (from brainstorming Q&A)

- **Resizable in place** — keep the inspector inside the `.pflow-editor` view;
  add a draggable divider between the canvas and the inspector. No native-leaf
  refactor now.
- Persist the width in the document's `editor` block so it survives reload
  (consistent with how node positions / viewport are already persisted there).

## Scope

`editor.svelte` (layout + drag), one additive field on the document schema, and
one immutable helper in `flow-map.ts`. No codegen changes. Files:

- `packages/core/src/pflow/schema.ts` — add optional `inspectorWidth: number`
  to the `editor` object.
- `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts` — add
  `applyInspectorWidth(doc, width)` (immutable upsert into `editor`), and a
  `DEFAULT_INSPECTOR_WIDTH`, `MIN_INSPECTOR_WIDTH`, `MAX_INSPECTOR_WIDTH`
  constant trio used by both the helper (clamp) and the component.
- `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte` — replace the
  fixed grid column with a width-driven one, render a divider, wire the drag.

## Design

### Schema (additive, backward-compatible)

`editor` gains `inspectorWidth: z.number().optional()`. Old documents without it
load fine; the component falls back to `DEFAULT_INSPECTOR_WIDTH`.

### Constants (flow-map.ts)

```ts
export const DEFAULT_INSPECTOR_WIDTH = 320;
export const MIN_INSPECTOR_WIDTH = 240;
export const MAX_INSPECTOR_WIDTH = 640;
```

`MAX` is a fixed px cap (not a percentage of the view) — simple, and the canvas
keeps `1fr` so it always gets the remainder. If the view is narrower than
MIN+canvas the grid just lets the canvas shrink; we do not need a dynamic max.

### Helper (flow-map.ts)

```ts
export function applyInspectorWidth(doc: PflowDocument, width: number): PflowDocument {
  const clamped = Math.max(MIN_INSPECTOR_WIDTH, Math.min(MAX_INSPECTOR_WIDTH, Math.round(width)));
  const editor = doc.editor ?? { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] };
  return { ...doc, editor: { ...editor, inspectorWidth: clamped } };
}
```

Immutable, clamps, rounds (keeps the persisted number tidy). Same `editor`
default shape used by the existing `applyNodePosition`.

### Layout + drag (editor.svelte)

- A `$state` `width`, initialized from `doc.editor?.inspectorWidth ??
  DEFAULT_INSPECTOR_WIDTH`. A `$effect` re-syncs it when the document's saved
  width changes (e.g. external reload), mirroring how `doc = file` re-syncs.
- Grid: `grid-template-columns: 1fr <divider> <width>px` — canvas `1fr`, a
  thin divider track, the inspector at `width`px.
- Divider: a 6px-wide `<div class="pflow-editor__divider">` with
  `cursor: col-resize`, a hover/active accent, and `role="separator"`
  `aria-orientation="vertical"`.
- Drag model (pointer events, no library):
  - `onpointerdown` on the divider: capture the pointer
    (`setPointerCapture`), record `startX = e.clientX` and `startWidth = width`,
    set a `dragging` flag.
  - `onpointermove` (while dragging): `width = clamp(startWidth - (e.clientX -
    startX))` — subtract because the inspector is on the RIGHT (dragging the
    divider left widens it). Clamp inline to MIN/MAX so the live drag never
    overshoots. This updates only local `$state` — no document write per move
    (avoids spamming `onChange`/file writes on every pixel).
  - `onpointerup` / `onlostpointercapture`: clear `dragging`, then commit once
    via `commit(applyInspectorWidth(doc, width))` — a single persisted write at
    the end of the drag.
  - `ondblclick` on the divider: reset to `DEFAULT_INSPECTOR_WIDTH` and commit.
- While `dragging`, add a `user-select: none` guard (a class on the editor root)
  so text isn't selected mid-drag, and so the divider keeps the col-resize
  cursor across the whole viewport.

### Why local-state-during-drag, persist-on-release

The canvas (SvelteFlow) is expensive to re-layout. Writing the document on every
pointermove would call `onChange` → file serialize on each pixel. Driving the
CSS width from local `$state` during the drag keeps it smooth; we persist once
on release. This mirrors the node-drag pattern already established
(xyflow owns live position; the document is written only at drag-stop).

## Testing

- `flow-map.test.ts`: unit-test `applyInspectorWidth` — clamps below MIN, clamps
  above MAX, rounds, upserts into a doc with no `editor`, overwrites an existing
  value, and does not mutate the input.
- Schema: a `.pflow` doc with `editor.inspectorWidth` parses; one without it
  still parses (backward compat). Add to the existing pflow schema test if one
  exists, else a focused assertion in the core test suite.
- Manual: reload the plugin, drag the divider (both directions), confirm clamp,
  double-click to reset, reload again and confirm the width persisted.
- Gate: full build, both typechecks, all existing tests pass, deploy
  byte-identical, manual visual check.

## Out of scope

- Moving the inspector into a native Obsidian sidebar leaf (separate, larger
  effort — cross-view state sync). May be revisited later.
- Resizing the canvas independently / a second divider.
- Collapsing the inspector to zero (a hide toggle) — not requested.
