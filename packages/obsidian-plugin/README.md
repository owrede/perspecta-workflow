# Perspecta Workflow — Obsidian Plugin

Author and validate agentic **workflow canvases** inside Obsidian. A workflow is
an Obsidian Canvas whose `file`-nodes point at `.md` notes with
`class: WorkflowNode` frontmatter, chained as a directed flowchart. This plugin
recognizes workflow canvases, colors their nodes by type automatically, lints
the structure, and scaffolds node-notes — all backed by the shared
[`@perspecta/core`](../core) engine.

Phases: **Phase 1** = author + validate; **Phase 1.5** (this build) = workflow
identity + guided node types + auto-color. Phase 2 (interactive walk) and Phase 3
(LLM auto-execution) are planned separately.

## Workflow identity

A canvas becomes a Perspecta workflow when it carries a marker key in its JSON:

```json
{ "perspecta": { "workflow": true, "version": 1 }, "nodes": [...], "edges": [...] }
```

The JSON Canvas spec requires tools to preserve unknown top-level keys, so
Obsidian round-trips this untouched. **Ordinary canvases without the marker are
left completely alone** — no coloring, no badge, no linting.

When the active canvas is a workflow, a small **"Workflow" badge** appears in the
top-left corner (and a `⬡ Workflow` indicator in the status bar as a reliable
fallback). The badge is a visual overlay; if a future Obsidian version changes
the canvas DOM it fails silently and the status-bar indicator still shows.

## Commands

Run from the command palette (all operate on the **active** `.canvas`):

- **Use canvas as workflow** — stamps the marker so the plugin recognizes this
  canvas. Idempotent. Run this once per canvas you want to treat as a workflow.
- **Set node type** — pick a node-note, then pick one of the 8 node types from a
  list; writes `node_type` into that note's frontmatter (preserving the rest).
- **Validate workflow canvas** — lints the graph; findings in a right-sidebar
  panel (or `✓ Valid workflow`). *Requires the marker.*
- **Apply node colors** — recolors every node by `node_type`. *Requires the
  marker.* (Usually unnecessary — auto-color does this for you.)
- **Insert prompt node** — creates a `prompt` WorkflowNode note in the configured
  folder and adds a `file`-node to the canvas (stamps the marker if missing).

## Auto-color

When auto-color is on (**default**), a workflow canvas's nodes are colored by
`node_type` **automatically** — when the canvas opens, and (debounced ~½s)
whenever the canvas or one of its node-notes changes. No command needed. A
self-write guard prevents the write→re-color loop. Toggle it in settings.

## The 8 node types

| `node_type` | Role | Color |
|---|---|---|
| start | entry point of the workflow | 🟢 green |
| end | terminal node | 🔴 red |
| prompt | an instruction for the agent | 🟣 purple |
| tool | a tool call (e.g. `write_note`) | 🟠 orange |
| data | read a note / data source | 🔵 cyan |
| contract | a vault-memory contract | 🔵 blue |
| loop | conditional loop / branch-back | 🟡 yellow |
| config | workflow parameters (e.g. `maxloops`) | ⚪ gray |

A `file`-node pointing at another `.canvas` is a **subworkflow** (no
`node_type`; the plugin leaves its color untouched).

## Settings

- **Node note folder** — where inserted node-notes are created (default
  `workflows`).
- **Auto-color workflow nodes** — color nodes by type on open/change (default
  **on**).

## Install via BRAT

1. Install the **BRAT** community plugin.
2. BRAT → *Add a beta plugin* → point it at this repository.
3. Enable **Perspecta Workflow** in *Settings → Community plugins*.

The release bundle is `main.js` + `manifest.json` + `styles.css`. Build it with
`npm run build -w @perspecta/core && npm run build -w perspecta-workflow-plugin`
(core must build first so the bundler can inline it).

## Manual test checklist

1. Open a **plain** `.canvas` (not a workflow) → no badge, no coloring (left
   alone).
2. Open a workflow canvas (e.g. the vault's
   `_agents/workflows/meeting-followup/meeting-followup.canvas`) → "Workflow"
   badge top-left; nodes auto-color by type.
3. On a plain canvas, run **Use canvas as workflow** → badge appears; nodes with
   `node_type` color.
4. Edit a node-note's `node_type` (or use **Set node type**) → the canvas
   recolors within ~½s.
5. Run **Validate workflow canvas** → `✓` or a list of findings.
6. Re-open the plain canvas from step 1 → still no badge/coloring.

## Notes

- **Path resolution:** Obsidian canvas `file` values are vault-relative; the
  plugin preloads every referenced note into a sync map keyed by those exact
  strings, so the core resolves them directly — no path heuristics.
- **Mobile:** the core is Node-free, so the plugin is not desktop-only.
- **MCP server asymmetry:** the marker gates the *plugin*. The MCP server
  (`workflow_lint` etc.) stays path-driven — it lints whatever canvas path you
  give it, marker or not, because the caller already chose the file.
- **Deferred:** live *validation* (re-lint on edit, status in the badge) — the
  badge is label-only for now.
