# Workflow Identity, Guided Node Types & Auto-Color — Implementation Plan (Phase 1.5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a workflow canvas an explicit, recognized thing (a marker in the canvas JSON) that the plugin gates all behavior on; add a corner "Workflow" badge, a guided "Set node type" picker, and silent auto-coloring on open/edit.

**Architecture:** Core gains a tiny marker contract (`isWorkflowCanvas`/`stampWorkflowMarker`, pure, no fs). The plugin gates every canvas feature on the marker, stamps it via a "Use canvas as workflow" command, shows a corner overlay badge (with a status-bar fallback), offers a Set-node-type SuggestModal sourced from core's `NODE_TYPES`, and runs debounced marker-gated auto-color on `file-open` + `modify`.

**Tech Stack:** Node 24, TypeScript 6, vitest 4, npm workspaces, esbuild, `obsidian` 1.13 typings. Reuses Phase-1 `computeRecoloredCanvas`, `preloadCanvas`/`VaultReader`, `ObsidianFileSystem`.

**Spec:** `docs/specs/2026-06-04-workflow-identity-and-autocolor-design.md`

**Branch:** `feature/workflow-identity-and-autocolor` (already created). Commit trailer for every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure (end state)

```
packages/core/src/
  marker.ts                      # NEW: marker constants + isWorkflowCanvas + stampWorkflowMarker
  index.ts                       # MOD: export * from "./marker.js"
packages/core/test/
  marker.test.ts                 # NEW

packages/obsidian-plugin/src/
  commands/convertToWorkflow.ts  # NEW: stampCanvasJson (pure) — stamps marker into a canvas JSON string
  commands/setNodeType.ts        # NEW: setNodeTypeInFrontmatter (pure) + NODE_TYPE_OPTIONS
  live/colorWatcher.ts           # NEW: ColorWatcher (debounced, marker-gated, write-loop-guarded)
  live/badge.ts                  # NEW: WorkflowBadge (corner overlay + status-bar fallback)
  main.ts                        # MOD: wire commands, events, badge, watcher
  settings.ts                    # MOD: autoColor (default true); drop liveValidation coupling
packages/obsidian-plugin/test/
  convertToWorkflow.test.ts       # NEW
  setNodeType.test.ts             # NEW
  colorWatcher.test.ts            # NEW
```

---

# PART A — Core marker contract

## Task A1: marker.ts + tests

**Files:**
- Create: `packages/core/src/marker.ts`, `packages/core/test/marker.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test `packages/core/test/marker.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { isWorkflowCanvas, stampWorkflowMarker, WORKFLOW_MARKER_KEY, WORKFLOW_MARKER_VERSION } from "../src/marker.js";

describe("isWorkflowCanvas", () => {
  it("is true when the marker is present and workflow:true", () => {
    expect(isWorkflowCanvas({ perspecta: { workflow: true, version: 1 }, nodes: [], edges: [] })).toBe(true);
  });
  it("is false when the marker is absent", () => {
    expect(isWorkflowCanvas({ nodes: [], edges: [] })).toBe(false);
  });
  it("is false when workflow is not true", () => {
    expect(isWorkflowCanvas({ perspecta: { workflow: false, version: 1 } })).toBe(false);
  });
  it("is false on non-objects / malformed input", () => {
    expect(isWorkflowCanvas(null)).toBe(false);
    expect(isWorkflowCanvas("nope")).toBe(false);
    expect(isWorkflowCanvas({ perspecta: "x" })).toBe(false);
  });
});

describe("stampWorkflowMarker", () => {
  it("adds the marker with the current version", () => {
    const out = stampWorkflowMarker({ nodes: [], edges: [] });
    expect(out[WORKFLOW_MARKER_KEY]).toEqual({ workflow: true, version: WORKFLOW_MARKER_VERSION });
    expect(isWorkflowCanvas(out)).toBe(true);
  });
  it("is idempotent and preserves nodes/edges and unknown keys", () => {
    const input = { nodes: [{ id: "a" }], edges: [{ id: "e" }], someTool: { x: 1 } } as Record<string, unknown>;
    const once = stampWorkflowMarker(input);
    const twice = stampWorkflowMarker(once);
    expect(twice.nodes).toEqual([{ id: "a" }]);
    expect(twice.edges).toEqual([{ id: "e" }]);
    expect(twice.someTool).toEqual({ x: 1 });
    expect(twice[WORKFLOW_MARKER_KEY]).toEqual({ workflow: true, version: WORKFLOW_MARKER_VERSION });
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `npx vitest run packages/core/test/marker.test.ts`
Expected: FAIL, cannot find `../src/marker.js`.

- [ ] **Step 3: Write `packages/core/src/marker.ts`**

```typescript
export const WORKFLOW_MARKER_KEY = "perspecta";
export const WORKFLOW_MARKER_VERSION = 1;

export interface WorkflowMarker {
  workflow: boolean;
  version: number;
}

/** True iff the parsed canvas object carries a `perspecta` marker with workflow:true. */
export function isWorkflowCanvas(canvas: unknown): boolean {
  if (typeof canvas !== "object" || canvas === null) return false;
  const marker = (canvas as Record<string, unknown>)[WORKFLOW_MARKER_KEY];
  if (typeof marker !== "object" || marker === null) return false;
  return (marker as Record<string, unknown>).workflow === true;
}

/** Return the canvas object with the marker stamped (idempotent). Mutates a shallow copy. */
export function stampWorkflowMarker(canvas: Record<string, unknown>): Record<string, unknown> {
  return {
    ...canvas,
    [WORKFLOW_MARKER_KEY]: { workflow: true, version: WORKFLOW_MARKER_VERSION },
  };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run packages/core/test/marker.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Add to the core barrel `packages/core/src/index.ts`**

Add this line after the existing `export * from "./stepper.js";`:
```typescript
export * from "./marker.js";
```

- [ ] **Step 6: Build core + run the whole core suite**

Run: `npm run build -w @perspecta/core && npx vitest run packages/core`
Expected: tsc exit 0; all core tests pass (prior + marker).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/marker.ts packages/core/test/marker.test.ts packages/core/src/index.ts
git commit -m "$(cat <<'EOF'
feat(core): workflow-canvas marker contract (isWorkflowCanvas, stampWorkflowMarker)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PART B — Plugin: convert command + Set node type (pure logic first)

## Task B1: convertToWorkflow (stamp canvas JSON string)

**Files:**
- Create: `packages/obsidian-plugin/src/commands/convertToWorkflow.ts`, `packages/obsidian-plugin/test/convertToWorkflow.test.ts`

- [ ] **Step 1: Write the failing test `test/convertToWorkflow.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { stampCanvasJson } from "../src/commands/convertToWorkflow.js";
import { isWorkflowCanvas } from "@perspecta/core";

describe("stampCanvasJson", () => {
  it("stamps the marker into a canvas JSON string and pretty-prints", () => {
    const input = JSON.stringify({ nodes: [{ id: "a" }], edges: [] });
    const out = stampCanvasJson(input);
    const parsed = JSON.parse(out);
    expect(isWorkflowCanvas(parsed)).toBe(true);
    expect(parsed.nodes).toEqual([{ id: "a" }]);
    expect(out.endsWith("\n")).toBe(true);
  });
  it("returns null when the canvas is already a workflow (no rewrite needed)", () => {
    const already = JSON.stringify({ perspecta: { workflow: true, version: 1 }, nodes: [], edges: [] });
    expect(stampCanvasJson(already)).toBeNull();
  });
  it("throws on malformed JSON", () => {
    expect(() => stampCanvasJson("{not json")).toThrow();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run packages/obsidian-plugin/test/convertToWorkflow.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/commands/convertToWorkflow.ts`**

```typescript
import { stampWorkflowMarker, isWorkflowCanvas } from "@perspecta/core";

/**
 * Stamp the workflow marker into a canvas JSON string.
 * Returns the new pretty-printed JSON (trailing newline), or null if the canvas
 * already carries the marker (so the caller can skip the write).
 * Throws if the input is not valid JSON.
 */
export function stampCanvasJson(canvasJson: string): string | null {
  const raw = JSON.parse(canvasJson) as Record<string, unknown>;
  if (isWorkflowCanvas(raw)) return null;
  const stamped = stampWorkflowMarker(raw);
  return JSON.stringify(stamped, null, 2) + "\n";
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run packages/obsidian-plugin/test/convertToWorkflow.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/commands/convertToWorkflow.ts packages/obsidian-plugin/test/convertToWorkflow.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin): stampCanvasJson — mark a canvas as a workflow (pure)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task B2: setNodeType frontmatter helper + options

**Files:**
- Create: `packages/obsidian-plugin/src/commands/setNodeType.ts`, `packages/obsidian-plugin/test/setNodeType.test.ts`

**Design note:** `setNodeTypeInFrontmatter` does a SURGICAL edit — it replaces the `node_type:` line if present, or inserts one right after the opening `---`, preserving ALL other frontmatter lines and the body verbatim. This honors the write_note-frontmatter discipline (never blow away YAML). It does NOT round-trip through a YAML serializer (which would reformat/drop comments).

- [ ] **Step 1: Write the failing test `test/setNodeType.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { setNodeTypeInFrontmatter, NODE_TYPE_OPTIONS } from "../src/commands/setNodeType.js";

const NOTE = `---
class: WorkflowNode
node_type: prompt
outputs: [draft]
---
Draft something.
`;

describe("setNodeTypeInFrontmatter", () => {
  it("replaces an existing node_type, preserving other frontmatter and body", () => {
    const out = setNodeTypeInFrontmatter(NOTE, "tool");
    expect(out).toContain("node_type: tool");
    expect(out).not.toContain("node_type: prompt");
    expect(out).toContain("class: WorkflowNode");
    expect(out).toContain("outputs: [draft]");
    expect(out).toContain("Draft something.");
  });
  it("inserts node_type when the note has frontmatter but no node_type yet", () => {
    const note = `---\nclass: WorkflowNode\n---\nBody.\n`;
    const out = setNodeTypeInFrontmatter(note, "start");
    expect(out).toContain("class: WorkflowNode");
    expect(out).toContain("node_type: start");
    expect(out).toContain("Body.");
  });
  it("throws when the note has no frontmatter block", () => {
    expect(() => setNodeTypeInFrontmatter("no frontmatter here", "end")).toThrow();
  });
});

describe("NODE_TYPE_OPTIONS", () => {
  it("lists all 8 node types with descriptions, sourced from core", () => {
    expect(NODE_TYPE_OPTIONS).toHaveLength(8);
    const types = NODE_TYPE_OPTIONS.map((o) => o.type).sort();
    expect(types).toEqual(["config", "contract", "data", "end", "loop", "prompt", "start", "tool"]);
    for (const o of NODE_TYPE_OPTIONS) expect(o.description.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run packages/obsidian-plugin/test/setNodeType.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/commands/setNodeType.ts`**

```typescript
import { NODE_TYPES, type NodeType } from "@perspecta/core";

export interface NodeTypeOption { type: NodeType; description: string; }

const DESCRIPTIONS: Record<NodeType, string> = {
  start: "entry point of the workflow",
  end: "terminal node",
  prompt: "an instruction for the agent",
  tool: "a tool call (e.g. write_note)",
  data: "read a note / data source",
  contract: "a vault-memory contract",
  loop: "conditional loop / branch-back",
  config: "workflow parameters (e.g. maxloops)",
};

/** The 8 node types with descriptions, sourced from core's NODE_TYPES. */
export const NODE_TYPE_OPTIONS: NodeTypeOption[] = NODE_TYPES.map((type) => ({
  type,
  description: DESCRIPTIONS[type],
}));

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/**
 * Surgically set `node_type` in a node-note's frontmatter, preserving every
 * other frontmatter line and the body verbatim. Replaces an existing
 * `node_type:` line if present, otherwise inserts one after the opening `---`.
 * Throws if the note has no frontmatter block.
 */
export function setNodeTypeInFrontmatter(noteText: string, nodeType: NodeType): string {
  const m = noteText.match(FRONTMATTER_RE);
  if (!m) throw new Error("Node note has no frontmatter block");
  const fmBody = m[1];
  const lines = fmBody.split("\n");
  const idx = lines.findIndex((l) => /^node_type\s*:/.test(l));
  if (idx >= 0) {
    lines[idx] = `node_type: ${nodeType}`;
  } else {
    lines.unshift(`node_type: ${nodeType}`);
  }
  const newFm = lines.join("\n");
  return noteText.replace(FRONTMATTER_RE, `---\n${newFm}\n---`);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run packages/obsidian-plugin/test/setNodeType.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/commands/setNodeType.ts packages/obsidian-plugin/test/setNodeType.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin): setNodeTypeInFrontmatter + NODE_TYPE_OPTIONS (frontmatter-preserving)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PART C — Plugin: auto-color watcher (debounced, gated, loop-guarded)

## Task C1: ColorWatcher with fake clock + fake vault

**Files:**
- Create: `packages/obsidian-plugin/src/live/colorWatcher.ts`, `packages/obsidian-plugin/test/colorWatcher.test.ts`

**Design note:** The watcher is decoupled from Obsidian so it's testable. It depends on three injected seams: a `recolor(canvasPath)` function (wraps `computeRecoloredCanvas` + the write), an `isMarked(canvasPath)` async predicate, and a `schedule(fn, ms)` scheduler (real = setTimeout; test = fake clock). `main.ts` provides the Obsidian-backed implementations. The watcher records paths it just wrote in a suppression set to break the write→modify→recolor loop.

- [ ] **Step 1: Write the failing test `test/colorWatcher.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";
import { ColorWatcher } from "../src/live/colorWatcher.js";

function makeHarness(marked: Set<string>) {
  const recolored: string[] = [];
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const watcher = new ColorWatcher({
    debounceMs: 400,
    isMarked: async (p: string) => marked.has(p),
    recolor: async (p: string) => { recolored.push(p); return p.endsWith(".canvas") ? "wrote" : null; },
    schedule: (fn, ms) => { const id = timers.length; timers.push({ at: now + ms, fn }); return id as unknown as ReturnType<typeof setTimeout>; },
    clearScheduled: (id) => { const i = id as unknown as number; if (timers[i]) timers[i] = { at: Infinity, fn: () => {} }; },
  });
  const tick = (ms: number) => { now += ms; for (const t of timers) if (t.at <= now) { t.at = Infinity; t.fn(); } };
  return { watcher, recolored, tick };
}

describe("ColorWatcher", () => {
  it("recolors a marked canvas after the debounce", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set(["wf.canvas"]));
    watcher.onCanvasTouched("wf.canvas");
    expect(recolored).toEqual([]);    // not yet — debounced
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]);
  });

  it("does nothing for an unmarked canvas", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set());
    watcher.onCanvasTouched("plain.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual([]);
  });

  it("coalesces rapid touches into one recolor", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set(["wf.canvas"]));
    watcher.onCanvasTouched("wf.canvas");
    tick(100); watcher.onCanvasTouched("wf.canvas");
    tick(100); watcher.onCanvasTouched("wf.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]);
  });

  it("suppresses the self-write modify that follows a recolor", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set(["wf.canvas"]));
    watcher.onCanvasTouched("wf.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]);
    // the recolor wrote the file; simulate the resulting modify event
    watcher.onSelfWrite("wf.canvas");
    watcher.onCanvasTouched("wf.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]); // NOT recolored again
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run packages/obsidian-plugin/test/colorWatcher.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/live/colorWatcher.ts`**

```typescript
export interface ColorWatcherDeps {
  debounceMs: number;
  /** True if the canvas at this path carries the workflow marker. */
  isMarked: (canvasPath: string) => Promise<boolean>;
  /** Recolor + write the canvas; returns the written content or null if unchanged. */
  recolor: (canvasPath: string) => Promise<string | null>;
  schedule: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearScheduled: (id: ReturnType<typeof setTimeout>) => void;
}

/**
 * Debounced, marker-gated auto-color trigger with a self-write guard.
 * `onCanvasTouched(path)` is called for canvas opens and for modify events
 * affecting a canvas; `onSelfWrite(path)` records that the plugin itself just
 * wrote `path` so the resulting modify is ignored once.
 */
export class ColorWatcher {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private suppress = new Set<string>();

  constructor(private deps: ColorWatcherDeps) {}

  onSelfWrite(canvasPath: string): void {
    this.suppress.add(canvasPath);
  }

  onCanvasTouched(canvasPath: string): void {
    if (this.suppress.has(canvasPath)) { this.suppress.delete(canvasPath); return; }
    const existing = this.timers.get(canvasPath);
    if (existing !== undefined) this.deps.clearScheduled(existing);
    const id = this.deps.schedule(() => {
      this.timers.delete(canvasPath);
      void this.run(canvasPath);
    }, this.deps.debounceMs);
    this.timers.set(canvasPath, id);
  }

  private async run(canvasPath: string): Promise<void> {
    try {
      if (!(await this.deps.isMarked(canvasPath))) return;
      const wrote = await this.deps.recolor(canvasPath);
      if (wrote !== null) this.suppress.add(canvasPath);
    } catch {
      // best-effort: swallow (no Notice spam on every edit)
    }
  }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run packages/obsidian-plugin/test/colorWatcher.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/live/colorWatcher.ts packages/obsidian-plugin/test/colorWatcher.test.ts
git commit -m "$(cat <<'EOF'
feat(plugin): ColorWatcher — debounced, marker-gated auto-color with self-write guard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PART D — Plugin: badge (visual) + main wiring + settings

## Task D1: WorkflowBadge (corner overlay + status-bar fallback)

**Files:**
- Create: `packages/obsidian-plugin/src/live/badge.ts`
- Modify: `packages/obsidian-plugin/styles.css`

**Note:** Visual Obsidian wiring — verified by build + manual test, not unit tests. Keep logic minimal; the marker check is done by the caller.

- [ ] **Step 1: Append badge styles to `packages/obsidian-plugin/styles.css`**

```css
.perspecta-badge {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 20;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-on-accent);
  background: var(--interactive-accent);
  opacity: 0.85;
  pointer-events: none;
  user-select: none;
}
```

- [ ] **Step 2: Write `src/live/badge.ts`**

```typescript
import type { WorkspaceLeaf } from "obsidian";

const BADGE_CLASS = "perspecta-badge";

/**
 * Renders a non-interactive "Workflow" pill in the top-left of a canvas leaf's
 * view container, sticky to the view edge over the canvas content.
 *
 * The canvas view is not a public-API typed view; we reach its containerEl and
 * inject an absolutely-positioned overlay. If the container can't be found, we
 * fail silently — a status-bar indicator (managed by main.ts) is the fallback.
 */
export class WorkflowBadge {
  /** Attach the badge to a leaf if not already present. Returns true on success. */
  static attach(leaf: WorkspaceLeaf | null): boolean {
    if (!leaf) return false;
    const container = (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
    if (!container) return false;
    if (container.querySelector(`.${BADGE_CLASS}`)) return true;
    const el = container.createDiv({ cls: BADGE_CLASS, text: "Workflow" });
    // createDiv appends to container; ensure container is a positioning context.
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    el.setAttribute("aria-label", "Perspecta workflow canvas");
    return true;
  }

  /** Remove any badge from a leaf's container. */
  static detach(leaf: WorkspaceLeaf | null): void {
    if (!leaf) return;
    const container = (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
    container?.querySelectorAll(`.${BADGE_CLASS}`).forEach((n) => n.remove());
  }
}
```

- [ ] **Step 3: Type-check (no unit test for the badge)**

Run: `npx tsc -p packages/obsidian-plugin/tsconfig.json --noEmit`
Expected: zero errors. (If `createDiv` on a plain HTMLElement isn't seen, ensure the `obsidian` import is present — it augments HTMLElement. The `WorkspaceLeaf` import is type-only.)

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/live/badge.ts packages/obsidian-plugin/styles.css
git commit -m "$(cat <<'EOF'
feat(plugin): WorkflowBadge corner overlay + badge styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task D2: Settings — autoColor default true

**Files:**
- Modify: `packages/obsidian-plugin/src/settings.ts`

- [ ] **Step 1: Replace `packages/obsidian-plugin/src/settings.ts`**

```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import type PerspectaWorkflowPlugin from "./main.js";

export interface PerspectaSettings {
  nodeFolder: string;
  autoColor: boolean;
}

export const DEFAULT_SETTINGS: PerspectaSettings = {
  nodeFolder: "workflows",
  autoColor: true,
};

export class PerspectaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PerspectaWorkflowPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Node note folder")
      .setDesc("Where inserted WorkflowNode notes are created.")
      .addText((t) => t.setValue(this.plugin.settings.nodeFolder).onChange(async (v) => { this.plugin.settings.nodeFolder = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName("Auto-color workflow nodes")
      .setDesc("Automatically color nodes by type when a workflow canvas opens or changes.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoColor).onChange(async (v) => { this.plugin.settings.autoColor = v; await this.plugin.saveSettings(); }));
  }
}
```

- [ ] **Step 2: Type-check (main.ts still references old settings names — fixed in D3; expect errors until D3 is done)**

Run: `npx tsc -p packages/obsidian-plugin/tsconfig.json --noEmit`
Expected: errors ONLY about removed `autoColorOnSave`/`liveValidation` usages in main.ts (none currently use them — the Phase-1 main.ts only reads `nodeFolder`). If main.ts doesn't reference the removed fields, tsc is clean. Verify; if clean, good. Do NOT commit yet — fold into D3's commit so settings + wiring land together.

## Task D3: Wire commands, events, badge, watcher into main.ts

**Files:**
- Modify: `packages/obsidian-plugin/src/main.ts`

This task wires everything. The full new `main.ts`:

- [ ] **Step 1: Replace `packages/obsidian-plugin/src/main.ts`**

```typescript
import { Plugin, Notice, WorkspaceLeaf, SuggestModal, TFile } from "obsidian";
import { VERSION, isWorkflowCanvas, type NodeType } from "@perspecta/core";
import { ResultsView, VIEW_TYPE_PERSPECTA } from "./view/ResultsView.js";
import { runValidation } from "./commands/validate.js";
import { computeRecoloredCanvas } from "./commands/autocolor.js";
import { stampCanvasJson } from "./commands/convertToWorkflow.js";
import { setNodeTypeInFrontmatter, NODE_TYPE_OPTIONS, type NodeTypeOption } from "./commands/setNodeType.js";
import { ColorWatcher } from "./live/colorWatcher.js";
import { WorkflowBadge } from "./live/badge.js";
import { PerspectaSettingTab, DEFAULT_SETTINGS, type PerspectaSettings } from "./settings.js";
import { buildNodeNote, addFileNodeToCanvas } from "./commands/insertNode.js";

export default class PerspectaWorkflowPlugin extends Plugin {
  settings: PerspectaSettings = DEFAULT_SETTINGS;
  private watcher!: ColorWatcher;
  private statusEl: HTMLElement | null = null;

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  // ---- shared helpers ------------------------------------------------------

  private vaultReader() {
    return {
      read: (p: string) => this.app.vault.adapter.read(p),
      exists: (_p: string) => true,
    };
  }

  /** Read a canvas file and report whether it carries the workflow marker. */
  private async isMarkedCanvas(path: string): Promise<boolean> {
    try {
      const text = await this.app.vault.adapter.read(path);
      return isWorkflowCanvas(JSON.parse(text));
    } catch { return false; }
  }

  /** Recolor a canvas if marked; write back; tell the watcher we self-wrote. Returns written content or null. */
  private async recolorCanvas(path: string): Promise<string | null> {
    const out = await computeRecoloredCanvas(path, this.vaultReader());
    if (out == null) return null;
    this.watcher.onSelfWrite(path);
    await this.app.vault.adapter.write(path, out);
    return out;
  }

  private activeCanvas(): TFile | null {
    const f = this.app.workspace.getActiveFile();
    return f && f.extension === "canvas" ? f : null;
  }

  // ---- badge + status ------------------------------------------------------

  private async refreshBadge(): Promise<void> {
    const leaf = this.app.workspace.getMostRecentLeaf();
    const file = this.activeCanvas();
    const marked = file ? await this.isMarkedCanvas(file.path) : false;
    // overlay (best-effort)
    this.app.workspace.iterateAllLeaves((l) => WorkflowBadge.detach(l));
    if (marked && leaf) WorkflowBadge.attach(leaf);
    // status-bar fallback (always reliable)
    if (this.statusEl) this.statusEl.setText(marked ? "⬡ Workflow" : "");
  }

  async onload() {
    console.log(`Perspecta Workflow plugin v${VERSION} loaded`);

    await this.loadSettings();
    this.addSettingTab(new PerspectaSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_PERSPECTA, (leaf: WorkspaceLeaf) => new ResultsView(leaf));

    this.statusEl = this.addStatusBarItem();

    this.watcher = new ColorWatcher({
      debounceMs: 400,
      isMarked: (p) => this.isMarkedCanvas(p),
      recolor: (p) => this.recolorCanvas(p),
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      clearScheduled: (id) => window.clearTimeout(id),
    });

    // ---- events ----
    this.registerEvent(this.app.workspace.on("file-open", async (file) => {
      await this.refreshBadge();
      if (this.settings.autoColor && file && file.extension === "canvas") {
        this.watcher.onCanvasTouched(file.path);
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { void this.refreshBadge(); }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!this.settings.autoColor || !(file instanceof TFile)) return;
      if (file.extension === "canvas") {
        this.watcher.onCanvasTouched(file.path);
      } else if (file.extension === "md") {
        // a node-note changed: recolor the active canvas if it's a workflow
        const canvas = this.activeCanvas();
        if (canvas) this.watcher.onCanvasTouched(canvas.path);
      }
    }));

    // ---- commands ----
    this.addCommand({
      id: "use-canvas-as-workflow",
      name: "Use canvas as workflow",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Open a canvas first"); return; }
        try {
          const json = await this.app.vault.adapter.read(file.path);
          const out = stampCanvasJson(json);
          if (out == null) { new Notice("Already a workflow canvas"); return; }
          await this.app.vault.adapter.write(file.path, out);
          await this.refreshBadge();
          if (this.settings.autoColor) this.watcher.onCanvasTouched(file.path);
          new Notice("Perspecta: canvas marked as workflow");
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "validate-workflow-canvas",
      name: "Validate workflow canvas",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Not a workflow canvas"); return; }
        if (!(await this.isMarkedCanvas(file.path))) { new Notice("Not a workflow canvas. Run 'Use canvas as workflow' first."); return; }
        try {
          const result = await runValidation(file.path, this.vaultReader());
          await this.revealResults();
          const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA)[0]?.view as ResultsView;
          view?.setResult(result);
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "apply-node-colors",
      name: "Apply node colors",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Not a workflow canvas"); return; }
        if (!(await this.isMarkedCanvas(file.path))) { new Notice("Not a workflow canvas. Run 'Use canvas as workflow' first."); return; }
        try {
          const out = await this.recolorCanvas(file.path);
          new Notice(out == null ? "Colors already up to date" : "Perspecta: node colors applied");
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "set-node-type",
      name: "Set node type",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Not a workflow canvas"); return; }
        if (!(await this.isMarkedCanvas(file.path))) { new Notice("Not a workflow canvas. Run 'Use canvas as workflow' first."); return; }
        try {
          const canvasJson = JSON.parse(await this.app.vault.adapter.read(file.path));
          const noteFiles: { id: string; file: string }[] = (canvasJson.nodes ?? [])
            .filter((n: any) => n.type === "file" && typeof n.file === "string" && n.file.endsWith(".md"))
            .map((n: any) => ({ id: n.id, file: n.file }));
          if (noteFiles.length === 0) { new Notice("No node-notes on this canvas"); return; }
          const targetFile = await this.chooseNoteFile(noteFiles);
          if (!targetFile) return;
          const nodeType = await this.chooseNodeType();
          if (!nodeType) return;
          const noteText = await this.app.vault.adapter.read(targetFile);
          await this.app.vault.adapter.write(targetFile, setNodeTypeInFrontmatter(noteText, nodeType));
          if (this.settings.autoColor) this.watcher.onCanvasTouched(file.path);
          new Notice(`Perspecta: node_type set to ${nodeType}`);
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "insert-prompt-node",
      name: "Insert prompt node",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Open a workflow canvas first"); return; }
        const id = `n${Date.now()}`;
        const notePath = `${this.settings.nodeFolder}/${id}.md`;
        await this.app.vault.adapter.write(notePath, buildNodeNote("prompt"));
        let canvasJson = await this.app.vault.adapter.read(file.path);
        // inserting a node implies workflow intent: stamp the marker if missing
        const stamped = stampCanvasJson(canvasJson);
        if (stamped != null) canvasJson = stamped;
        await this.app.vault.adapter.write(file.path, addFileNodeToCanvas(canvasJson, notePath, id));
        await this.refreshBadge();
        if (this.settings.autoColor) this.watcher.onCanvasTouched(file.path);
        new Notice("Perspecta: prompt node inserted");
      },
    });

    // initial badge for whatever is open at load
    this.app.workspace.onLayoutReady(() => { void this.refreshBadge(); });
  }

  // ---- choosers ------------------------------------------------------------

  private chooseNodeType(): Promise<NodeType | null> {
    return new Promise((resolve) => {
      const modal = new NodeTypeModal(this.app, NODE_TYPE_OPTIONS, (opt) => resolve(opt ? opt.type : null));
      modal.open();
    });
  }

  private chooseNoteFile(files: { id: string; file: string }[]): Promise<string | null> {
    if (files.length === 1) return Promise.resolve(files[0].file);
    return new Promise((resolve) => {
      const modal = new NoteFileModal(this.app, files, (f) => resolve(f ? f.file : null));
      modal.open();
    });
  }

  private async revealResults() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA);
    if (existing.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_PERSPECTA, active: true });
    }
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA)[0];
    if (leaf) this.app.workspace.revealLeaf(leaf);
  }

  onunload() {
    this.app.workspace.iterateAllLeaves((l) => WorkflowBadge.detach(l));
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA).forEach((l) => l.detach());
  }
}

class NodeTypeModal extends SuggestModal<NodeTypeOption> {
  constructor(app: any, private options: NodeTypeOption[], private onChoose: (o: NodeTypeOption | null) => void) {
    super(app);
    this.setPlaceholder("Pick a node type…");
  }
  getSuggestions(query: string): NodeTypeOption[] {
    const q = query.toLowerCase();
    return this.options.filter((o) => o.type.includes(q) || o.description.toLowerCase().includes(q));
  }
  renderSuggestion(o: NodeTypeOption, el: HTMLElement) {
    el.createDiv({ text: o.type, cls: "perspecta-finding-rule" });
    el.createDiv({ text: o.description });
  }
  onChooseSuggestion(o: NodeTypeOption) { this.onChoose(o); }
  onClose() { /* if nothing chosen, resolve null via a microtask guard */ }
}

class NoteFileModal extends SuggestModal<{ id: string; file: string }> {
  constructor(app: any, private files: { id: string; file: string }[], private onChoose: (f: { id: string; file: string } | null) => void) {
    super(app);
    this.setPlaceholder("Which node?");
  }
  getSuggestions(query: string) {
    const q = query.toLowerCase();
    return this.files.filter((f) => f.file.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  }
  renderSuggestion(f: { id: string; file: string }, el: HTMLElement) {
    el.createDiv({ text: f.file });
  }
  onChooseSuggestion(f: { id: string; file: string }) { this.onChoose(f); }
}
```

NOTE on the chooser-resolve-on-cancel detail: `SuggestModal` calls `onChooseSuggestion` only on selection. To resolve `null` when the user dismisses the modal without choosing, the simplest robust approach is to track whether a choice was made and resolve `null` in `onClose` if not. Implement that: add a `private chosen = false;` to each modal, set it true in `onChooseSuggestion` before calling back, and in `onClose` do `if (!this.chosen) this.onChoose(null as any);`. Wire that in (the skeleton above shows the shape; make the cancel-resolves-null behavior real so the command doesn't hang).

- [ ] **Step 2: Type-check**

Run: `npx tsc -p packages/obsidian-plugin/tsconfig.json --noEmit`
Expected: zero errors. Resolve any genuine Obsidian typing issues (e.g. `addStatusBarItem`, `iterateAllLeaves`, `getMostRecentLeaf`, `onLayoutReady`, `SuggestModal` generics — all real Obsidian API). Do not cast to `any` except the modal `app` ctor param and the documented cancel-resolve.

- [ ] **Step 3: Build core + plugin**

Run: `npm run build -w @perspecta/core && npm run build -w perspecta-workflow-plugin`
Expected: esbuild produces `main.js`. main.js is gitignored.

- [ ] **Step 4: Full test suite**

Run: `npx vitest run`
Expected: all tests pass — core (prior + marker) and plugin (prior + convertToWorkflow 3, setNodeType 4, colorWatcher 4).

- [ ] **Step 5: Commit (settings D2 + main D3 together)**

```bash
git add packages/obsidian-plugin/src/main.ts packages/obsidian-plugin/src/settings.ts
git commit -m "$(cat <<'EOF'
feat(plugin): marker-gated commands, auto-color watcher, badge, Set node type, Use-as-workflow

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

# PART E — Examples, docs, install

## Task E1: Stamp the in-repo example + update plugin README

**Files:**
- (No in-repo example canvas exists in the repo; the examples live in the vault.) Update `packages/obsidian-plugin/README.md` to document the new commands, the marker, the badge, and the manual-test checklist.

- [ ] **Step 1: Update `packages/obsidian-plugin/README.md`**

Add/adjust:
- **Commands** section: add `Use canvas as workflow`, `Set node type`. Note that Validate / Apply colors now require the canvas to be marked first.
- **Workflow identity** subsection: explain the `perspecta` marker key, the corner "Workflow" badge (+ status-bar fallback), and that ordinary canvases are untouched.
- **Auto-color** subsection: nodes color automatically (on open + on edit) for marked canvases; toggle in settings (default on).
- **The 8 node types** reference table (type → role → color).
- **Manual test checklist** (replace the old one):
  1. Open a plain `.canvas` → no badge, no coloring (left alone).
  2. Run **Use canvas as workflow** → "Workflow" badge appears top-left (or status-bar `⬡ Workflow`).
  3. Nodes with `node_type` auto-color; edit a node-note's `node_type` → canvas recolors within ~½s.
  4. Run **Set node type** → pick a node, pick a type → frontmatter updates + recolors.
  5. Run **Validate workflow canvas** → `✓` or findings.
  6. Open the plain canvas again → still no badge/coloring.

- [ ] **Step 2: Commit**

```bash
git add packages/obsidian-plugin/README.md
git commit -m "$(cat <<'EOF'
docs(plugin): document workflow marker, badge, Set node type, auto-color + manual checklist

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

## Task E2: Rebuild + reinstall into the vault; stamp the vault examples

**Files:** none in repo (vault operations).

- [ ] **Step 1: Rebuild the plugin**

```bash
npm run build -w @perspecta/core && npm run build -w perspecta-workflow-plugin
```

- [ ] **Step 2: Copy the three artifacts into the installed plugin folder**

```bash
DEST="/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact/.obsidian/plugins/perspecta-workflow"
SRC="/Users/wrede/Documents/GitHub/perspecta-workflow/packages/obsidian-plugin"
cp "$SRC/main.js" "$SRC/manifest.json" "$SRC/styles.css" "$DEST/"
```

- [ ] **Step 3: Stamp the two existing vault example canvases with the marker**

The vault canvases predate the marker. Stamp them so they're recognized (do this via a tiny node script using core, OR document that the user runs "Use canvas as workflow" on each). Preferred: stamp programmatically to save the user steps. For each of:
- `_agents/workflows/meeting-followup/meeting-followup.canvas`
- `_src/workflows/example-person-brief/person-brief.canvas`

read the file, apply `stampWorkflowMarker`, write it back (pretty-printed). Verify each now passes `isWorkflowCanvas`.

- [ ] **Step 4: Report to the user**

Tell the user to reload Obsidian to pick up the new plugin build, and that both example canvases are now marked workflows (badge should appear, nodes auto-colored).

---

## Self-Review

**Spec coverage:**
- Marker contract (`isWorkflowCanvas`/`stampWorkflowMarker`) → A1. ✓
- "Use canvas as workflow" command → B1 (pure) + D3 (wiring). ✓
- Corner badge + status-bar fallback → D1 (badge) + D3 (refreshBadge + statusEl). ✓
- "Set node type" picker (8 types from NODE_TYPES) + frontmatter-preserving write → B2 + D3. ✓
- Auto-color on open + debounced modify, marker-gated, write-loop-guarded, default ON → C1 (watcher) + D2 (default true) + D3 (events). ✓
- Marker-gating retrofit on Validate / Apply colors / Insert → D3. ✓
- MCP stays path-driven → no MCP changes in plan (intentional). ✓
- Migration: stamp vault examples → E2. ✓
- Docs → E1. ✓

**Placeholder scan:** None. The modal cancel-resolves-null behavior is specified concretely (track `chosen`, resolve null in `onClose`). The badge body is complete real code.

**Type consistency:** `isWorkflowCanvas`/`stampWorkflowMarker` (A1) used in B1/D3. `stampCanvasJson` returns `string | null` (B1) consumed in D3. `setNodeTypeInFrontmatter(noteText, nodeType): string` + `NODE_TYPE_OPTIONS: NodeTypeOption[]` (B2) used in D3. `ColorWatcher` deps `{ debounceMs, isMarked, recolor, schedule, clearScheduled }` + methods `onCanvasTouched`/`onSelfWrite` (C1) constructed in D3. `PerspectaSettings { nodeFolder, autoColor }` (D2) used in D3. `computeRecoloredCanvas`/`VaultReader` reused unchanged from Phase 1.

**Known risk (documented):** the badge overlay reaches `leaf.view.containerEl` (not public-typed) — guarded, with the status-bar fallback. The "which canvas node" selection problem is sidestepped by always presenting a node-note chooser (D3 `chooseNoteFile`), so no dependency on unreadable selection API.
