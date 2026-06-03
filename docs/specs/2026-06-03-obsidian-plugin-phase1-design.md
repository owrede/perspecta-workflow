# Perspecta Workflow — Obsidian Plugin, Phase 1 Design Spec

**Date:** 2026-06-03
**Status:** Approved (design), pending implementation plan
**Repo:** `~/Documents/GitHub/perspecta-workflow`
**Depends on:** the existing v1 engine (canvas-workflow spec `2026-06-02-canvas-agentic-workflows-design.md`, implemented as the MCP server in this repo)

## Purpose

Deliver Perspecta Workflow to end users as an Obsidian plugin. The full product vision is author + validate + auto-execute via LLM, built in **three shippable phases**:

- **Phase 1 (this spec):** author + validate inside Obsidian — live linting, auto-color, insert-node scaffolding, results panel.
- **Phase 2 (future spec):** interactive human-driven walk panel (the stepper, surfaced visually; human picks branches, records outputs).
- **Phase 3 (future spec):** LLM auto-execution (the deferred headless runtime, embedded in the plugin, with API keys + tool execution).

Each phase ships working value and de-risks the next. Phase 1 carries the critical architectural work: making the engine core run inside Obsidian without duplicating logic.

## Architecture

### The big move: fs-agnostic shared core

The existing engine calls `node:fs` directly in three modules (`canvas`, `graph`, `linter`). Obsidian's renderer cannot use `node:fs`. Rather than fork the engine (which would duplicate the linter/graph rules and cause drift as v2 rules are added), we **extract an fs-agnostic core** that both the MCP server and the plugin consume.

### Repository structure (npm workspaces monorepo)

```
perspecta-workflow/
  packages/
    core/             fs-agnostic: types, canvas-parse, graph, linter, context, stepper
                      depends on a WorkflowFileSystem interface, NOT node:fs
    mcp-server/       NodeFileSystem (node:fs) + existing MCP server.ts
    obsidian-plugin/  ObsidianFileSystem (Vault API) + Phase 1 UI
```

- **`core`** holds all current logic. The three fs-touching modules receive an injected `WorkflowFileSystem` instead of importing `node:fs`. The pure modules (`types`, `context`, `stepper`) move unchanged.
- **`mcp-server`** provides `NodeFileSystem` (sync `node:fs`) and keeps the existing `server.ts`. Test placement: the existing engine tests and their real-file fixtures move to `packages/core` and run by injecting `NodeFileSystem` (a minimal, mechanical change — the fixtures stay as real files; only the `buildGraph`/`lint`/`Stepper` call sites gain an `fs` argument). The MCP-adapter tests (server handlers) move to `packages/mcp-server`. All 35 stay green. New core tests added for the `WorkflowFileSystem` injection use a small in-memory fake.
- **`obsidian-plugin`** provides `ObsidianFileSystem` (sync cache over the async Vault API) plus the authoring UI.

**Why monorepo:** three build targets sharing one core is exactly what workspaces are for. Keeps one repo, one `npm install`, one shared TS config. Publishing `core` to npm would be heavier for a solo project.

This is a real but mechanical refactor of the existing repo. The 35 tests guard correctness throughout.

## The FileSystem seam

```typescript
// packages/core/src/fs.ts
export interface WorkflowFileSystem {
  readText(path: string): string;          // throws if missing (preserves current error semantics)
  writeText(path: string, data: string): void;
  exists(path: string): boolean;
}
```

Signature changes (logic untouched):
- `parseCanvas(path, fs)`, `parseNodeNote(path, fs)` — `fs.readText`.
- `buildGraph(canvasPath, { fs, vaultRoot? })` — `fs.exists` for resolution; threads `fs` down (incl. subworkflow recursion).
- `lint(graph)` stays pure. `applyColors(graph, canvasPath, fs)` — `fs.readText`/`fs.writeText`. `findInfiniteLoops(canvasPath, fs)` — threads `fs` through recursion.
- `Stepper` constructor takes `{ fs, vaultRoot? }` and threads `fs` into its `buildGraph` calls.

Two adapters implement the interface:
- **`NodeFileSystem`** (mcp-server): `readFileSync` / `writeFileSync` / `existsSync` — synchronous, as today.
- **`ObsidianFileSystem`** (plugin): synchronous, backed by a preloaded in-memory `Map<path, string>`.

### Sync-cache bridge (decision: option B)

Obsidian's Vault API is **async** (`vault.read()` returns a Promise); the core is **synchronous**. We keep the core synchronous and confine all async to the plugin:

1. The plugin walks the active canvas's node `file` references (and embedded child canvases, recursively).
2. It `await`s all Vault reads, populating a `Map<path, string>`.
3. It constructs an `ObsidianFileSystem` backed by that Map and hands it to the synchronous core.

A workflow's file set is small (a handful of node-notes), so pre-loading is cheap. The core and its 35 tests stay synchronous and unchanged. If async-core ever becomes necessary (e.g. very large embedded trees in a later phase), we revisit — explicitly out of scope for Phase 1.

## The Obsidian plugin (Phase 1)

Standard Obsidian plugin: `main.ts` → `main.js`, `manifest.json`, `styles.css`.

```
packages/obsidian-plugin/src/
  main.ts                  Plugin entry: registers commands, view, settings, events
  fs/ObsidianFileSystem.ts sync WorkflowFileSystem over a preloaded Map
  fs/preload.ts            walks a canvas's file refs, awaits Vault reads, builds the Map
  view/ResultsView.ts      sidebar ItemView listing lint findings (clickable → node)
  commands/validate.ts     run linter on active canvas, populate the panel
  commands/autocolor.ts    apply colors, write back via Vault API
  commands/insertNode.ts   scaffold a WorkflowNode .md + add file-node to canvas
  live/watcher.ts          debounced re-lint on canvas change (deferrable — see scope)
  settings.ts              plugin settings tab
```

### UI surfaces

1. **Validate command + Results panel.** `Perspecta: Validate workflow canvas` → preload active `.canvas` files → `lint(buildGraph(...))` → render findings in a right-sidebar `ItemView`. Each finding shows `rule · message`; clicking focuses the offending node. A clean result shows "valid workflow ✓".
2. **Auto-color.** `Perspecta: Apply node colors` → `applyColors` writes the canvas JSON back via the Vault API. A setting toggles auto-apply on save.
3. **Insert-node commands.** `Perspecta: Insert <type> node` → creates a `WorkflowNode` `.md` (correct frontmatter from the shared schema) in the configured folder, and adds a `file`-node to the active canvas JSON. Removes hand-writing frontmatter.
4. **Live validation (deferrable).** Debounced (~500ms) listener on canvas modification re-runs validate and updates a **status-bar** indicator (`✓ valid` / `⚠ N issues`). May slip to Phase 1.5 if canvas-change events prove fiddly; must not block surfaces 1–3.

### Settings

- Auto-color-on-save (on/off).
- Live-validation (on/off).
- Node-note folder for inserted nodes (path string).

### Write-back safety

Color and insert operations modify canvas JSON via `vault.process()` (atomic read-modify-write), preserving all non-workflow nodes and fields untouched — same discipline as the deterministic canvas generator already used in this vault.

## Testing

- **Core:** the 35 existing tests are preserved and stay green, exercised via `NodeFileSystem` against their existing real-file fixtures (call sites gain an `fs` argument). New core tests covering the `WorkflowFileSystem` injection itself use a trivial in-memory fake.
- **Plugin:** `ObsidianFileSystem` and `preload` unit-tested against a mocked `Vault` (an object with `read`/`process`/`getAbstractFileByPath`) — no real Obsidian needed. Command logic (preload → lint → shape findings) tested with the mocked Vault. The thin Obsidian wiring (registering commands, rendering the view) verified manually.
- **Manual test checklist** (in the plugin README): open `person-brief.canvas` → validate (expect ✓) → break a node (expect the matching finding) → auto-color → insert a node.

## Error handling

- **Active file isn't a `.canvas`** → Notice "Not a workflow canvas"; no crash.
- **Node-note missing / bad frontmatter** → surfaced as a lint finding naming the file (core throws on missing files; the plugin catches and converts to a finding), not an exception.
- **Canvas JSON malformed** → Notice with the parse error; panel empty.
- **Write-back conflict** → `vault.process` is atomic; on failure, Notice asks the user to retry.

## Distribution

- `manifest.json`: id `perspecta-workflow`, name, version, `minAppVersion`, description, author.
- GitHub release bundling `main.js` / `manifest.json` / `styles.css`.
- Installable via BRAT (beta reviewers tool) for early users.
- Official community-plugin directory submission deferred to a later phase.

## Scope

### Phase 1 (this spec)
- Monorepo refactor: extract `packages/core` (fs-agnostic) + `packages/mcp-server` (Node adapter, existing server) without breaking the 35 tests.
- `WorkflowFileSystem` seam + `NodeFileSystem` + `ObsidianFileSystem` (sync-cache).
- Plugin with: validate command + results panel, auto-color, insert-node commands. Live validation included but deferrable to Phase 1.5.
- BRAT-installable release.

### Deferred (future phases / specs)
- **Phase 2:** interactive human-driven walk panel (stepper UI).
- **Phase 3:** LLM auto-execution (headless runtime in-plugin, API keys, tool execution sandbox).
- Async-core (only if large embedded trees demand it).
- Community-directory submission.
- Config-node runtime (`maxloops`) and the vault-wide inbound embed pass — inherited engine v2 items, unchanged by this spec.

## Open Questions / Deferred

- **Live validation event source:** Obsidian's canvas-change events are not a stable public API; Phase 1 may rely on `vault.on("modify")` filtered to the active `.canvas`. If that proves unreliable, live validation slips to Phase 1.5 (command-driven validation still ships).
- **Insert-node canvas mutation:** exact placement (x/y) of the inserted file-node is cosmetic; Phase 1 places nodes at a simple offset and lets the user reposition.
