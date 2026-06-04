# Perspecta Workflow — Agent Discovery & Invocation (Phase 1.6)

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Repo:** `~/Documents/GitHub/perspecta-workflow`
**Depends on:** Phase 1.5 (marker, auto-color, Set node type) — merged to `main`.

## Purpose

Make workflows **discoverable and invocable by agents** working in the vault.
Today the plugin authors/validates canvases and the MCP server can *walk* one by
path, but nothing tells an agent which workflows exist, what they do, or when to
use them — and there's no ergonomic way to invoke one by name.

Two capabilities:

1. **`/perspecta:workflow <name>`** (alias **`/ppa:workflow <name>`**) — a Claude
   Code slash command (in the vault's `.claude/commands/`) that loads a named
   workflow and has the agent walk/execute it via the existing MCP tools. With no
   argument it lists workflows.
2. **Ambient agent awareness** — agents working in the vault know workflows
   exist, what each does, and when to trigger one, via a generated registry the
   agent reads (and a pointer from the vault's agent instructions).

The registry is **generated from the canvases** (single source of truth).

## Suite conventions (Perspecta plugin family)

Perspecta is an umbrella for a family of Obsidian plugins: **perspecta-obsidian**
(window/workspace), **perspecta-slides**, **perspecta-workflow** (this), and a
future **perspecta-memory** (the renamed vault-memory). Agent-facing identifiers
and file metadata use a **shared `perspecta` namespace + per-plugin suffix** so
features read as one suite and siblings never collide.

- **Agent identifiers:** `perspecta:<plugin>` canonical, `ppa:<plugin>` short
  alias. For this plugin: `perspecta:workflow` (alias `ppa:workflow`). Both resolve
  to the same command.
- **Canvas/file metadata:** one suite key with per-plugin sub-objects —
  `perspecta: { workflow: {…}, slides: {…}, memory: {…} }`.

## Critical prerequisite: restructure the marker into the suite namespace

**Discovery:** some canvases in this vault already carry a top-level `perspecta`
key from another tool (`"perspecta": { "uid": "…" }`, likely Advanced URI). The
Phase-1.5 marker was `perspecta: { workflow: true, version: 1 }` (a flat shape).

**Decision:** adopt the suite-namespaced sub-object shape and **merge** on write
so the suite namespace is shared cleanly across plugins AND any foreign keys are
preserved:

```json
{ "perspecta": { "workflow": { "version": 1 } }, "nodes": [...], "edges": [...] }
```

- `isWorkflowCanvas(canvas)` ⇒ true iff `canvas.perspecta?.workflow` is an object
  (presence of the `workflow` sub-object marks it). A foreign
  `perspecta: { uid: … }` (no `workflow` sub-key) is correctly NOT a workflow.
- `stampWorkflowMarker` **merges**: it sets `perspecta.workflow = { version }`
  while preserving every other key already under `perspecta` (e.g. a foreign
  `uid`) and every other top-level key. Never replaces the whole `perspecta`
  object.
- **Back-compat read:** `isWorkflowCanvas` ALSO accepts the legacy flat forms —
  `perspecta:{workflow:true}` (Phase 1.5) — so not-yet-migrated canvases still
  work. `stamp`/migration always writes the new nested shape.
- **Migration:** the two existing marked canvases (`person-brief.canvas`,
  `meeting-followup.canvas`) are re-stamped to `perspecta.workflow`, dropping the
  legacy `workflow:true`/`version` flat fields but preserving nodes/edges/colors.

**Known residual risk (documented):** because the suite shares the top-level
`perspecta` key with a foreign tool, if that tool ever *replaces* its whole
`perspecta` object (rather than merging), it would drop our `workflow` sub-key.
The merge-on-write strategy is the best mitigation while keeping the unified
`perspecta.*` namespace; a fully-isolated `perspectaWorkflow` key was the
considered alternative but rejected in favor of the suite namespace. Re-stamping
(via "Use canvas as workflow" or the index rebuild) restores the marker if lost.

This is a contained change to `packages/core/src/marker.ts` + its tests, plus a
re-stamp of the two existing canvases. It must land FIRST.

## Architecture

```
packages/core/src/
  marker.ts            # renamed key + back-compat read (Phase 1.6)
  registry.ts          # NEW: WorkflowSummary type + buildRegistry(parse inputs)
packages/mcp-server/src/
  server.ts            # NEW tool: workflow_list (scan + summaries)   [optional, see Scope]
(vault — not repo)
  .claude/commands/perspecta/workflow.md   # NEW slash command → /perspecta:workflow
  .claude/commands/ppa/workflow.md         # alias → /ppa:workflow (thin pointer)
  _agents/workflows/INDEX.md               # GENERATED registry note
  CLAUDE.md (or .claude/ pointer)          # ambient-awareness pointer
```

### Registry data model (core)

```typescript
// packages/core/src/registry.ts
export interface WorkflowSummary {
  /** kebab name derived from the canvas filename (e.g. "meeting-followup"). */
  name: string;
  /** vault-relative path to the .canvas. */
  canvasPath: string;
  /** one-line purpose, from the start node's first body line. */
  purpose: string;
  /** optional "when to use" hint, from the start node frontmatter `trigger:`. */
  trigger?: string;
  /** node-type counts, for a quick shape summary. */
  nodeCount: number;
}

/** Build a summary from a parsed canvas + its start-node note (both already read). */
export function summarizeWorkflow(input: {
  name: string;
  canvasPath: string;
  canvasJson: string;
  startNoteText: string | null;
}): WorkflowSummary;
```

`summarizeWorkflow` is **pure** (takes already-read strings) so it's testable and
fs-agnostic, consistent with the rest of core. The fs walking (find canvases,
read start notes) happens in the caller (the registry generator / MCP tool).

### Start-node trigger hint (authoring convention)

A workflow's `start` node note MAY declare when an agent should use it:

```yaml
---
class: WorkflowNode
node_type: start
trigger: "when the user wants to follow up on a meeting note"
outputs: [meeting]
---
Turn a meeting note into a follow-up summary with action items, then save it.
```

- `purpose` = the first non-empty body line of the start note.
- `trigger` = the optional `trigger:` frontmatter field.

Both are optional; absent → the summary still lists name + path + nodeCount.

## The registry note (generated)

`_agents/workflows/INDEX.md` — an agent-readable index, regenerated on demand:

```markdown
---
generated_by: perspecta-workflow
do_not_edit: true
---
# Perspecta Workflows

Workflows an agent can run in this vault. Invoke with `/perspecta:workflow <name>`
(alias `/ppa:workflow <name>`) or by walking the canvas via the perspecta-workflow
MCP tools.

| Workflow | Purpose | When to use |
|---|---|---|
| `meeting-followup` | Turn a meeting note into a follow-up summary with action items | when the user wants to follow up on a meeting note |
| `example-person-brief` | Draft a short network brief about a person | when the user asks for a brief on someone in the network |

<!-- each row links to its .canvas -->
```

**Generation trigger:** a command (Obsidian command **"Perspecta: Rebuild
workflow index"** AND/OR a small repo script) scans the vault for canvases where
`isWorkflowCanvas` is true, reads each start note, calls `summarizeWorkflow`, and
writes `INDEX.md`. The plugin command is the ergonomic path; the script is the
CI/agent path.

## The `/perspecta:workflow` slash command (Claude Code)

Claude Code namespaces commands by subdirectory: `.claude/commands/perspecta/workflow.md`
is invoked as **`/perspecta:workflow`**. A thin alias file
`.claude/commands/ppa/workflow.md` provides **`/ppa:workflow`** (identical
instructions, or a one-line "see /perspecta:workflow"). Available to any agent
session in the vault.

- **`/perspecta:workflow`** (no arg) → the agent reads `_agents/workflows/INDEX.md`
  and lists the available workflows with their purpose + when-to-use.
- **`/perspecta:workflow <name>`** → the agent:
  1. resolves `<name>` to a canvas path via the registry,
  2. calls the MCP `workflow_start(canvasPath)` to begin a walk (or, if MCP isn't
     connected, reads the canvas + node-notes directly),
  3. walks node-by-node: at each node it follows the resolved instruction, records
     outputs, and chooses labeled edges at branches/loops,
  4. reports progress and the final result.

The command file is **instructions for the agent**, not code — it tells the agent
how to load and walk a workflow using the tools already available. It does NOT
embed an execution engine; the agent IS the runtime (the realistic model today).

## Ambient agent awareness

So an agent *proactively* knows workflows exist and when to use them:

- A short section is added to the vault's agent instructions (a vault-root
  `CLAUDE.md`, created if absent, or an existing `.claude/` instruction file)
  pointing at `_agents/workflows/INDEX.md`:

  > **Workflows:** This vault defines Perspecta workflows (see
  > `_agents/workflows/INDEX.md`). Before doing multi-step tasks that match a
  > workflow's "when to use", offer to run it via `/perspecta:workflow <name>`.

- The registry's "When to use" column is what lets the agent match a user request
  to a workflow. Keeping it generated-from-canvas means it stays accurate.

## Testing

- **core `marker.ts`:** new-key stamp/read; back-compat read of legacy
  `perspecta:{workflow:true}`; `isWorkflowCanvas` rejects the foreign
  `perspecta:{uid:…}` and the new foreign-safe cases.
- **core `registry.ts`:** `summarizeWorkflow` extracts purpose (first body line),
  trigger (frontmatter), nodeCount; handles a start note with no trigger; handles
  a missing start note (purpose falls back to name).
- **plugin "Rebuild workflow index":** the scan→summaries→markdown logic unit-
  tested with a mocked vault (a set of canvas + note strings → expected INDEX.md).
- **migration:** re-stamping a legacy-marked canvas yields the new key and drops
  the old one; a foreign `perspecta:{uid}` canvas is left untouched.
- Slash command + CLAUDE.md pointer: manual (agent-session) verification.

## Migration

1. Land the marker restructure (core) into `perspecta.workflow` with merge + back-compat read.
2. Re-stamp the two existing workflow canvases in the vault to the nested shape
   (programmatic, preserving nodes/edges/colors and any foreign `perspecta` keys).
3. Generate the initial `_agents/workflows/INDEX.md`.
4. Install `.claude/commands/perspecta/workflow.md` + `ppa/workflow.md` alias and
   the CLAUDE.md pointer in the vault.

## Scope

### In (this phase)
- Marker restructure → `perspecta.workflow` (merge-on-write) + back-compat read +
  re-stamp migration.
- `registry.ts` (`summarizeWorkflow`, `WorkflowSummary`) in core.
- Plugin command "Rebuild workflow index" → writes `_agents/workflows/INDEX.md`.
- `.claude/commands/perspecta/workflow.md` (`/perspecta:workflow`) + `ppa/workflow.md`
  alias (`/ppa:workflow`) — list + run-by-name.
- Vault agent-awareness pointer (CLAUDE.md section).
- Start-node `trigger:` + `purpose` authoring convention.

### Out (deferred)
- `workflow_list` MCP tool — OPTIONAL; the static INDEX.md covers agent discovery
  without a server change. Add later only if a live/no-file path is needed.
- Autonomous in-plugin LLM execution (Phase 3 — unchanged).
- Auto-regenerating INDEX.md on every canvas change (Phase 1.6 = on-command /
  on-script; a watcher could come later).
- Obsidian-palette per-workflow run commands (the chosen surface is the agent
  slash command).

## Open questions / deferred

- **Name uniqueness:** workflow `name` derives from the canvas filename; two
  canvases with the same filename in different folders would collide. The
  generator disambiguates by appending a short path segment if names clash, and
  the registry stores the full path. Acceptable for the current vault (no clash).
- **MCP connection assumption:** `/perspecta:workflow <name>` prefers the MCP
  `workflow_*` tools but falls back to reading the canvas + notes directly if the
  server isn't connected in that session. The command file documents both paths.
