# Obsidian Plugin Phase 1 — Implementation Plan (v0.1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver Perspecta Workflow as an Obsidian plugin (v0.1) that authors and validates workflow canvases, by first extracting an fs-agnostic core shared between the existing MCP server and the new plugin.

**Architecture:** Convert the single-package repo into an npm-workspaces monorepo: `packages/core` (fs-agnostic logic behind a `WorkflowFileSystem` interface), `packages/mcp-server` (Node adapter + existing MCP server), `packages/obsidian-plugin` (Obsidian Vault adapter + authoring UI). The core stays synchronous; the plugin pre-loads files via Obsidian's async Vault API into a sync cache.

**Tech Stack:** Node 24, TypeScript 6, vitest 4, npm workspaces, esbuild (plugin bundle), `obsidian` 1.13 typings, existing deps (`yaml` → core; `@modelcontextprotocol/sdk` + `zod` → mcp-server).

**Spec:** `docs/specs/2026-06-03-obsidian-plugin-phase1-design.md`

**Branch:** `feature/obsidian-plugin-phase1` (already created). Commit trailer for every commit: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure (end state)

```
perspecta-workflow/
  package.json                      # workspaces root: {"workspaces": ["packages/*"]}
  tsconfig.base.json                # shared compiler options
  packages/
    core/
      package.json                  # name @perspecta/core, dep: yaml
      tsconfig.json                 # extends ../../tsconfig.base.json
      src/
        fs.ts                       # WorkflowFileSystem interface + InMemoryFileSystem (test fake)
        types.ts                    # (moved, unchanged)
        canvas.ts                   # (moved; takes fs param)
        graph.ts                    # (moved; takes fs param)
        linter.ts                   # (moved; takes fs param)
        context.ts                  # (moved, unchanged)
        stepper.ts                  # (moved; takes fs param)
        index.ts                    # barrel: re-exports public API + VERSION
      test/                         # the pure-logic tests + fixtures (moved)
    mcp-server/
      package.json                  # name @perspecta/mcp-server, deps: @perspecta/core, @modelcontextprotocol/sdk, zod
      tsconfig.json
      src/
        NodeFileSystem.ts           # WorkflowFileSystem over node:fs
        server.ts                   # (moved; uses NodeFileSystem)
      test/
        server.test.ts              # (moved)
    obsidian-plugin/
      package.json                  # name perspecta-workflow-plugin, deps: @perspecta/core
      tsconfig.json
      manifest.json                 # Obsidian plugin manifest
      esbuild.config.mjs            # bundles src/main.ts -> main.js
      styles.css
      src/
        main.ts                     # Plugin entry
        fs/ObsidianFileSystem.ts    # sync WorkflowFileSystem over preloaded Map
        fs/preload.ts               # async: walk canvas refs, read via Vault, build Map
        view/ResultsView.ts         # sidebar ItemView for lint findings
        commands/validate.ts
        commands/autocolor.ts
        commands/insertNode.ts
        settings.ts
      test/
        ObsidianFileSystem.test.ts
        preload.test.ts
        validate.test.ts
```

**Responsibilities:** `core/fs.ts` defines the only seam between logic and storage. Each adapter implements it for one runtime. The plugin's `preload.ts` is the sole async boundary; everything it feeds the core is synchronous.

---

# PART A — Monorepo refactor (fs-agnostic core)

> Goal of Part A: same behavior, restructured. All 35 existing tests stay green at every commit. No plugin code yet.

## Task A1: Introduce workspaces root + move core files

**Files:**
- Create: `package.json` (root, rewritten as workspaces), `tsconfig.base.json`, `packages/core/package.json`, `packages/core/tsconfig.json`
- Move: `src/*.ts` → `packages/core/src/` (except `server.ts`), `test/*.ts` + `test/fixtures/` → `packages/core/test/` (except `server.test.ts`)

- [ ] **Step 1: Create the workspaces root package.json**

Replace the root `package.json` with:
```json
{
  "name": "perspecta-workflow",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "workspaces": ["packages/*"],
  "scripts": {
    "build": "npm run build --workspaces --if-present",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^25.9.1",
    "typescript": "^6.0.3",
    "vitest": "^4.1.8",
    "tsx": "^4.22.4"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json` at the repo root**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 3: Create `packages/core/package.json`**

```json
{
  "name": "@perspecta/core",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "exports": { ".": "./dist/index.js" },
  "scripts": { "build": "tsc" },
  "dependencies": { "yaml": "^2.9.0" }
}
```

- [ ] **Step 4: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 5: Move the core source + test files**

Run:
```bash
cd /Users/wrede/Documents/GitHub/perspecta-workflow
mkdir -p packages/core/src packages/core/test
git mv src/types.ts src/canvas.ts src/graph.ts src/linter.ts src/context.ts src/stepper.ts src/index.ts packages/core/src/
git mv test/types.test.ts test/canvas.test.ts test/graph.test.ts test/linter.test.ts test/context.test.ts test/stepper.test.ts packages/core/test/
git mv test/fixtures packages/core/test/fixtures
```
(Leaves `src/server.ts` and `test/server.test.ts` in place for Task A5.)

- [ ] **Step 6: Create a root vitest config that finds tests in packages**

Create `vitest.config.ts` at the repo root:
```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["packages/*/test/**/*.test.ts"], environment: "node" },
});
```
Delete the old `vitest.config.ts` content if it differs (overwrite).

- [ ] **Step 7: Install workspaces and run the moved tests**

Run:
```bash
npm install
npx vitest run packages/core
```
Expected: vitest runs the 6 moved core test files. NOTE: `canvas.test.ts`, `graph.test.ts`, `linter.test.ts`, `stepper.test.ts` will FAIL at this point ONLY IF later tasks changed signatures — but in Task A1 NO signatures changed yet, so all moved tests PASS (they still call `node:fs` internally via the unchanged modules). Confirm: the 6 core files pass (server.test.ts is not under packages yet, so it's excluded by the include glob — that's expected).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor: introduce npm workspaces, move core into packages/core"
```

## Task A2: Define the WorkflowFileSystem interface + in-memory fake

**Files:**
- Create: `packages/core/src/fs.ts`, `packages/core/test/fs.test.ts`

**Design note:** The interface includes a `resolve(canvasDir, file)` method so the FS — not the core — owns path resolution. This is the seam that lets the Node adapter use `node:path` (absolute paths) while the Obsidian adapter keeps vault-relative keys, with NO suffix-match heuristic anywhere.

- [ ] **Step 1: Write the failing test `packages/core/test/fs.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "../src/fs.js";

describe("InMemoryFileSystem", () => {
  it("reads back what was written and reports existence", () => {
    const fs = new InMemoryFileSystem({ "/a.md": "hello" });
    expect(fs.exists("/a.md")).toBe(true);
    expect(fs.readText("/a.md")).toBe("hello");
    expect(fs.exists("/missing")).toBe(false);
    fs.writeText("/b.md", "world");
    expect(fs.readText("/b.md")).toBe("world");
  });

  it("throws on reading a missing file", () => {
    const fs = new InMemoryFileSystem();
    expect(() => fs.readText("/nope")).toThrow();
  });

  it("resolves a file path against a base dir by simple join", () => {
    const fs = new InMemoryFileSystem();
    expect(fs.resolve("/flows", "start.md")).toBe("/flows/start.md");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL (module not found)**

Run: `npx vitest run packages/core/test/fs.test.ts`
Expected: FAIL, cannot find `../src/fs.js`.

- [ ] **Step 3: Write `packages/core/src/fs.ts`**

```typescript
export interface WorkflowFileSystem {
  readText(path: string): string;
  writeText(path: string, data: string): void;
  exists(path: string): boolean;
  /** Resolve a node `file` reference (from a canvas) against the canvas's directory.
   *  The FS owns resolution: Node uses node:path; Obsidian keeps vault-relative keys. */
  resolve(canvasDir: string, file: string): string;
}

/** In-memory implementation for tests. Resolves by simple POSIX-style join. */
export class InMemoryFileSystem implements WorkflowFileSystem {
  private store = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.store.set(k, v);
  }
  readText(path: string): string {
    const v = this.store.get(path);
    if (v === undefined) throw new Error(`ENOENT: ${path}`);
    return v;
  }
  writeText(path: string, data: string): void { this.store.set(path, data); }
  exists(path: string): boolean { return this.store.has(path); }
  resolve(canvasDir: string, file: string): string {
    if (!canvasDir) return file;
    return `${canvasDir.replace(/\/$/, "")}/${file}`;
  }
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `npx vitest run packages/core/test/fs.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/fs.ts packages/core/test/fs.test.ts
git commit -m "feat(core): WorkflowFileSystem interface + in-memory fake"
```

## Task A3: Thread fs into canvas.ts / graph.ts / linter.ts / stepper.ts

**Files:**
- Modify: `packages/core/src/canvas.ts`, `graph.ts`, `linter.ts`, `stepper.ts`
- Modify: the 4 affected test files to inject a fs (use a real-file-backed `NodeFileSystem`-like fs OR the existing real fixtures via a tiny node-fs shim defined in the test)

**Approach:** The modules currently import `node:fs`. Replace those calls with a `fs: WorkflowFileSystem` parameter. The CORE no longer imports `node:fs` at all. The tests, which use real fixture files on disk, get a small node-fs-backed fs defined inline in a test helper.

- [ ] **Step 1: Create a test helper that reads real fixture files**

Create `packages/core/test/helpers.ts`:
```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkflowFileSystem } from "../src/fs.js";

/** A real-disk fs for tests that use fixture files. */
export const diskFs: WorkflowFileSystem = {
  readText: (p) => readFileSync(p, "utf8"),
  writeText: (p, d) => writeFileSync(p, d, "utf8"),
  exists: (p) => existsSync(p),
  resolve: (dir, file) => resolve(dir, file),
};
```

- [ ] **Step 2: Update `packages/core/src/canvas.ts`**

```typescript
import { parse as parseYaml } from "yaml";
import type { Canvas, WorkflowNodeFrontmatter } from "./types.js";
import type { WorkflowFileSystem } from "./fs.js";

export function parseCanvas(path: string, fs: WorkflowFileSystem): Canvas {
  const raw = JSON.parse(fs.readText(path));
  return { nodes: raw.nodes ?? [], edges: raw.edges ?? [] };
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface ParsedNote {
  frontmatter: WorkflowNodeFrontmatter;
  body: string;
}

export function parseNodeNote(path: string, fs: WorkflowFileSystem): ParsedNote {
  const raw = fs.readText(path);
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`No frontmatter in node note: ${path}`);
  const frontmatter = parseYaml(m[1]) as WorkflowNodeFrontmatter;
  return { frontmatter, body: m[2] ?? "" };
}
```

- [ ] **Step 3: Update `packages/core/src/graph.ts`**

Replace the whole file with the fs-injected version. NOTE: `dirname` (computing the canvas's own directory) stays from `node:path` — it's pure string math, runtime-agnostic, and works on vault-relative paths too. Node-FILE resolution goes through `fs.resolve` so each adapter owns it (no suffix-match heuristic). Vault-root detection also uses `fs.resolve` for the `.obsidian` probe.
```typescript
import { dirname } from "node:path";
import { parseCanvas, parseNodeNote } from "./canvas.js";
import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from "./types.js";
import type { WorkflowFileSystem } from "./fs.js";

export interface BuildGraphOptions { fs: WorkflowFileSystem; vaultRoot?: string; }

function findVaultRoot(startDir: string, fs: WorkflowFileSystem): string | undefined {
  let dir = startDir;
  while (true) {
    if (fs.exists(fs.resolve(dir, ".obsidian"))) return dir;
    const parent = dirname(dir);
    if (parent === dir || parent === "") return undefined;
    dir = parent;
  }
}

function resolveNodeFile(canvasDir: string, file: string, vaultRoot: string | undefined, fs: WorkflowFileSystem): string {
  const canvasRelative = fs.resolve(canvasDir, file);
  if (fs.exists(canvasRelative)) return canvasRelative;
  if (vaultRoot !== undefined) {
    const vaultRelative = fs.resolve(vaultRoot, file);
    if (fs.exists(vaultRelative)) return vaultRelative;
  }
  return canvasRelative;
}

export function buildGraph(canvasPath: string, opts: BuildGraphOptions): WorkflowGraph {
  const { fs } = opts;
  const canvas = parseCanvas(canvasPath, fs);
  const baseDir = dirname(canvasPath);
  const vaultRoot = opts.vaultRoot ?? findVaultRoot(baseDir, fs);
  const nodes = new Map<string, WorkflowNode>();

  for (const cn of canvas.nodes) {
    if (cn.type !== "file" || !cn.file) continue;
    const target = resolveNodeFile(baseDir, cn.file, vaultRoot, fs);

    if (cn.file.endsWith(".canvas")) {
      nodes.set(cn.id, { canvasNodeId: cn.id, kind: "subworkflow", filePath: target, childCanvasPath: target });
      continue;
    }

    const note = parseNodeNote(target, fs);
    nodes.set(cn.id, { canvasNodeId: cn.id, kind: note.frontmatter.node_type, filePath: target, frontmatter: note.frontmatter, body: note.body });
  }

  const edges: WorkflowEdge[] = canvas.edges.map((e) => ({ fromId: e.fromNode, toId: e.toNode, label: e.label }));
  return { canvasPath, nodes, edges };
}
```
NOTE for the `diskFs` test helper (Task A3 Step 1): it must now ALSO implement `resolve` using `node:path` — see the updated helper code below.

- [ ] **Step 4: Update `packages/core/src/linter.ts`**

Change the fs-touching parts. (a) Add to imports:
```typescript
import type { WorkflowFileSystem } from "./fs.js";
```
Remove the `import { readFileSync, writeFileSync } from "node:fs";` line and the `import { buildGraph } from "./graph.js";` stays.

(b) `applyColors` signature + body:
```typescript
export function applyColors(graph: WorkflowGraph, canvasPath: string, fs: WorkflowFileSystem): number {
  const raw = JSON.parse(fs.readText(canvasPath));
  let changed = 0;
  for (const cn of raw.nodes ?? []) {
    const wf = graph.nodes.get(cn.id);
    if (!wf || wf.kind === "subworkflow") continue;
    const hex = NODE_COLOR_HEX[wf.kind as NodeType];
    const preset = NODE_COLORS[wf.kind as NodeType];
    const desired = hex ?? preset;
    if (desired && cn.color !== desired) { cn.color = desired; changed++; }
  }
  if (changed > 0) fs.writeText(canvasPath, JSON.stringify(raw, null, 2) + "\n");
  return changed;
}
```

(c) `findInfiniteLoops` takes fs and passes it to buildGraph:
```typescript
function findInfiniteLoops(canvasPath: string, fs: WorkflowFileSystem): string[] {
  const child = buildGraph(canvasPath, { fs });
  const found: string[] = [];
  for (const n of child.nodes.values()) {
    if (n.kind === "loop" && isInfiniteLoop(child, n.canvasNodeId)) found.push(n.canvasNodeId);
    if (n.kind === "subworkflow" && n.childCanvasPath) found.push(...findInfiniteLoops(n.childCanvasPath, fs));
  }
  return found;
}
```

(d) `lint` needs fs ONLY for the embed rule (which calls findInfiniteLoops). Change `lint(graph)` → `lint(graph, fs)`:
```typescript
export function lint(graph: WorkflowGraph, fs: WorkflowFileSystem): LintResult {
```
and inside the embed-rule loop call `findInfiniteLoops(n.childCanvasPath, fs)`. The rest of `lint` is unchanged. (All structural rules remain pure; only the embed rule uses fs.)

- [ ] **Step 5: Update `packages/core/src/stepper.ts`**

Constructor and descent thread fs:
```typescript
import type { WorkflowFileSystem } from "./fs.js";
// ...
export class Stepper {
  private stack: Frame[];
  private ctx = new ContextBag();
  private fs: WorkflowFileSystem;
  private vaultRoot?: string;

  constructor(canvasPath: string, opts: { fs: WorkflowFileSystem; vaultRoot?: string }) {
    this.fs = opts.fs;
    this.vaultRoot = opts.vaultRoot;
    const graph = buildGraph(canvasPath, { fs: this.fs, vaultRoot: this.vaultRoot });
    const start = [...graph.nodes.values()].find((n) => n.kind === "start");
    if (!start) throw new Error(`No start node in ${canvasPath}`);
    this.stack = [{ graph, currentId: start.canvasNodeId }];
  }
```
In the descent branch, replace `buildGraph(target.childCanvasPath, { vaultRoot: this.vaultRoot })` with `buildGraph(target.childCanvasPath, { fs: this.fs, vaultRoot: this.vaultRoot })`.

- [ ] **Step 6: Update the 4 affected test files to inject `diskFs`**

In `packages/core/test/canvas.test.ts`, `graph.test.ts`, `linter.test.ts`, `stepper.test.ts`: import the helper and pass `diskFs`.
- `canvas.test.ts`: `import { diskFs } from "./helpers.js";` then `parseCanvas(path, diskFs)` and `parseNodeNote(path, diskFs)`.
- `graph.test.ts`: `buildGraph(path, { fs: diskFs })`. For the explicit-vaultRoot test: `buildGraph(path, { fs: diskFs, vaultRoot: <abs> })`.
- `linter.test.ts`: replace `lint(buildGraph(join(FIX, f)))` with `lint(buildGraph(join(FIX, f), { fs: diskFs }), diskFs)`; update the `lintFile` helper accordingly. `isInfiniteLoop(buildGraph(..., { fs: diskFs }), "cl")`. `applyColors(buildGraph(canvasPath, { fs: diskFs }), canvasPath, diskFs)`.
- `stepper.test.ts`: `new Stepper(join(FIX, "..."), { fs: diskFs })` in every instantiation.

- [ ] **Step 7: Run the full core suite — expect PASS**

Run: `npx vitest run packages/core`
Expected: all core tests pass (types, fs, canvas, graph, linter, context, stepper). The behavior is identical; only the fs is injected.

- [ ] **Step 8: Verify the core no longer imports node:fs**

Run: `grep -rn "node:fs" packages/core/src/`
Expected: NO matches (node:path is still allowed; only node:fs must be gone). If any match remains, fix it.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(core): inject WorkflowFileSystem, remove node:fs from core logic"
```

## Task A4: Core barrel export

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Replace `packages/core/src/index.ts` with a barrel**

```typescript
export const VERSION = "0.1.0";
export * from "./types.js";
export * from "./fs.js";
export * from "./canvas.js";
export * from "./graph.js";
export * from "./linter.js";
export * from "./context.js";
export * from "./stepper.js";
```

- [ ] **Step 2: Build core to verify the barrel + types resolve**

Run: `npm run build -w @perspecta/core`
Expected: tsc exit 0; `packages/core/dist/index.js` and `index.d.ts` exist.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): public barrel export with VERSION"
```

## Task A5: Move MCP server into packages/mcp-server with NodeFileSystem

**Files:**
- Create: `packages/mcp-server/package.json`, `tsconfig.json`, `src/NodeFileSystem.ts`
- Move: `src/server.ts` → `packages/mcp-server/src/server.ts`, `test/server.test.ts` → `packages/mcp-server/test/server.test.ts`

- [ ] **Step 1: Create `packages/mcp-server/package.json`**

```json
{
  "name": "@perspecta/mcp-server",
  "version": "0.1.0",
  "type": "module",
  "bin": { "perspecta-workflow": "dist/server.js" },
  "scripts": { "build": "tsc" },
  "dependencies": {
    "@perspecta/core": "*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.4.3"
  }
}
```

- [ ] **Step 2: Create `packages/mcp-server/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/mcp-server/src/NodeFileSystem.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkflowFileSystem } from "@perspecta/core";

export class NodeFileSystem implements WorkflowFileSystem {
  readText(path: string): string { return readFileSync(path, "utf8"); }
  writeText(path: string, data: string): void { writeFileSync(path, data, "utf8"); }
  exists(path: string): boolean { return existsSync(path); }
  resolve(canvasDir: string, file: string): string { return resolve(canvasDir, file); }
}
```

- [ ] **Step 4: Move server.ts + test, then rewire imports**

Run:
```bash
mkdir -p packages/mcp-server/src packages/mcp-server/test
git mv src/server.ts packages/mcp-server/src/server.ts
git mv test/server.test.ts packages/mcp-server/test/server.test.ts
rmdir src test 2>/dev/null || true
git rm tsconfig.json
```
NOTE: the old single-package root `tsconfig.json` (rootDir `src`, include `["src"]`) is now stale — `src/` is empty after the move, and a root `tsc` would fail with TS2307 errors. Each package has its own tsconfig; the root no longer needs one. Remove it (the `git rm` above). The root `package.json` `build` script delegates to `--workspaces` only, so nothing depends on a root tsconfig.

Then edit `packages/mcp-server/src/server.ts`:
- Replace the local imports `import { buildGraph } from "./graph.js"; import { lint, applyColors } from "./linter.js"; import { Stepper } from "./stepper.js";` with: `import { buildGraph, lint, applyColors, Stepper, VERSION } from "@perspecta/core";` and `import { NodeFileSystem } from "./NodeFileSystem.js";`
- Replace `import { VERSION } from "./index.js";` (delete it; VERSION now comes from @perspecta/core).
- Instantiate one fs: add near the top of the module: `const fs = new NodeFileSystem();`
- Update handler calls to pass fs: `buildGraph(canvas, { fs })`, `lint(graph, fs)`, `applyColors(graph, canvas, fs)`, `new Stepper(canvas, { fs })`. (In `workflow_lint`: `const graph = buildGraph(canvas, { fs }); const result = lint(graph, fs); ... applyColors(graph, canvas, fs)`. In `workflow_start`: `buildGraph(canvas, { fs })`, `lint(graph, fs)`, `new Stepper(canvas, { fs })`.)

- [ ] **Step 5: Update `packages/mcp-server/test/server.test.ts` import path**

The test imports `from "../src/server.js"` — that path still holds after the move. The fixtures it references live in `packages/core/test/fixtures/`. Update `FIX` to point there:
```typescript
const FIX = join(import.meta.dirname, "..", "..", "core", "test", "fixtures");
```

- [ ] **Step 6: Install + build + test the whole monorepo**

Run:
```bash
npm install
npm run build --workspaces
npx vitest run
```
Expected: core builds, mcp-server builds (resolving `@perspecta/core` via the workspace symlink), and ALL tests pass — the full original 35 plus the new `fs.test.ts` (so 37 total). If `@perspecta/core` import fails to resolve, ensure `npm install` created the workspace symlink in `node_modules/@perspecta/core` and that core was built (mcp-server imports the built `dist`).

- [ ] **Step 7: Smoke-test the MCP server still works**

Run:
```bash
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}' '{"jsonrpc":"2.0","method":"notifications/initialized"}' '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node packages/mcp-server/dist/server.js 2>/dev/null
```
Expected: response lists all six `workflow_*` tools.

- [ ] **Step 8: Update the vault .mcp.json path note (no code change here, just documentation)**

The vault's `.mcp.json` points at `dist/server.js` (old path). Add a note to the repo README that the server entry moved to `packages/mcp-server/dist/server.js`. (The actual vault registration update is a manual follow-up the user does — do not edit the vault from this repo task.)

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor: move MCP server to packages/mcp-server with NodeFileSystem adapter"
```

---

# PART B — Obsidian plugin (packages/obsidian-plugin)

> Goal of Part B: the authoring plugin, consuming @perspecta/core via the ObsidianFileSystem. Plugin logic is unit-tested with a mocked Vault; Obsidian wiring is verified manually.

## Task B1: Plugin scaffold (manifest, build, empty plugin)

**Files:**
- Create: `packages/obsidian-plugin/package.json`, `tsconfig.json`, `manifest.json`, `esbuild.config.mjs`, `styles.css`, `src/main.ts`

- [ ] **Step 1: Create `packages/obsidian-plugin/package.json`**

```json
{
  "name": "perspecta-workflow-plugin",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "node esbuild.config.mjs",
    "dev": "node esbuild.config.mjs --watch"
  },
  "dependencies": { "@perspecta/core": "*" },
  "devDependencies": { "obsidian": "^1.13.0", "esbuild": "^0.25.0" }
}
```

- [ ] **Step 2: Create `packages/obsidian-plugin/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src", "lib": ["ES2022", "DOM"] },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/obsidian-plugin/manifest.json`**

```json
{
  "id": "perspecta-workflow",
  "name": "Perspecta Workflow",
  "version": "0.1.0",
  "minAppVersion": "1.5.0",
  "description": "Author and validate agentic workflow canvases.",
  "author": "Oliver Wrede",
  "isDesktopOnly": false
}
```

- [ ] **Step 4: Create `packages/obsidian-plugin/esbuild.config.mjs`**

```javascript
import esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["obsidian", "electron"],
  outfile: "main.js",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});

if (watch) { await ctx.watch(); } else { await ctx.rebuild(); await ctx.dispose(); }
```
NOTE: `@perspecta/core` is bundled IN (not external), so the plugin ships self-contained. Obsidian plugins are CommonJS — `format: "cjs"`.

- [ ] **Step 5: Create `packages/obsidian-plugin/styles.css`**

```css
.perspecta-results-empty { color: var(--text-muted); padding: 8px; }
.perspecta-finding { padding: 6px 8px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer; }
.perspecta-finding:hover { background: var(--background-modifier-hover); }
.perspecta-finding-rule { font-weight: 600; }
.perspecta-finding-ok { color: var(--text-success); padding: 8px; }
```

- [ ] **Step 6: Create a minimal `packages/obsidian-plugin/src/main.ts`**

```typescript
import { Plugin } from "obsidian";
import { VERSION } from "@perspecta/core";

export default class PerspectaWorkflowPlugin extends Plugin {
  async onload() {
    console.log(`Perspecta Workflow plugin v${VERSION} loaded`);
  }
}
```

- [ ] **Step 7: Install + build the plugin bundle**

Run:
```bash
npm install
npm run build -w perspecta-workflow-plugin
ls packages/obsidian-plugin/main.js
```
Expected: `main.js` produced (bundled, CJS). NOTE: core must be BUILT first (`npm run build -w @perspecta/core`) so the bundler can resolve `@perspecta/core`'s `dist`. If resolution fails, run the core build then retry.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(plugin): scaffold Obsidian plugin (manifest, esbuild bundle, empty entry)"
```

## Task B2: ObsidianFileSystem (sync over a preloaded Map)

**Files:**
- Create: `packages/obsidian-plugin/src/fs/ObsidianFileSystem.ts`, `packages/obsidian-plugin/test/ObsidianFileSystem.test.ts`

- [ ] **Step 1: Write the failing test `test/ObsidianFileSystem.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { ObsidianFileSystem } from "../src/fs/ObsidianFileSystem.js";

describe("ObsidianFileSystem", () => {
  it("reads from the preloaded map and records writes", () => {
    const fs = new ObsidianFileSystem(new Map([["a.md", "hi"]]));
    expect(fs.exists("a.md")).toBe(true);
    expect(fs.readText("a.md")).toBe("hi");
    expect(fs.exists("b.md")).toBe(false);
    fs.writeText("b.md", "yo");
    expect(fs.readText("b.md")).toBe("yo");
    expect(fs.pendingWrites().get("b.md")).toBe("yo");
  });

  it("throws on missing read", () => {
    const fs = new ObsidianFileSystem(new Map());
    expect(() => fs.readText("x")).toThrow();
  });

  it("resolves to vault-relative keys (matching preload), not absolute paths", () => {
    const fs = new ObsidianFileSystem(new Map());
    // canvas at flows/wf.canvas -> dirname "flows"; a sibling note "flows/start.md"
    // is referenced in the canvas as "flows/start.md" (vault-relative), so resolving
    // against the canvas dir must yield exactly that key.
    expect(fs.resolve("flows", "flows/start.md")).toBe("flows/start.md");
    expect(fs.resolve("", "flows/start.md")).toBe("flows/start.md");
  });
});
```
**Why `resolve` returns the `file` as-is here:** Obsidian canvas `file` values are ALREADY vault-relative (e.g. `flows/start.md`), and preload keys the map by those exact strings. So resolution is the identity on `file` — the canvasDir is ignored. This is what makes the suffix-match heuristic unnecessary.

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `npx vitest run packages/obsidian-plugin/test/ObsidianFileSystem.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/fs/ObsidianFileSystem.ts`**

```typescript
import type { WorkflowFileSystem } from "@perspecta/core";

/**
 * Synchronous WorkflowFileSystem backed by a preloaded map of file contents,
 * keyed by VAULT-RELATIVE paths (exactly as the canvas references them and as
 * preload stored them). Writes are buffered in-memory; the caller flushes them
 * to the Vault via pendingWrites().
 */
export class ObsidianFileSystem implements WorkflowFileSystem {
  private writes = new Map<string, string>();
  constructor(private files: Map<string, string>) {}

  readText(path: string): string {
    if (this.writes.has(path)) return this.writes.get(path)!;
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`Not preloaded: ${path}`);
    return v;
  }
  writeText(path: string, data: string): void {
    this.writes.set(path, data);
    this.files.set(path, data);
  }
  exists(path: string): boolean { return this.files.has(path) || this.writes.has(path); }
  /** Obsidian canvas `file` values are already vault-relative; identity on `file`. */
  resolve(_canvasDir: string, file: string): string { return file; }
  pendingWrites(): Map<string, string> { return this.writes; }
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run packages/obsidian-plugin/test/ObsidianFileSystem.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the plugin package to the root vitest include**

The root `vitest.config.ts` already globs `packages/*/test/**` — confirm the plugin tests are picked up:
Run: `npx vitest run packages/obsidian-plugin`
Expected: the ObsidianFileSystem test runs and passes.

- [ ] **Step 6: Commit**

```bash
git add packages/obsidian-plugin/src/fs/ObsidianFileSystem.ts packages/obsidian-plugin/test/ObsidianFileSystem.test.ts
git commit -m "feat(plugin): synchronous ObsidianFileSystem over a preloaded map"
```

## Task B3: Preload (async walk of canvas file refs)

**Files:**
- Create: `packages/obsidian-plugin/src/fs/preload.ts`, `packages/obsidian-plugin/test/preload.test.ts`

**What preload does:** given a canvas path and a minimal Vault-like reader, read the canvas JSON, collect every `file`-node target (resolving canvas-relative and vault-relative, recursing into `.canvas` children), and return a `Map<absPath, content>` plus the detected vaultRoot — everything the core needs, pre-read.

- [ ] **Step 1: Write the failing test `test/preload.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { preloadCanvas } from "../src/fs/preload.js";

// Minimal vault: a map of vault-relative path -> content, plus a vaultRoot.
function fakeVault(files: Record<string, string>) {
  return {
    async read(path: string): Promise<string> {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    },
    exists(path: string): boolean { return path in files; },
  };
}

describe("preloadCanvas", () => {
  it("preloads the canvas and its node-note files (vault-relative)", async () => {
    const files = {
      "flows/wf.canvas": JSON.stringify({
        nodes: [
          { id: "s", type: "file", file: "flows/start.md", x: 0, y: 0, width: 1, height: 1 },
          { id: "e", type: "file", file: "flows/end.md",   x: 1, y: 0, width: 1, height: 1 },
        ],
        edges: [{ id: "x", fromNode: "s", toNode: "e" }],
      }),
      "flows/start.md": "---\nclass: WorkflowNode\nnode_type: start\n---\nGo.",
      "flows/end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
    };
    const { map } = await preloadCanvas("flows/wf.canvas", fakeVault(files));
    expect(map.get("flows/wf.canvas")).toContain("nodes");
    expect(map.get("flows/start.md")).toContain("node_type: start");
    expect(map.get("flows/end.md")).toContain("node_type: end");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run packages/obsidian-plugin/test/preload.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/fs/preload.ts`**

```typescript
export interface VaultReader {
  read(path: string): Promise<string>;
  exists(path: string): boolean;
}

export interface PreloadResult { map: Map<string, string>; }

/**
 * Reads the canvas and every file-node it references (recursively for embedded
 * .canvas children) into a flat map keyed by the SAME path strings the canvas
 * uses. Vault paths are vault-relative, so we key by vault-relative path and the
 * core's fs receives those keys directly (no node:path resolution needed because
 * the plugin passes vaultRoot="" and the ObsidianFileSystem keys are vault-relative).
 */
export async function preloadCanvas(canvasPath: string, vault: VaultReader): Promise<PreloadResult> {
  const map = new Map<string, string>();
  const seen = new Set<string>();

  async function loadCanvas(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const text = await vault.read(path);
    map.set(path, text);
    let raw: any;
    try { raw = JSON.parse(text); } catch { return; }
    for (const cn of raw.nodes ?? []) {
      if (cn.type !== "file" || !cn.file) continue;
      const target: string = cn.file;
      if (target.endsWith(".canvas")) {
        await loadCanvas(target);
      } else if (!map.has(target)) {
        if (vault.exists(target)) map.set(target, await vault.read(target));
      }
    }
  }

  await loadCanvas(canvasPath);
  return { map };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run packages/obsidian-plugin/test/preload.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/fs/preload.ts packages/obsidian-plugin/test/preload.test.ts
git commit -m "feat(plugin): async preload of canvas + node-note files into a sync map"
```

## Task B4: Validate command logic (preload → lint → findings)

**Files:**
- Create: `packages/obsidian-plugin/src/commands/validate.ts`, `packages/obsidian-plugin/test/validate.test.ts`

**Path resolution (clean, no heuristic):** Because `WorkflowFileSystem.resolve` is now owned by the adapter, and `ObsidianFileSystem.resolve` returns the vault-relative `file` as-is, `runValidation` just builds an `ObsidianFileSystem` over the preloaded map and hands it to the core. `buildGraph` calls `fs.resolve(canvasDir, cn.file)` → gets back the vault-relative key → finds it in the map. No suffix-match, no doubled paths. `vaultRoot: ""` is passed so the `.obsidian` auto-walk is skipped (preload already gathered everything).

- [ ] **Step 1: Write the failing test `test/validate.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { runValidation } from "../src/commands/validate.js";

function fakeVault(files: Record<string, string>) {
  return {
    async read(path: string): Promise<string> {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    },
    exists(path: string): boolean { return path in files; },
  };
}

const validCanvas = {
  "wf.canvas": JSON.stringify({
    nodes: [
      { id: "s", type: "file", file: "start.md", x: 0, y: 0, width: 1, height: 1 },
      { id: "e", type: "file", file: "end.md",   x: 1, y: 0, width: 1, height: 1 },
    ],
    edges: [{ id: "x", fromNode: "s", toNode: "e" }],
  }),
  "start.md": "---\nclass: WorkflowNode\nnode_type: start\n---\nGo.",
  "end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
};

describe("runValidation", () => {
  it("returns ok for a valid workflow canvas", async () => {
    const r = await runValidation("wf.canvas", fakeVault(validCanvas));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("returns findings for a canvas with no start node", async () => {
    const noStart = {
      "wf.canvas": JSON.stringify({
        nodes: [{ id: "e", type: "file", file: "end.md", x: 0, y: 0, width: 1, height: 1 }],
        edges: [],
      }),
      "end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
    };
    const r = await runValidation("wf.canvas", fakeVault(noStart));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "one-start")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run packages/obsidian-plugin/test/validate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write `src/commands/validate.ts`**

```typescript
import { buildGraph, lint, type LintResult } from "@perspecta/core";
import { ObsidianFileSystem } from "../fs/ObsidianFileSystem.js";
import { preloadCanvas, type VaultReader } from "../fs/preload.js";

export async function runValidation(canvasPath: string, vault: VaultReader): Promise<LintResult> {
  const { map } = await preloadCanvas(canvasPath, vault);
  const fs = new ObsidianFileSystem(map);
  const graph = buildGraph(canvasPath, { fs, vaultRoot: "" });
  return lint(graph, fs);
}
```
Clean: `ObsidianFileSystem.resolve` returns the vault-relative key, which is exactly how `preload` keyed the map — so `buildGraph` finds every file directly. No heuristic.

- [ ] **Step 4: Run — expect PASS**

Run: `npx vitest run packages/obsidian-plugin/test/validate.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: all tests across all packages pass (core 37 + plugin: ObsidianFileSystem 2, preload 1, validate 2).

- [ ] **Step 6: Commit**

```bash
git add packages/obsidian-plugin/src/commands/validate.ts packages/obsidian-plugin/test/validate.test.ts
git commit -m "feat(plugin): validate command logic (preload -> lint -> findings)"
```

## Task B5: Results sidebar view

**Files:**
- Create: `packages/obsidian-plugin/src/view/ResultsView.ts`
- Modify: `packages/obsidian-plugin/src/main.ts`

**Note:** This task is Obsidian-API wiring (an `ItemView`), verified by building + manual test, not by unit tests (Obsidian's view lifecycle isn't headlessly testable). Keep logic minimal; the testable part (runValidation) is already covered.

- [ ] **Step 1: Write `src/view/ResultsView.ts`**

```typescript
import { ItemView, WorkspaceLeaf } from "obsidian";
import type { LintResult } from "@perspecta/core";

export const VIEW_TYPE_PERSPECTA = "perspecta-results";

export class ResultsView extends ItemView {
  private result: LintResult | null = null;

  constructor(leaf: WorkspaceLeaf) { super(leaf); }
  getViewType() { return VIEW_TYPE_PERSPECTA; }
  getDisplayText() { return "Perspecta Workflow"; }
  getIcon() { return "checkmark"; }

  setResult(result: LintResult, onClickNode?: (nodeId: string) => void) {
    this.result = result;
    this.render(onClickNode);
  }

  async onOpen() { this.render(); }

  private render(onClickNode?: (nodeId: string) => void) {
    const c = this.contentEl;
    c.empty();
    if (!this.result) {
      c.createDiv({ cls: "perspecta-results-empty", text: "Run “Validate workflow canvas”." });
      return;
    }
    if (this.result.ok) {
      c.createDiv({ cls: "perspecta-finding-ok", text: "✓ Valid workflow." });
      return;
    }
    for (const f of this.result.errors) {
      const el = c.createDiv({ cls: "perspecta-finding" });
      el.createSpan({ cls: "perspecta-finding-rule", text: f.rule });
      el.createSpan({ text: ` — ${f.message}` });
      if (f.nodeId && onClickNode) {
        el.onClickEvent(() => onClickNode(f.nodeId!));
      }
    }
  }
}
```

- [ ] **Step 2: Wire the view + validate command into `src/main.ts`**

```typescript
import { Plugin, TFile, Notice, WorkspaceLeaf } from "obsidian";
import { VERSION } from "@perspecta/core";
import { ResultsView, VIEW_TYPE_PERSPECTA } from "./view/ResultsView.js";
import { runValidation } from "./commands/validate.js";

export default class PerspectaWorkflowPlugin extends Plugin {
  async onload() {
    console.log(`Perspecta Workflow plugin v${VERSION} loaded`);

    this.registerView(VIEW_TYPE_PERSPECTA, (leaf: WorkspaceLeaf) => new ResultsView(leaf));

    this.addCommand({
      id: "validate-workflow-canvas",
      name: "Validate workflow canvas",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "canvas") { new Notice("Not a workflow canvas"); return; }
        const vault = {
          read: (p: string) => this.app.vault.adapter.read(p),
          exists: (p: string) => { /* sync best-effort */ return true; },
        };
        try {
          const result = await runValidation(file.path, {
            read: (p: string) => this.app.vault.adapter.read(p),
            exists: (_p: string) => true,
          });
          await this.revealResults();
          const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA)[0]?.view as ResultsView;
          view?.setResult(result);
        } catch (e) {
          new Notice(`Perspecta: ${(e as Error).message}`);
        }
      },
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
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA).forEach((l) => l.detach());
  }
}
```
NOTE: `vault.adapter.read/exists` give async read + sync exists, matching the `VaultReader` shape. The `exists` returns true and lets the actual read throw if missing (preload catches per-file). This is acceptable for v0.1.

- [ ] **Step 3: Build the plugin bundle**

Run: `npm run build -w @perspecta/core && npm run build -w perspecta-workflow-plugin`
Expected: tsc/esbuild succeed; `main.js` regenerated with the view + command. No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/view/ResultsView.ts packages/obsidian-plugin/src/main.ts
git commit -m "feat(plugin): results sidebar view + validate command wiring"
```

## Task B6: Auto-color command

**Files:**
- Create: `packages/obsidian-plugin/src/commands/autocolor.ts`
- Modify: `packages/obsidian-plugin/src/main.ts`

- [ ] **Step 1: Write `src/commands/autocolor.ts` (testable logic)**

```typescript
import { buildGraph, applyColors } from "@perspecta/core";
import { ObsidianFileSystem } from "../fs/ObsidianFileSystem.js";
import { preloadCanvas, type VaultReader } from "../fs/preload.js";

/** Returns the recolored canvas JSON string (or null if nothing changed). */
export async function computeRecoloredCanvas(canvasPath: string, vault: VaultReader): Promise<string | null> {
  const { map } = await preloadCanvas(canvasPath, vault);
  const fs = new ObsidianFileSystem(map);
  const graph = buildGraph(canvasPath, { fs, vaultRoot: "" });
  const changed = applyColors(graph, canvasPath, fs);
  // applyColors wrote the recolored JSON back through fs.writeText, keyed by the
  // canvas path; read it from the buffered writes.
  return changed > 0 ? fs.pendingWrites().get(canvasPath) ?? null : null;
}
```
NOTE: `applyColors` calls `fs.writeText(canvasPath, ...)` (the bare canvas path, since it's the one passed in). `ObsidianFileSystem` buffers that under `pendingWrites()[canvasPath]`. So we read it back by the same key. The canvas path is keyed as-is (not resolved through `fs.resolve`, which only applies to node `file` refs), so this is consistent.

- [ ] **Step 2: Write a test `test/autocolor.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { computeRecoloredCanvas } from "../src/commands/autocolor.js";

function fakeVault(files: Record<string, string>) {
  return { async read(p: string) { if (!(p in files)) throw new Error(`missing ${p}`); return files[p]; }, exists: (p: string) => p in files };
}

describe("computeRecoloredCanvas", () => {
  it("recolors a start node to green (preset 4)", async () => {
    const files = {
      "wf.canvas": JSON.stringify({
        nodes: [
          { id: "s", type: "file", file: "start.md", x: 0, y: 0, width: 1, height: 1 },
          { id: "e", type: "file", file: "end.md",   x: 1, y: 0, width: 1, height: 1 },
        ],
        edges: [{ id: "x", fromNode: "s", toNode: "e" }],
      }),
      "start.md": "---\nclass: WorkflowNode\nnode_type: start\n---\nGo.",
      "end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
    };
    const out = await computeRecoloredCanvas("wf.canvas", fakeVault(files));
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.nodes.find((n: any) => n.id === "s").color).toBe("4");
    expect(parsed.nodes.find((n: any) => n.id === "e").color).toBe("1");
  });
});
```

- [ ] **Step 3: Run — expect FAIL then implement-already-done, so expect PASS after writing the source**

Run: `npx vitest run packages/obsidian-plugin/test/autocolor.test.ts`
Expected: PASS (source written in Step 1).

- [ ] **Step 4: Wire the command into `main.ts`** (add inside `onload`, after the validate command)

```typescript
    this.addCommand({
      id: "apply-node-colors",
      name: "Apply node colors",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "canvas") { new Notice("Not a workflow canvas"); return; }
        try {
          const { computeRecoloredCanvas } = await import("./commands/autocolor.js");
          const out = await computeRecoloredCanvas(file.path, {
            read: (p: string) => this.app.vault.adapter.read(p),
            exists: (_p: string) => true,
          });
          if (out == null) { new Notice("Colors already up to date"); return; }
          await this.app.vault.adapter.write(file.path, out);
          new Notice("Perspecta: node colors applied");
        } catch (e) {
          new Notice(`Perspecta: ${(e as Error).message}`);
        }
      },
    });
```

- [ ] **Step 5: Build + run full suite**

Run: `npm run build -w @perspecta/core && npm run build -w perspecta-workflow-plugin && npx vitest run`
Expected: builds clean; all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(plugin): apply-node-colors command"
```

## Task B7: Insert-node command + settings

**Files:**
- Create: `packages/obsidian-plugin/src/commands/insertNode.ts`, `packages/obsidian-plugin/src/settings.ts`
- Modify: `packages/obsidian-plugin/src/main.ts`

- [ ] **Step 1: Write `src/commands/insertNode.ts` (pure builder, testable)**

```typescript
import type { NodeType } from "@perspecta/core";

/** Build the frontmatter+body for a new WorkflowNode note of the given type. */
export function buildNodeNote(nodeType: NodeType): string {
  const lines = ["---", "class: WorkflowNode", `node_type: ${nodeType}`];
  if (nodeType === "tool") lines.push("tool: ", "params: {}");
  if (nodeType === "contract") lines.push("contract: ");
  if (nodeType === "data") lines.push('source: ""');
  if (nodeType === "loop") lines.push('condition: ""');
  lines.push("outputs: []", "---", "", `Describe this ${nodeType} step.`, "");
  return lines.join("\n");
}

/** Insert a file-node referencing notePath into a canvas JSON string; returns the new JSON. */
export function addFileNodeToCanvas(canvasJson: string, nodePath: string, id: string): string {
  const raw = JSON.parse(canvasJson);
  raw.nodes = raw.nodes ?? [];
  const maxX = raw.nodes.reduce((m: number, n: any) => Math.max(m, (n.x ?? 0) + (n.width ?? 0)), 0);
  raw.nodes.push({ id, type: "file", file: nodePath, x: maxX + 60, y: 0, width: 260, height: 100 });
  return JSON.stringify(raw, null, 2) + "\n";
}
```

- [ ] **Step 2: Write `test/insertNode.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { buildNodeNote, addFileNodeToCanvas } from "../src/commands/insertNode.js";

describe("buildNodeNote", () => {
  it("produces valid WorkflowNode frontmatter for a prompt", () => {
    const note = buildNodeNote("prompt");
    expect(note).toContain("class: WorkflowNode");
    expect(note).toContain("node_type: prompt");
    expect(note).toContain("outputs: []");
  });
  it("includes tool-specific fields for a tool node", () => {
    expect(buildNodeNote("tool")).toContain("tool:");
  });
});

describe("addFileNodeToCanvas", () => {
  it("appends a file-node referencing the note", () => {
    const canvas = JSON.stringify({ nodes: [{ id: "a", type: "file", file: "a.md", x: 0, y: 0, width: 100, height: 60 }], edges: [] });
    const out = addFileNodeToCanvas(canvas, "new.md", "n1");
    const parsed = JSON.parse(out);
    expect(parsed.nodes).toHaveLength(2);
    const added = parsed.nodes.find((n: any) => n.id === "n1");
    expect(added.file).toBe("new.md");
    expect(added.x).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 3: Run — expect PASS (source written in Step 1)**

Run: `npx vitest run packages/obsidian-plugin/test/insertNode.test.ts`
Expected: PASS (4 assertions across the tests).

- [ ] **Step 4: Write `src/settings.ts`**

```typescript
import { App, PluginSettingTab, Setting } from "obsidian";
import type PerspectaWorkflowPlugin from "./main.js";

export interface PerspectaSettings {
  nodeFolder: string;
  autoColorOnSave: boolean;
  liveValidation: boolean;
}

export const DEFAULT_SETTINGS: PerspectaSettings = {
  nodeFolder: "workflows",
  autoColorOnSave: false,
  liveValidation: false,
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
      .setName("Auto-color on save")
      .addToggle((t) => t.setValue(this.plugin.settings.autoColorOnSave).onChange(async (v) => { this.plugin.settings.autoColorOnSave = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName("Live validation")
      .addToggle((t) => t.setValue(this.plugin.settings.liveValidation).onChange(async (v) => { this.plugin.settings.liveValidation = v; await this.plugin.saveSettings(); }));
  }
}
```

- [ ] **Step 5: Wire settings + one insert command into `main.ts`**

Add to the class: a `settings` field and load/save; register the settings tab; add an "Insert prompt node" command (one type for v0.1; others are trivial repeats the user can extend).
```typescript
import { PerspectaSettingTab, DEFAULT_SETTINGS, type PerspectaSettings } from "./settings.js";
import { buildNodeNote, addFileNodeToCanvas } from "./commands/insertNode.js";
// ... in the class:
  settings: PerspectaSettings = DEFAULT_SETTINGS;
  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }
// ... in onload (after other commands):
    await this.loadSettings();
    this.addSettingTab(new PerspectaSettingTab(this.app, this));
    this.addCommand({
      id: "insert-prompt-node",
      name: "Insert prompt node",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "canvas") { new Notice("Open a workflow canvas first"); return; }
        const id = `n${Date.now()}`;
        const notePath = `${this.settings.nodeFolder}/${id}.md`;
        await this.app.vault.adapter.write(notePath, buildNodeNote("prompt"));
        const canvasJson = await this.app.vault.adapter.read(file.path);
        await this.app.vault.adapter.write(file.path, addFileNodeToCanvas(canvasJson, notePath, id));
        new Notice("Perspecta: prompt node inserted");
      },
    });
```

- [ ] **Step 6: Build + full suite**

Run: `npm run build -w @perspecta/core && npm run build -w perspecta-workflow-plugin && npx vitest run`
Expected: builds clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(plugin): insert-prompt-node command + settings tab"
```

## Task B8: README, manual-test checklist, release notes

**Files:**
- Modify: `README.md` (repo root)
- Create: `packages/obsidian-plugin/README.md`

- [ ] **Step 1: Update the repo root `README.md`**

Add a section describing the monorepo layout (core / mcp-server / obsidian-plugin), note that the MCP server entry moved to `packages/mcp-server/dist/server.js`, and link the plugin README.

- [ ] **Step 2: Write `packages/obsidian-plugin/README.md`** with:
- One-paragraph description (author + validate workflow canvases).
- Commands: Validate workflow canvas, Apply node colors, Insert prompt node.
- Install via BRAT: add the repo, enable the plugin.
- Manual test checklist:
  1. Open `_src/workflows/example-person-brief/person-brief.canvas`.
  2. Run "Validate workflow canvas" → expect ✓ in the sidebar.
  3. Edit a node's frontmatter to delete `node_type` → re-validate → expect a `valid-node-type` (or parse) finding.
  4. Run "Apply node colors" → nodes recolor.
  5. Run "Insert prompt node" → a new prompt node note + canvas node appears.
- Note: live validation (on-edit) is deferred to Phase 1.5.

- [ ] **Step 3: Commit**

```bash
git add README.md packages/obsidian-plugin/README.md
git commit -m "docs: monorepo README + plugin README with manual-test checklist"
```

---

## Self-Review

**Spec coverage:**
- fs-agnostic core + monorepo (packages/core/mcp-server/obsidian-plugin) → Tasks A1–A5, B1. ✓
- WorkflowFileSystem seam → A2; NodeFileSystem → A5; ObsidianFileSystem (sync cache) → B2. ✓
- Sync-cache bridge (preload async → sync map) → B3. ✓
- 35 tests stay green through the refactor → A1 (move), A3 (inject fs), A5 (full suite). The plan keeps them green at each commit. ✓
- Validate command + results panel → B4 (logic) + B5 (view). ✓
- Auto-color → B6. ✓
- Insert-node → B7. ✓
- Settings → B7. ✓
- Live validation (deferrable) → INTENTIONALLY deferred to Phase 1.5; settings toggle exists (B7) but no watcher implemented. Matches spec's "deferrable" framing. ✓
- Error handling (not a canvas, missing note, malformed JSON) → B5/B6 command callbacks (Notice) + preload try/catch. ✓
- Distribution (manifest, BRAT) → B1 (manifest) + B8 (README install). ✓

**Deferred per spec (correctly absent):** Phase 2 walk panel, Phase 3 LLM execution, async-core, community submission, config-runtime. None appear as tasks.

**Placeholder scan:** None. The "other insert-node types are trivial repeats" note in B7 ships ONE working command (prompt); not a placeholder (the one command is complete). Path resolution is handled by a real `WorkflowFileSystem.resolve` seam (A2), not a heuristic.

**Type consistency:** `WorkflowFileSystem` (readText/writeText/exists) consistent across A2/A5/B2. `buildGraph(path, {fs, vaultRoot?})`, `lint(graph, fs)`, `applyColors(graph, path, fs)`, `new Stepper(path, {fs, vaultRoot?})` — consistent A3 onward and in mcp-server (A5) and plugin (B4/B6). `LintResult`/`LintError` used in B4/B5 match core. `VaultReader` (read async, exists sync) consistent B3/B4/B6/main.ts. `preloadCanvas` returns `{map}` — used consistently.

**Path-resolution seam (clean foundation):** `WorkflowFileSystem.resolve(canvasDir, file)` makes each adapter own resolution — `NodeFileSystem` uses `node:path` (absolute paths, today's behavior, all 35 tests unchanged); `ObsidianFileSystem` returns the vault-relative `file` directly (matching preload's keys). No suffix-match heuristic, no path-collision risk. This replaced an earlier fragile bridge and is the correct seam for both runtimes.

**Type consistency (resolver addition):** `resolve(canvasDir, file)` is on the interface (A2) and implemented by `InMemoryFileSystem` (A2), `diskFs` test helper (A3), `NodeFileSystem` (A5), and `ObsidianFileSystem` (B2). `buildGraph` calls `fs.resolve` (A3); no caller uses `node:path` resolve for node files anymore.
