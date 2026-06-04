# Skill-Based Workflow Discovery & Delivery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Perspecta workflows discoverable and automatically invokable by agents, with the plugin delivering a version-stamped generic skill plus per-workflow skills generated from canvases into the vault's `.claude/skills/`.

**Architecture:** A pure `@perspecta/core` layer renders skill/registry text from parsed canvas summaries (no fs). The Obsidian plugin owns the fs/lifecycle seam: on activate it reconciles a bundled, version-stamped generic skill (install / upgrade / never-downgrade) and regenerates all per-workflow skills + the `INDEX.md` registry + a `CLAUDE.md` pointer block from a vault-wide scan of marked canvases.

**Tech Stack:** TypeScript, npm-workspaces monorepo, vitest, Obsidian Plugin API, `yaml` (already a core dep). No new dependencies.

**Spec:** `docs/specs/2026-06-04-skill-based-discovery-design.md`

---

## Background the engineer needs

- **Monorepo:** `packages/core` (pure, fs-agnostic, bundles for browser — **no `node:` imports allowed**), `packages/mcp-server` (Node adapter), `packages/obsidian-plugin` (Obsidian adapter). This plan touches `core` and `obsidian-plugin` only.
- **Build/test:** `npm test` (vitest, all packages) from repo root; `npm run build --workspaces` builds core then dependents. Run tests for one package with `npx vitest run <path>` from inside that package dir.
- **The core FS seam** is `WorkflowFileSystem` (`packages/core/src/fs.ts`): `readText(path)`, `writeText(path, data)`, `exists(path)`, `resolve(canvasDir, file)`. `InMemoryFileSystem` is the test double. **Core code never imports `node:fs`** — it takes a `WorkflowFileSystem`.
- **Canvas marker (current, flat shape):** `isWorkflowCanvas(obj)` returns true when `obj.perspecta.workflow === true` (`packages/core/src/marker.ts`). Do **not** assume the nested-marker restructure from the 1.6 spec — it was never built. Work with the current flat marker.
- **Canvas parsing:** `parseCanvas(path, fs) → { nodes, edges }` and `parseNodeNote(path, fs) → { frontmatter, body }` (`packages/core/src/canvas.ts`). `parseNodeNote` throws if a note has no frontmatter.
- **Graph:** `buildGraph(canvasPath, { fs, vaultRoot? }) → WorkflowGraph` (`packages/core/src/graph.ts`). Each node has `kind` (a `NodeType` or `"subworkflow"`), `filePath`, `frontmatter`, `body`. The **start node** is the node whose `kind === "start"`.
- **`dirname(path)`** is the pure POSIX dirname in `packages/core/src/path.ts`.
- **`VERSION`** const is exported from `@perspecta/core` (`packages/core/src/index.ts`), currently `"0.1.0"`, kept in lockstep with `manifest.json`. This is the version we stamp the generic skill with.
- **Plugin VaultReader pattern** (`packages/obsidian-plugin/src/fs/preload.ts`): `{ read(path): Promise<string>; exists(path): boolean }`. Plugin tests fake the vault with a plain object (see `test/autocolor.test.ts`).
- **Plugin lifecycle:** commands and events are registered in `onload()` in `packages/obsidian-plugin/src/main.ts`. Per-workflow vault writes go through `this.app.vault.adapter.write(path, data)`; reads through `this.app.vault.adapter.read(path)`; directory creation through `this.app.vault.adapter.mkdir(path)`.

## File Structure (created / modified)

**core:**
- Create `packages/core/src/semver.ts` — pure `compareSemver(a, b)`.
- Create `packages/core/test/semver.test.ts`.
- Create `packages/core/src/registry.ts` — `summarizeWorkflow`, `WorkflowSummary` type.
- Create `packages/core/test/registry.test.ts`.
- Create `packages/core/src/skillgen.ts` — `renderWorkflowSkill`, `renderRegistry`, `GENERIC_SKILL_TEMPLATE`, `renderGenericSkill`, frontmatter helpers (`readSkillFrontmatter`).
- Create `packages/core/test/skillgen.test.ts`.
- Modify `packages/core/src/index.ts` — export the three new modules.

**obsidian-plugin:**
- Create `packages/obsidian-plugin/src/skills/reconcileGenericSkill.ts` — pure decision fn + impure apply fn.
- Create `packages/obsidian-plugin/test/reconcileGenericSkill.test.ts`.
- Create `packages/obsidian-plugin/src/skills/syncWorkflowSkills.ts` — pure plan fn + impure apply fn.
- Create `packages/obsidian-plugin/test/syncWorkflowSkills.test.ts`.
- Create `packages/obsidian-plugin/src/skills/claudePointer.ts` — pure `upsertPointerBlock`.
- Create `packages/obsidian-plugin/test/claudePointer.test.ts`.
- Modify `packages/obsidian-plugin/src/main.ts` — call reconcile + sync on `onload()`, add "Rebuild workflow skills" command, add the vault scan + apply helpers.

---

## Task 1: Pure semver comparison (core)

**Files:**
- Create: `packages/core/src/semver.ts`
- Test: `packages/core/test/semver.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/semver.test.ts
import { describe, it, expect } from "vitest";
import { compareSemver } from "../src/semver.js";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });
  it("returns negative when a < b", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareSemver("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });
  it("returns positive when a > b", () => {
    expect(compareSemver("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "1.2.0")).toBeGreaterThan(0);
  });
  it("tolerates missing patch/minor as 0", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
  });
  it("treats unparseable input as 0.0.0", () => {
    expect(compareSemver("garbage", "0.0.1")).toBeLessThan(0);
    expect(compareSemver("garbage", "garbage")).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/semver.test.ts`
Expected: FAIL — cannot find module `../src/semver.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/semver.ts
/** Parse "a.b.c" into [a,b,c]; missing or non-numeric parts become 0. */
function parts(v: string): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const segs = String(v).trim().split(".");
  for (let i = 0; i < 3; i++) {
    const n = Number.parseInt(segs[i] ?? "0", 10);
    out[i] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

/** Pure semver compare. Negative if a<b, 0 if equal, positive if a>b.
 *  Compares major.minor.patch only; pre-release tags are ignored. */
export function compareSemver(a: string, b: string): number {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i];
  }
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/semver.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/semver.ts packages/core/test/semver.test.ts
git commit -m "feat(core): pure semver compare for skill version reconciliation"
```

---

## Task 2: Workflow summary extraction (core registry)

Extracts the per-workflow facts (name, purpose, trigger, canvas path, node count) from a canvas + its start note. Single source of truth for both the per-workflow skill description and the registry row.

**Files:**
- Create: `packages/core/src/registry.ts`
- Test: `packages/core/test/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/registry.test.ts
import { describe, it, expect } from "vitest";
import { summarizeWorkflow } from "../src/registry.js";
import { InMemoryFileSystem } from "../src/fs.js";

function fs(files: Record<string, string>) { return new InMemoryFileSystem(files); }

const canvasWith = (nodes: unknown[]) =>
  JSON.stringify({ perspecta: { workflow: true, version: 1 }, nodes, edges: [] });

describe("summarizeWorkflow", () => {
  it("uses the start-note trigger as the trigger and first body line as purpose", () => {
    const files = {
      "flows/person-brief.canvas": canvasWith([
        { id: "s", type: "file", file: "flows/start.md", x: 0, y: 0, width: 1, height: 1 },
        { id: "e", type: "file", file: "flows/end.md", x: 1, y: 0, width: 1, height: 1 },
      ]),
      "flows/start.md": "---\nclass: WorkflowNode\nnode_type: start\ntrigger: Use when the user wants a briefing on a person.\n---\nProduce a concise person brief.\n",
      "flows/end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
    };
    const s = summarizeWorkflow("flows/person-brief.canvas", fs(files));
    expect(s.name).toBe("person-brief");
    expect(s.trigger).toBe("Use when the user wants a briefing on a person.");
    expect(s.purpose).toBe("Produce a concise person brief.");
    expect(s.canvasPath).toBe("flows/person-brief.canvas");
    expect(s.nodeCount).toBe(2);
  });

  it("falls back to purpose when no trigger, and to name when no start body", () => {
    const files = {
      "x/quick.canvas": canvasWith([
        { id: "s", type: "file", file: "x/s.md", x: 0, y: 0, width: 1, height: 1 },
      ]),
      "x/s.md": "---\nclass: WorkflowNode\nnode_type: start\n---\n",
    };
    const s = summarizeWorkflow("x/quick.canvas", fs(files));
    expect(s.trigger).toBe("quick");   // no trigger, empty body → name
    expect(s.purpose).toBe("quick");
  });

  it("falls back to name when there is no start node at all", () => {
    const files = {
      "x/noStart.canvas": canvasWith([
        { id: "p", type: "file", file: "x/p.md", x: 0, y: 0, width: 1, height: 1 },
      ]),
      "x/p.md": "---\nclass: WorkflowNode\nnode_type: prompt\n---\nDo a thing.",
    };
    const s = summarizeWorkflow("x/noStart.canvas", fs(files));
    expect(s.name).toBe("noStart");
    expect(s.trigger).toBe("noStart");
    expect(s.purpose).toBe("noStart");
    expect(s.nodeCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/registry.test.ts`
Expected: FAIL — cannot find module `../src/registry.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/registry.ts
import { buildGraph } from "./graph.js";
import type { WorkflowFileSystem } from "./fs.js";

export interface WorkflowSummary {
  name: string;        // canvas filename without extension
  canvasPath: string;  // vault-relative path to the .canvas
  trigger: string;     // start-note `trigger:`, else purpose, else name
  purpose: string;     // first non-empty start-note body line, else name
  nodeCount: number;   // number of file-nodes resolved in the graph
}

/** Canvas filename without directory or `.canvas` extension. */
function workflowName(canvasPath: string): string {
  const base = canvasPath.slice(canvasPath.lastIndexOf("/") + 1);
  return base.endsWith(".canvas") ? base.slice(0, -".canvas".length) : base;
}

function firstNonEmptyLine(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

/** Build a WorkflowSummary from a marked canvas. Never throws on missing
 *  trigger/purpose/start — falls back to the workflow name. */
export function summarizeWorkflow(canvasPath: string, fs: WorkflowFileSystem): WorkflowSummary {
  const name = workflowName(canvasPath);
  const graph = buildGraph(canvasPath, { fs });
  let start: { frontmatter?: { trigger?: unknown }; body?: string } | undefined;
  for (const node of graph.nodes.values()) {
    if (node.kind === "start") { start = node; break; }
  }
  const triggerRaw = start?.frontmatter?.trigger;
  const purposeLine = start?.body ? firstNonEmptyLine(start.body) : undefined;
  const purpose = purposeLine ?? name;
  const trigger = typeof triggerRaw === "string" && triggerRaw.trim().length > 0
    ? triggerRaw.trim()
    : purpose;
  return { name, canvasPath, trigger, purpose, nodeCount: graph.nodes.size };
}
```

Note: `trigger` is typed `trigger?: unknown` in the read because `WorkflowNodeFrontmatter` does not declare a `trigger` field; reading it defensively avoids a type change to the shared frontmatter interface.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/registry.ts packages/core/test/registry.test.ts
git commit -m "feat(core): summarizeWorkflow extracts name/trigger/purpose/nodeCount"
```

---

## Task 3: Skill + registry text rendering (core skillgen)

Pure renderers that turn summaries into the actual file text, plus the bundled generic-skill template and a frontmatter reader used by reconciliation.

**Files:**
- Create: `packages/core/src/skillgen.ts`
- Test: `packages/core/test/skillgen.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/test/skillgen.test.ts
import { describe, it, expect } from "vitest";
import {
  renderWorkflowSkill, renderRegistry, renderGenericSkill, readSkillFrontmatter,
} from "../src/skillgen.js";
import type { WorkflowSummary } from "../src/registry.js";

const summary: WorkflowSummary = {
  name: "person-brief",
  canvasPath: "flows/person-brief.canvas",
  trigger: "Use when the user wants a briefing on a person.",
  purpose: "Produce a concise person brief.",
  nodeCount: 6,
};

describe("renderWorkflowSkill", () => {
  it("emits frontmatter with name, description=trigger, generated marker, and source path", () => {
    const md = renderWorkflowSkill(summary);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: person-brief");
    expect(md).toContain("description: Use when the user wants a briefing on a person.");
    expect(md).toContain("perspecta_generated: true");
    expect(md).toContain("perspecta_source: flows/person-brief.canvas");
    expect(md).toContain("flows/person-brief.canvas"); // canvas path appears in body too
    expect(md).toContain("perspecta-workflow"); // points back to the generic skill
  });
  it("round-trips through readSkillFrontmatter", () => {
    const fm = readSkillFrontmatter(renderWorkflowSkill(summary));
    expect(fm.perspecta_generated).toBe("true");
    expect(fm.perspecta_source).toBe("flows/person-brief.canvas");
  });
});

describe("renderRegistry", () => {
  it("renders a table row per workflow with name, purpose, trigger, nodeCount", () => {
    const md = renderRegistry([summary]);
    expect(md).toContain("person-brief");
    expect(md).toContain("Produce a concise person brief.");
    expect(md).toContain("Use when the user wants a briefing on a person.");
    expect(md).toContain("6");
    expect(md).toContain("generated_by: perspecta-workflow");
  });
  it("renders an empty-state line when there are no workflows", () => {
    expect(renderRegistry([])).toContain("No workflows");
  });
});

describe("renderGenericSkill", () => {
  it("stamps the given version into perspecta_version frontmatter", () => {
    const md = renderGenericSkill("0.1.0");
    expect(md).toContain("perspecta_version: 0.1.0");
    expect(md).toContain("name: perspecta-workflow");
    expect(readSkillFrontmatter(md).perspecta_version).toBe("0.1.0");
  });
});

describe("readSkillFrontmatter", () => {
  it("returns empty object when there is no frontmatter", () => {
    expect(readSkillFrontmatter("no frontmatter here")).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run test/skillgen.test.ts`
Expected: FAIL — cannot find module `../src/skillgen.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/core/src/skillgen.ts
import type { WorkflowSummary } from "./registry.js";

/** Minimal frontmatter reader: returns top-level `key: value` string pairs.
 *  Good enough for the flat frontmatter the generators emit (no nesting). */
export function readSkillFrontmatter(text: string): Record<string, string> {
  const m = text.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Per-workflow SKILL.md — thin: identity + trigger + canvas path + pointer. */
export function renderWorkflowSkill(s: WorkflowSummary): string {
  return `---
name: ${s.name}
description: ${s.trigger}
perspecta_generated: true
perspecta_source: ${s.canvasPath}
---
Use the \`perspecta-workflow\` skill for how to walk a workflow. This one:

1. Walk the canvas at \`${s.canvasPath}\` via MCP \`workflow_start(...)\`.
2. If the perspecta-workflow MCP tools aren't connected this session,
   read the canvas + node-notes and walk them manually.
`;
}

/** The generated registry note listing every workflow. */
export function renderRegistry(summaries: WorkflowSummary[]): string {
  const header = `---
generated_by: perspecta-workflow
---
# Workflows

`;
  if (summaries.length === 0) {
    return header + "_No workflows defined in this vault yet._\n";
  }
  const rows = summaries
    .map((s) => `| ${s.name} | ${s.purpose} | ${s.trigger} | ${s.nodeCount} | \`${s.canvasPath}\` |`)
    .join("\n");
  return (
    header +
    "| Name | Purpose | When to use | Nodes | Canvas |\n" +
    "| --- | --- | --- | --- | --- |\n" +
    rows +
    "\n"
  );
}

/** The plugin-owned generic skill, version-stamped. */
export function renderGenericSkill(version: string): string {
  return `---
name: perspecta-workflow
description: Use when the user asks for a multi-step vault task that matches a defined Perspecta workflow, or asks to run/list workflows. Discovers and walks workflow canvases.
perspecta_version: ${version}
---
<!-- Generated by Perspecta Workflow v${version} — do not hand-edit; overwritten on plugin update. -->

# Perspecta workflows

This vault defines **Perspecta workflows**: Obsidian Canvas files walked as
directed flowcharts from a start node to an end node. Each workflow also has its
own generated skill (its \`description\` says when to use it) and is listed in
\`_agents/workflows/INDEX.md\`.

## Running a workflow

1. Resolve the workflow to its canvas path (from the per-workflow skill's
   \`perspecta_source\`, or from \`_agents/workflows/INDEX.md\`).
2. Prefer the MCP tools when the \`perspecta-workflow\` server is connected:
   - \`workflow_start(canvasPath)\` → a session id.
   - \`workflow_current(session)\` → the current node's instruction + outgoing edges.
   - \`workflow_advance(session, edge?, outputs?)\` → record outputs, follow an
     edge (a label is required at a branch/loop).
   - \`workflow_status(session)\` / \`workflow_context(session)\` to inspect progress.
3. If the MCP tools are not available, read the canvas JSON and each node-note
   directly and walk them: start at the \`start\` node, follow labeled edges, and
   stop at the \`end\` node.

## Listing workflows

Read \`_agents/workflows/INDEX.md\` and present the Name / Purpose / When-to-use
columns.
`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run test/skillgen.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/skillgen.ts packages/core/test/skillgen.test.ts
git commit -m "feat(core): skillgen renders per-workflow skills, registry, generic skill"
```

---

## Task 4: Export new core modules

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add exports**

Add these three lines to `packages/core/src/index.ts` after the existing `export * from "./marker.js";` line:

```typescript
export * from "./semver.js";
export * from "./registry.js";
export * from "./skillgen.js";
```

- [ ] **Step 2: Verify the whole core package builds and tests pass**

Run: `cd packages/core && npx vitest run && npx tsc --noEmit`
Expected: all tests PASS; tsc reports no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export semver, registry, skillgen from package index"
```

---

## Task 5: Generic-skill reconcile decision (plugin, pure)

The version-compare decision, isolated as a pure function so it is fully unit-testable without a vault.

**Files:**
- Create: `packages/obsidian-plugin/src/skills/reconcileGenericSkill.ts`
- Test: `packages/obsidian-plugin/test/reconcileGenericSkill.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/obsidian-plugin/test/reconcileGenericSkill.test.ts
import { describe, it, expect } from "vitest";
import { decideGenericSkill } from "../src/skills/reconcileGenericSkill.js";
import { renderGenericSkill } from "@perspecta/core";

describe("decideGenericSkill", () => {
  it("installs when no file exists", () => {
    expect(decideGenericSkill(null, "0.1.0")).toBe("write");
  });
  it("upgrades when installed version is older", () => {
    const installed = renderGenericSkill("0.1.0");
    expect(decideGenericSkill(installed, "0.2.0")).toBe("write");
  });
  it("leaves alone when installed version equals bundled", () => {
    const installed = renderGenericSkill("0.2.0");
    expect(decideGenericSkill(installed, "0.2.0")).toBe("skip");
  });
  it("never downgrades when installed version is newer", () => {
    const installed = renderGenericSkill("0.3.0");
    expect(decideGenericSkill(installed, "0.2.0")).toBe("skip");
  });
  it("overwrites when installed stamp is unparseable/missing (self-heal)", () => {
    expect(decideGenericSkill("---\nname: perspecta-workflow\n---\nbody", "0.1.0")).toBe("write");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/reconcileGenericSkill.test.ts`
Expected: FAIL — cannot find module `../src/skills/reconcileGenericSkill.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/obsidian-plugin/src/skills/reconcileGenericSkill.ts
import { compareSemver, readSkillFrontmatter } from "@perspecta/core";

export type GenericSkillDecision = "write" | "skip";

/**
 * Decide whether to (over)write the generic skill.
 * - installed === null  → "write" (install)
 * - no/garbage version stamp → "write" (self-heal a corrupted stamp)
 * - installed < bundled → "write" (upgrade)
 * - installed >= bundled → "skip" (equal = no-op; newer = never downgrade)
 */
export function decideGenericSkill(installed: string | null, bundledVersion: string): GenericSkillDecision {
  if (installed === null) return "write";
  const stamp = readSkillFrontmatter(installed).perspecta_version;
  if (!stamp) return "write";
  return compareSemver(stamp, bundledVersion) < 0 ? "write" : "skip";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/reconcileGenericSkill.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/skills/reconcileGenericSkill.ts packages/obsidian-plugin/test/reconcileGenericSkill.test.ts
git commit -m "feat(plugin): pure generic-skill reconcile decision (install/upgrade/never-downgrade)"
```

---

## Task 6: CLAUDE.md pointer upsert (plugin, pure)

Idempotently insert/replace a marked pointer block in `CLAUDE.md`.

**Files:**
- Create: `packages/obsidian-plugin/src/skills/claudePointer.ts`
- Test: `packages/obsidian-plugin/test/claudePointer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/obsidian-plugin/test/claudePointer.test.ts
import { describe, it, expect } from "vitest";
import { upsertPointerBlock, POINTER_BEGIN, POINTER_END } from "../src/skills/claudePointer.js";

describe("upsertPointerBlock", () => {
  it("appends a marked block when none exists", () => {
    const out = upsertPointerBlock("# My Vault\n\nSome notes.\n");
    expect(out).toContain(POINTER_BEGIN);
    expect(out).toContain(POINTER_END);
    expect(out).toContain("_agents/workflows/INDEX.md");
    expect(out.startsWith("# My Vault")).toBe(true); // existing content preserved
  });
  it("replaces an existing block in place without duplicating", () => {
    const first = upsertPointerBlock("# V\n");
    const second = upsertPointerBlock(first);
    expect(second).toBe(first); // idempotent
    expect((second.match(new RegExp(POINTER_BEGIN, "g")) ?? []).length).toBe(1);
  });
  it("creates content from empty input", () => {
    const out = upsertPointerBlock("");
    expect(out).toContain(POINTER_BEGIN);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/claudePointer.test.ts`
Expected: FAIL — cannot find module `../src/skills/claudePointer.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/obsidian-plugin/src/skills/claudePointer.ts
export const POINTER_BEGIN = "<!-- perspecta-workflow:begin -->";
export const POINTER_END = "<!-- perspecta-workflow:end -->";

const BLOCK = `${POINTER_BEGIN}
**Workflows:** This vault defines Perspecta workflows as skills and in
\`_agents/workflows/INDEX.md\`. Before a multi-step task that matches a
workflow's "when to use", offer to run it.
${POINTER_END}`;

/** Insert or replace the marked pointer block. Idempotent. */
export function upsertPointerBlock(existing: string): string {
  const begin = existing.indexOf(POINTER_BEGIN);
  if (begin !== -1) {
    const end = existing.indexOf(POINTER_END, begin);
    if (end !== -1) {
      const before = existing.slice(0, begin);
      const after = existing.slice(end + POINTER_END.length);
      return before + BLOCK + after;
    }
  }
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const lead = existing.length === 0 ? "" : "\n";
  return existing + sep + lead + BLOCK + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/claudePointer.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/skills/claudePointer.ts packages/obsidian-plugin/test/claudePointer.test.ts
git commit -m "feat(plugin): idempotent CLAUDE.md workflow pointer block"
```

---

## Task 7: Per-workflow sync plan (plugin, pure)

Compute, from the set of marked-canvas summaries and the set of existing skill files, exactly which skill files to write and which generated ones to delete. Pure — no vault. The impure apply step (Task 8) consumes this plan.

**Files:**
- Create: `packages/obsidian-plugin/src/skills/syncWorkflowSkills.ts`
- Test: `packages/obsidian-plugin/test/syncWorkflowSkills.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/obsidian-plugin/test/syncWorkflowSkills.test.ts
import { describe, it, expect } from "vitest";
import { planWorkflowSkills } from "../src/skills/syncWorkflowSkills.js";
import { renderWorkflowSkill } from "@perspecta/core";
import type { WorkflowSummary } from "@perspecta/core";

const s = (name: string, canvasPath: string): WorkflowSummary => ({
  name, canvasPath, trigger: `t-${name}`, purpose: `p-${name}`, nodeCount: 2,
});

describe("planWorkflowSkills", () => {
  it("writes a skill per summary at .claude/skills/<name>/SKILL.md", () => {
    const plan = planWorkflowSkills([s("person-brief", "flows/person-brief.canvas")], {});
    const write = plan.writes.find((w) => w.path === ".claude/skills/person-brief/SKILL.md");
    expect(write).toBeDefined();
    expect(write!.content).toContain("name: person-brief");
    expect(plan.deletes).toEqual([]);
  });

  it("prunes a generated skill whose source canvas is gone", () => {
    const existing = {
      ".claude/skills/old/SKILL.md": renderWorkflowSkill(s("old", "flows/old.canvas")),
    };
    const plan = planWorkflowSkills([s("keep", "flows/keep.canvas")], existing);
    expect(plan.deletes).toContain(".claude/skills/old/SKILL.md");
  });

  it("never deletes a hand-authored (unmarked) skill", () => {
    const existing = {
      ".claude/skills/hand/SKILL.md": "---\nname: hand\ndescription: mine\n---\nKeep me.",
    };
    const plan = planWorkflowSkills([], existing);
    expect(plan.deletes).toEqual([]);
  });

  it("re-writes (not duplicates) a generated skill that still has a source", () => {
    const existing = {
      ".claude/skills/keep/SKILL.md": renderWorkflowSkill(s("keep", "flows/keep.canvas")),
    };
    const plan = planWorkflowSkills([s("keep", "flows/keep.canvas")], existing);
    expect(plan.deletes).toEqual([]);
    expect(plan.writes.map((w) => w.path)).toContain(".claude/skills/keep/SKILL.md");
  });

  it("emits the registry and pointer paths", () => {
    const plan = planWorkflowSkills([s("a", "flows/a.canvas")], {});
    expect(plan.registryPath).toBe("_agents/workflows/INDEX.md");
    expect(plan.registryContent).toContain("a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/obsidian-plugin && npx vitest run test/syncWorkflowSkills.test.ts`
Expected: FAIL — cannot find module `../src/skills/syncWorkflowSkills.js`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// packages/obsidian-plugin/src/skills/syncWorkflowSkills.ts
import { renderWorkflowSkill, renderRegistry, readSkillFrontmatter } from "@perspecta/core";
import type { WorkflowSummary } from "@perspecta/core";

export const SKILLS_DIR = ".claude/skills";
export const REGISTRY_PATH = "_agents/workflows/INDEX.md";

export interface SkillWrite { path: string; content: string; }
export interface SkillSyncPlan {
  writes: SkillWrite[];
  deletes: string[];
  registryPath: string;
  registryContent: string;
}

function skillPath(name: string): string {
  return `${SKILLS_DIR}/${name}/SKILL.md`;
}

/**
 * Pure sync plan.
 * @param summaries  one per marked canvas (already extracted via summarizeWorkflow)
 * @param existing   map of existing skill paths → file content (only SKILL.md files)
 */
export function planWorkflowSkills(
  summaries: WorkflowSummary[],
  existing: Record<string, string>,
): SkillSyncPlan {
  const writes: SkillWrite[] = summaries.map((s) => ({
    path: skillPath(s.name),
    content: renderWorkflowSkill(s),
  }));
  const wantedPaths = new Set(writes.map((w) => w.path));

  // Prune: only generated skills (perspecta_generated:true) whose path is no
  // longer wanted. Hand-authored skills are left untouched.
  const deletes: string[] = [];
  for (const [path, content] of Object.entries(existing)) {
    if (wantedPaths.has(path)) continue;
    const fm = readSkillFrontmatter(content);
    if (fm.perspecta_generated === "true") deletes.push(path);
  }

  return {
    writes,
    deletes,
    registryPath: REGISTRY_PATH,
    registryContent: renderRegistry(summaries),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/obsidian-plugin && npx vitest run test/syncWorkflowSkills.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/skills/syncWorkflowSkills.ts packages/obsidian-plugin/test/syncWorkflowSkills.test.ts
git commit -m "feat(plugin): pure per-workflow skill sync plan with generated-marker pruning"
```

---

## Task 8: Wire reconcile + sync into the plugin lifecycle

Connect the pure pieces to the real vault: scan marked canvases, build summaries, apply the plan on `onload()` and via a command. This is the only task with impure Obsidian I/O; keep its logic thin (delegating to the tested pure functions).

**Files:**
- Modify: `packages/obsidian-plugin/src/main.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/obsidian-plugin/src/main.ts`, extend the `@perspecta/core` import and add the new skill modules. Change the existing line:

```typescript
import { VERSION, isWorkflowCanvas, type NodeType } from "@perspecta/core";
```

to:

```typescript
import { VERSION, isWorkflowCanvas, renderGenericSkill, summarizeWorkflow, type NodeType, type WorkflowSummary } from "@perspecta/core";
import { decideGenericSkill } from "./skills/reconcileGenericSkill.js";
import { planWorkflowSkills, SKILLS_DIR, type SkillSyncPlan } from "./skills/syncWorkflowSkills.js";
import { upsertPointerBlock } from "./skills/claudePointer.js";
```

- [ ] **Step 2: Add the vault-scan + apply helpers**

Add these private methods to the `PerspectaWorkflowPlugin` class (place them next to the other `// ---- shared helpers ----` methods, e.g. after `recolorCanvas`):

```typescript
  /** A VaultReader (preload-compatible) backed by the live adapter. */
  private adapterReader() {
    return {
      read: (p: string) => this.app.vault.adapter.read(p),
      exists: (p: string) => {
        const f = this.app.vault.getAbstractFileByPath(p);
        return f != null;
      },
    };
  }

  /** Reconcile the bundled, version-stamped generic skill (install/upgrade/never-downgrade). */
  private async reconcileGenericSkill(): Promise<void> {
    const path = `${SKILLS_DIR}/perspecta-workflow/SKILL.md`;
    let installed: string | null = null;
    try { installed = await this.app.vault.adapter.read(path); } catch { installed = null; }
    if (decideGenericSkill(installed, VERSION) === "skip") return;
    await this.ensureParentDir(path);
    await this.app.vault.adapter.write(path, renderGenericSkill(VERSION));
  }

  /** Create the parent directory chain for a vault-relative file path if missing. */
  private async ensureParentDir(filePath: string): Promise<void> {
    const dir = filePath.slice(0, filePath.lastIndexOf("/"));
    if (!dir) return;
    if (!(await this.app.vault.adapter.exists(dir))) {
      await this.app.vault.adapter.mkdir(dir);
    }
  }

  /** Build a summary for every marked canvas in the vault. Best-effort per canvas. */
  private async collectWorkflowSummaries(): Promise<WorkflowSummary[]> {
    const summaries: WorkflowSummary[] = [];
    const canvases = this.app.vault.getFiles().filter((f) => f.extension === "canvas");
    for (const file of canvases) {
      try {
        if (!(await this.isMarkedCanvas(file.path))) continue;
        const { preloadCanvas } = await import("./fs/preload.js");
        const { map } = await preloadCanvas(file.path, this.adapterReader());
        const { ObsidianFileSystem } = await import("./fs/ObsidianFileSystem.js");
        const fs = new ObsidianFileSystem(map);
        summaries.push(summarizeWorkflow(file.path, fs));
      } catch (e) {
        new Notice(`Perspecta: skipped ${file.path} — ${(e as Error).message}`);
      }
    }
    return summaries;
  }

  /** Read every existing .claude/skills/<x>/SKILL.md into a path→content map. */
  private async readExistingSkills(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!(await this.app.vault.adapter.exists(SKILLS_DIR))) return out;
    const listing = await this.app.vault.adapter.list(SKILLS_DIR);
    for (const sub of listing.folders) {
      const skillFile = `${sub}/SKILL.md`;
      try {
        if (await this.app.vault.adapter.exists(skillFile)) {
          out[skillFile] = await this.app.vault.adapter.read(skillFile);
        }
      } catch { /* unreadable → ignore */ }
    }
    return out;
  }

  /** Apply a sync plan: write per-workflow skills, prune orphans, write registry + pointer. */
  private async applySkillSyncPlan(plan: SkillSyncPlan): Promise<void> {
    for (const w of plan.writes) {
      await this.ensureParentDir(w.path);
      await this.app.vault.adapter.write(w.path, w.content);
    }
    for (const d of plan.deletes) {
      try { await this.app.vault.adapter.remove(d); } catch { /* already gone */ }
    }
    await this.ensureParentDir(plan.registryPath);
    await this.app.vault.adapter.write(plan.registryPath, plan.registryContent);

    const pointerPath = "CLAUDE.md";
    let existing = "";
    try { existing = await this.app.vault.adapter.read(pointerPath); } catch { existing = ""; }
    await this.app.vault.adapter.write(pointerPath, upsertPointerBlock(existing));
  }

  /** Full regenerate: scan canvases → plan → apply. Best-effort; never throws. */
  private async rebuildWorkflowSkills(): Promise<number> {
    try {
      const summaries = await this.collectWorkflowSummaries();
      const existing = await this.readExistingSkills();
      const plan = planWorkflowSkills(summaries, existing);
      await this.applySkillSyncPlan(plan);
      return summaries.length;
    } catch (e) {
      new Notice(`Perspecta: skill sync failed — ${(e as Error).message}`);
      return 0;
    }
  }
```

- [ ] **Step 3: Call reconcile + rebuild on activate and add the command**

In `onload()`, inside the existing `this.app.workspace.onLayoutReady(() => { ... })` callback at the end, extend it so skills are reconciled/regenerated once the vault is ready (running after layout-ready avoids scanning before files are indexed):

Change:

```typescript
    // initial badge for whatever is open at load
    this.app.workspace.onLayoutReady(() => { void this.refreshBadge(); });
```

to:

```typescript
    // initial badge for whatever is open at load
    this.app.workspace.onLayoutReady(() => {
      void this.refreshBadge();
      void (async () => {
        await this.reconcileGenericSkill();
        await this.rebuildWorkflowSkills();
      })();
    });
```

Then add a new command alongside the other `this.addCommand({...})` blocks in `onload()`:

```typescript
    this.addCommand({
      id: "rebuild-workflow-skills",
      name: "Rebuild workflow skills",
      callback: async () => {
        await this.reconcileGenericSkill();
        const n = await this.rebuildWorkflowSkills();
        new Notice(`Perspecta: rebuilt ${n} workflow skill${n === 1 ? "" : "s"}`);
      },
    });
```

- [ ] **Step 4: Verify the plugin builds and all plugin tests pass**

Run: `cd packages/obsidian-plugin && npx tsc --noEmit && npx vitest run`
Expected: tsc reports no errors; all tests PASS (existing + the three new pure suites).

- [ ] **Step 5: Build the plugin bundle**

Run: `cd packages/obsidian-plugin && node esbuild.config.mjs`
Expected: esbuild writes `main.js` with no errors. (Confirms `renderGenericSkill` and the skill modules bundle for the browser target — no accidental `node:` imports leaked in.)

- [ ] **Step 6: Commit**

```bash
git add packages/obsidian-plugin/src/main.ts
git commit -m "feat(plugin): reconcile generic skill + regenerate workflow skills on activate and on command"
```

---

## Task 9: Full build + test gate

**Files:** none (verification only)

- [ ] **Step 1: Run the full workspace test suite**

Run (from repo root): `npm test`
Expected: all packages' tests PASS, including the new `semver`, `registry`, `skillgen`, `reconcileGenericSkill`, `claudePointer`, and `syncWorkflowSkills` suites.

- [ ] **Step 2: Build all workspaces**

Run (from repo root): `npm run build --workspaces --if-present`
Expected: core builds, then mcp-server; no TypeScript errors.

- [ ] **Step 3: Commit any build artifacts if the repo tracks them**

Run: `git status`
If `packages/obsidian-plugin/main.js` (or other built artifacts) are tracked and changed, commit them:

```bash
git add -A
git commit -m "chore: rebuild after skill-based discovery feature"
```

If `git status` shows nothing to commit, this step is a no-op — proceed.

---

## Manual verification (after merge, in the vault)

These are human/agent-session checks, not automated:

1. Disable then re-enable the plugin in the vault. Confirm `.claude/skills/perspecta-workflow/SKILL.md` appears with `perspecta_version: 0.1.0`.
2. Confirm `.claude/skills/person-brief/SKILL.md` (and one per other marked canvas) is generated, and `_agents/workflows/INDEX.md` lists them.
3. Confirm `CLAUDE.md` has exactly one `<!-- perspecta-workflow:begin -->` block; re-running "Rebuild workflow skills" does not duplicate it.
4. In an agent session, confirm the agent proactively offers the matching workflow when the user's request matches a workflow's `trigger:`, and that it can walk one via the MCP `workflow_*` tools.
5. Edit a workflow's `start`-note `trigger:`, run "Rebuild workflow skills", and confirm the generated skill's `description` updates.
6. Delete (or unmark) a workflow canvas, rebuild, and confirm its generated skill is pruned while any hand-authored skill is untouched.
