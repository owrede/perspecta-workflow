# Perspecta Workflow — Obsidian Plugin

Author and validate agentic **workflow canvases** inside Obsidian. A workflow is
an Obsidian Canvas whose `file`-nodes point at `.md` notes with
`class: WorkflowNode` frontmatter — `start`, `prompt`, `tool`, `data`,
`contract`, `loop`, `end` — chained as a directed flowchart. This plugin lints
the structure, colors nodes by type, and scaffolds new node-notes, all backed by
the shared [`@perspecta/core`](../core) engine.

This is **Phase 1** (author + validate). Phase 2 (interactive walk) and Phase 3
(LLM auto-execution) are planned in separate specs.

## Commands

Run from the command palette (all operate on the **active** `.canvas`):

- **Validate workflow canvas** — preloads the canvas and its node-notes, lints
  the graph, and shows findings in a right-sidebar panel (or `✓ Valid workflow`).
- **Apply node colors** — recolors every node by its `node_type` and writes the
  canvas back. Reports "Colors already up to date" when nothing changes.
- **Insert prompt node** — creates a new `prompt` WorkflowNode note in the
  configured folder and adds a `file`-node for it to the active canvas.

## Settings

- **Node note folder** — where inserted node-notes are created (default
  `workflows`).
- **Auto-color on save** — (toggle; wiring deferred to Phase 1.5).
- **Live validation** — (toggle; on-edit validation deferred to Phase 1.5).

## Install via BRAT

1. Install the **BRAT** community plugin.
2. BRAT → *Add a beta plugin* → point it at this repository.
3. Enable **Perspecta Workflow** in *Settings → Community plugins*.

The release bundle is `main.js` + `manifest.json` + `styles.css`. Build it with
`npm run build -w @perspecta/core && npm run build -w perspecta-workflow-plugin`
(core must build first so the bundler can inline it).

## Manual test checklist

1. Open `_src/workflows/example-person-brief/person-brief.canvas`
   (in the Intelligence Impact vault).
2. Run **Validate workflow canvas** → expect `✓ Valid workflow` in the sidebar.
3. Edit a node's frontmatter to delete its `node_type` → re-validate → expect a
   finding naming that node (a `valid-node-type` / parse error), not a crash.
4. Run **Apply node colors** → nodes recolor by type (start green, end red, …).
5. Run **Insert prompt node** → a new prompt node-note plus a canvas node appear.

## Notes

- **Path resolution:** Obsidian canvas `file` values are vault-relative; the
  plugin preloads every referenced note into a sync map keyed by those exact
  strings, so the core resolves them directly — no path heuristics.
- **Mobile:** the core is Node-free, so the plugin is not desktop-only. (The
  Phase-1 surfaces only read/write canvas JSON and node-notes via the Vault API.)
- **Live validation** (re-lint on edit) is deferred to Phase 1.5; Obsidian's
  canvas-change events are not a stable public API. Command-driven validation
  ships now.
