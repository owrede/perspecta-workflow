# Perspecta Workflow — Workflow-Canvas Identity, Guided Node Types & Auto-Color (Phase 1.5)

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Repo:** `~/Documents/GitHub/perspecta-workflow`
**Branch:** `feature/workflow-identity-and-autocolor`
**Depends on:** Phase 1 plugin (`2026-06-03-obsidian-plugin-phase1-design.md`) — already merged to `main`.

## Purpose

Phase 1 ships author + validate, but every command guesses whether the active
`.canvas` is a workflow ("is the extension `.canvas`?") and node coloring is a
manual command. This phase makes a workflow canvas an **explicit, recognized
thing** and makes the authoring experience guided and automatic:

1. **Workflow-canvas identity** — a durable marker in the `.canvas` JSON so the
   plugin acts ONLY on real workflow canvases and leaves ordinary canvases
   completely untouched. A visible corner badge shows the canvas is a workflow.
2. **Guided node types** — a "Set node type" picker (the 8 valid types) instead
   of free-typing a string into frontmatter.
3. **Auto-color** — nodes always reflect their `node_type` color, silently, no
   command needed.

All three gate on the identity marker. This is the through-line: **identity
first, then everything keys off it.**

## Motivating problems (from real use)

- A freshly authored canvas's nodes render gray until the user runs a command —
  the user expects color to follow `node_type` automatically.
- `node_type` is a free string; users have no idea the 8 valid values exist.
- Nothing distinguishes a workflow canvas from a normal mind-map canvas, so
  plugin behavior (lint, color) would wrongly apply to any canvas.

## Architecture

### The marker (foundation)

A top-level key in the canvas JSON, alongside `nodes`/`edges`:

```json
{
  "perspecta": { "workflow": true, "version": 1 },
  "nodes": [ ... ],
  "edges": [ ... ]
}
```

The [JSON Canvas spec](https://jsoncanvas.org) requires tools to **preserve
unknown top-level keys**, so Obsidian round-trips this untouched. The marker
travels with the file (no sidecar, no desync).

**Core** owns the marker contract (so both the plugin and any future consumer
agree):

```typescript
// packages/core/src/marker.ts
export const WORKFLOW_MARKER_KEY = "perspecta";
export const WORKFLOW_MARKER_VERSION = 1;

export interface WorkflowMarker { workflow: boolean; version: number; }

/** True iff the parsed canvas JSON carries the workflow marker. */
export function isWorkflowCanvas(canvasJson: unknown): boolean { ... }

/** Return canvas JSON with the marker stamped (idempotent). Pure string→string
 *  at the plugin boundary; here it takes/returns the parsed object. */
export function stampWorkflowMarker(canvas: Record<string, unknown>): Record<string, unknown> { ... }
```

`isWorkflowCanvas` is the single seam every feature checks. Core stays pure
(no fs) — the plugin reads the canvas text, parses, and calls these.

### Gating rule (applies everywhere)

Every plugin feature that mutates or interprets a canvas first checks
`isWorkflowCanvas`:

| Feature | If marker present | If marker absent |
|---|---|---|
| Auto-color (open/modify) | apply colors | do nothing (silent) |
| Validate command | run lint | Notice: "Not a workflow canvas. Run 'Use canvas as workflow' first." |
| Set node type | open picker | Notice: "Not a workflow canvas." |
| Corner badge | show "Workflow" pill | no badge |
| Insert node | stamp marker if missing, then insert | (same — inserting implies intent) |

Ordinary canvases are invisible to the plugin. This is the core behavioral
guarantee of this phase.

### MCP server: deliberately path-driven (asymmetry, documented)

The MCP server (`workflow_lint`, `workflow_start`, …) is **NOT** changed to
enforce the marker. The MCP caller already chose a specific canvas path
explicitly; the marker solves the plugin's "which of many open canvases is a
workflow" problem, which the MCP server doesn't have. Adding marker enforcement
to MCP would break callers that lint a canvas by path. This asymmetry is
intentional: **plugin gates on the marker; MCP stays path-driven.** Noted here so
it's a decision, not an oversight.

## Feature 1 — Identity + corner badge

### "Use canvas as workflow" command

`Perspecta: Use canvas as workflow` → reads the active `.canvas`, stamps
`perspecta: { workflow: true, version: 1 }` via `stampWorkflowMarker`, writes it
back through `vault.process` (atomic), refreshes the badge. Idempotent: running
it on an already-marked canvas is a no-op (Notice: "Already a workflow canvas").
If the active file isn't a `.canvas`: Notice "Open a canvas first".

### Corner badge

A small non-interactive pill reading **"Workflow"** (with a subtle icon),
pinned **top-left**, semi-transparent, hovering over the canvas content and
**sticky to the view edges** as the user pans/zooms.

**Mechanism:** the badge is an absolutely-positioned `<div>` injected into the
canvas leaf's view container (`leaf.view.containerEl`). Because it's a sibling
overlay (not inside the pannable canvas coordinate layer), it stays fixed to the
view corner. It is plugin-rendered view-state, re-attached on canvas open /
active-leaf change, removed on unload.

**Fragility + safe fallback (explicit decision):** the canvas view is not a
public-API typed view; reaching `containerEl` and injecting is a community
technique — stable in practice, not guaranteed across Obsidian versions. So:

- The injection is wrapped in a guard. If the expected container can't be
  found, it **fails silently** (no badge, no crash).
- A **status-bar indicator** ("⬡ Workflow") also lights up when the active
  canvas is a workflow — 100% public API. This is the resilient fallback that
  always works even if the overlay can't attach.

Badge placement/attachment lives in `live/badge.ts`; it is purely visual and
carries ALL the internal-DOM risk, isolated from the marker logic (which is
robust JSON).

## Feature 2 — Guided node types ("Set node type")

`Perspecta: Set node type` → only active on a marked canvas. Opens an Obsidian
`SuggestModal` listing the **8 node types** with one-line descriptions:

| type | description |
|---|---|
| start | entry point of the workflow |
| end | terminal node |
| prompt | an instruction for the agent |
| tool | a tool call (e.g. write_note) |
| data | read a note / data source |
| contract | a vault-memory contract |
| loop | conditional loop / branch-back |
| config | workflow parameters (e.g. maxloops) |

The list comes from core's `NODE_TYPES` (single source of truth) — no
duplicated literal. On selection, the command resolves the **target node-note**
(the `.md` for the selected canvas node; v1.5: the currently-focused/selected
canvas node, falling back to a chooser if ambiguous), writes `node_type` into
its frontmatter **preserving all other frontmatter and body** (this is the
write_note-frontmatter discipline — never blow away YAML), and triggers a
recolor. `node_type` remains a scalar string; the engine is unchanged.

**Node-note frontmatter write** is a small, tested helper
(`setNodeTypeInFrontmatter(noteText, nodeType): string`) that parses the
frontmatter block, sets/replaces `node_type`, and re-serializes — leaving
`class: WorkflowNode`, `outputs`, `tool`, etc. intact.

## Feature 3 — Auto-color (default ON, silent)

Nodes always reflect their `node_type` color on a marked canvas, with no
command.

### Triggers

1. **On canvas open** — `workspace.on("file-open")` (and active-leaf change): if
   the active file is a marked `.canvas`, color it.
2. **On modify (debounced ~400ms)** — `vault.on("modify")`: if the changed file
   is a marked `.canvas`, OR a `.md` node-note referenced by a currently-open
   marked canvas, recolor that canvas.

Reuses the existing `computeRecoloredCanvas` (Phase 1) unchanged.

### Write-loop guard (critical)

Auto-color writes the canvas → fires `modify` → would retrigger color → loop.
Three layers prevent this:

1. `computeRecoloredCanvas` returns `null` when **no** color changed; the plugin
   only writes when non-null. The second pass yields null → no write.
2. A short-lived **self-write suppression set**: when the plugin writes path P,
   it records P; a `modify` for P arriving within the debounce window is
   ignored once.
3. Debounce coalesces bursts so rapid edits cause at most one recolor.

### Failure handling

The watcher swallows errors silently (no Notice on every keystroke). Auto-color
is best-effort; the explicit `Validate`/`Apply node colors` commands still
surface errors loudly.

### Setting

Repurpose the unused `autoColorOnSave` toggle → rename to **`autoColor`**,
**default `true`**. When off, behavior falls back to command-only. Drop the
stale `liveValidation` toggle's coupling to this (live validation stays
deferred; the toggle remains as a no-op placeholder or is removed — see Scope).

## File structure

```
packages/core/src/
  marker.ts                     WORKFLOW_MARKER_KEY/VERSION, isWorkflowCanvas, stampWorkflowMarker
  index.ts                      (barrel: + export * from "./marker.js")
packages/core/test/
  marker.test.ts

packages/obsidian-plugin/src/
  commands/convertToWorkflow.ts  stamp marker into a canvas JSON string (pure, testable) + command glue
  commands/setNodeType.ts        setNodeTypeInFrontmatter (pure, testable) + SuggestModal glue
  live/colorWatcher.ts           debounced trigger logic (pure core + clock/vault seams, testable)
  live/badge.ts                  corner overlay attach/detach + status-bar fallback (visual, manual-tested)
  main.ts                        wire commands, registerEvent(open/modify), settings
  settings.ts                    autoColor (default true); tidy stale toggles
packages/obsidian-plugin/test/
  convertToWorkflow.test.ts
  setNodeType.test.ts
  colorWatcher.test.ts           fake clock + fake vault: debounce, marker-gating, write-loop suppression
```

## Testing

- **core:** `isWorkflowCanvas` (present / absent / malformed), `stampWorkflowMarker`
  (stamps, idempotent, preserves nodes/edges/unknown keys).
- **plugin (unit, mocked Vault + fake clock):**
  - `convertToWorkflow`: stamps marker into a canvas JSON string; idempotent.
  - `setNodeTypeInFrontmatter`: sets/replaces `node_type`, preserves all other
    frontmatter + body; handles a note with no `node_type` yet.
  - `colorWatcher`: a modify on a marked canvas triggers one recolor after the
    debounce; a modify on an UNMARKED canvas triggers nothing; a self-write is
    suppressed (no second recolor); a modify on a referenced node-note recolors
    the parent canvas.
- **badge / Obsidian wiring:** verified by build + manual test (overlay injection
  and status-bar are Obsidian-API surface, not headlessly testable). Manual
  checklist in the plugin README.

## Error handling

- "Use canvas as workflow" on a non-canvas → Notice "Open a canvas first".
- "Set node type" / "Validate" on an unmarked canvas → Notice "Not a workflow
  canvas. Run 'Use canvas as workflow' first."
- Malformed canvas JSON → Notice with parse error; no crash; badge not shown.
- Badge container not found → silent; status-bar fallback covers it.
- Auto-color errors → swallowed (best-effort).

## Migration

The two existing example canvases (`example-person-brief/person-brief.canvas`
and `_agents/workflows/meeting-followup/meeting-followup.canvas` in the vault)
predate the marker. The plan stamps the marker into the in-repo example and
documents that vault canvases get the marker via "Use canvas as workflow" (a
one-time command per existing canvas). No automatic vault migration (the plugin
does not rewrite canvases it hasn't been told are workflows — that's the whole
point).

## Scope

### In (this phase)
- Core marker contract + `isWorkflowCanvas` + `stampWorkflowMarker`.
- "Use canvas as workflow" command.
- Corner badge overlay + status-bar fallback.
- "Set node type" picker (8 types from `NODE_TYPES`), frontmatter-preserving write.
- Auto-color on open + debounced modify, marker-gated, write-loop-guarded,
  default ON.
- Marker-gating retrofit on existing Validate / Apply-colors / Insert commands.
- Stamp the in-repo example canvas; README manual-test + the 8-type reference.

### Out (deferred)
- Live **validation** (re-lint on edit, status pill) — the badge stays
  label-only; lint-state-in-badge is explicitly NOT in scope (deferred option).
- MCP server marker enforcement (intentional asymmetry).
- Per-canvas-node → node-note mapping beyond "selected/active node, else chooser".
- Multi-type insert commands (still just insert-prompt; other types via Set node
  type after insert).
- Phase 2 (walk panel) / Phase 3 (LLM execution).

## Open questions / deferred

- **Selected-canvas-node resolution:** Obsidian's canvas selection API for "which
  node is focused" is not fully public. v1.5 resolves the target node-note by the
  active selection if reachable, else presents a quick chooser of the canvas's
  node-notes. If selection proves unreadable, "Set node type" falls back to
  always-chooser (still fully functional). Confirmed acceptable for v1.5.
- **Badge exact CSS** (offset, opacity, theme variables) is cosmetic; the plan
  picks sensible `var(--*)` values and the user can refine.
