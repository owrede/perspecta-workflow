# Perspecta Workflow

Turns Obsidian Canvas files into walkable agentic workflows. Nodes are prompts,
tool calls, data sources, or vault-memory contracts, chained as a directed
flowchart from a `start` node to an `end` node. Workflows compose (a canvas can
embed another canvas) and may loop.

Shipped two ways from one shared, fs-agnostic core:

- an **MCP server** (`@perspecta/mcp-server`) that exposes the workflow tools to
  any MCP client, and
- an **Obsidian plugin** (`packages/obsidian-plugin`) that authors and validates
  workflow canvases inside Obsidian.

## Repository layout (npm workspaces monorepo)

```
packages/
  core/             fs-agnostic engine: types, canvas-parse, graph, linter,
                    context, stepper — behind a WorkflowFileSystem seam (no node:fs)
  mcp-server/       NodeFileSystem (node:fs) + the MCP server.ts entry
  obsidian-plugin/  ObsidianFileSystem (Vault API) + the Phase-1 authoring UI
```

The core has zero Node dependencies, so it bundles for both the Node MCP server
and the Obsidian browser/mobile renderer. See
[`packages/obsidian-plugin/README.md`](packages/obsidian-plugin/README.md) for
the plugin's commands, install steps, and manual-test checklist.

## Tools

- `workflow_lint(canvas, fix?)` — validate a workflow canvas; `fix` re-colors nodes by type.
- `workflow_start(canvas)` — lint + begin a walk, returns a session id.
- `workflow_current(session)` — current node: resolved instruction + outgoing edges.
- `workflow_advance(session, edge?, outputs?)` — record outputs, follow an edge (label required at branches).
- `workflow_context(session)` — inspect the shared context bag.
- `workflow_status(session)` — cursor position, call-stack depth, at-end flag.

## How it works

A workflow node is a Canvas `file`-node pointing at a `.md` note with
`class: WorkflowNode` frontmatter. The `node_type` (start / end / prompt /
tool / data / contract / loop / config) is the source of truth; node color is
auto-derived by the linter. Edges are directed and labeled; at a branch or
loop the consumer chooses which labeled edge to follow. A `file`-node pointing
at another `.canvas` is a subworkflow — the stepper descends into it (sharing
one context bag) and pops back out at the child's end node. Infinite loops are
forbidden inside embedded workflows.

### Notes

v1 enforces the no-infinite-loops-in-embedded-workflows rule top-down — when a
parent canvas is linted, its embedded children are scanned recursively. Linting
a child canvas in isolation does not detect that it is illegally embedded
elsewhere; the spec's vault-wide inbound "who-embeds-whom" pass is deferred. In
practice the rule fires whenever you lint the workflow you actually run (the
parent).

## Develop

    npm install
    npm test                  # vitest, all packages
    npm run build --workspaces  # builds core, then mcp-server (tsc -> dist/)

## Register as an MCP server

    {
      "mcpServers": {
        "perspecta-workflow": {
          "type": "stdio",
          "command": "node",
          "args": ["/absolute/path/to/perspecta-workflow/packages/mcp-server/dist/server.js"]
        }
      }
    }

The server entry moved to `packages/mcp-server/dist/server.js` in the monorepo
refactor. Run `npm run build --workspaces` first so it exists (core builds
before mcp-server, which imports the built `@perspecta/core`).

## Spec

See the design spec in the Intelligence Impact vault:
`docs/superpowers/specs/2026-06-02-canvas-agentic-workflows-design.md`

## Status

- **Engine v1:** schema + linter (+ auto-color) + cursor/stepper, now extracted
  into the fs-agnostic `@perspecta/core` and consumed by the MCP server.
- **Plugin Phase 1 (v0.1):** author + validate inside Obsidian — validate
  command + results panel, apply-node-colors, insert-prompt-node, settings.

Deferred: plugin Phase 2 (interactive walk panel) and Phase 3 (LLM
auto-execution); `config` node runtime behavior (e.g. `maxloops`); a
conversational authoring helper; context namespacing for nested canvases; and
the vault-wide inbound "who-embeds-whom" embed pass.
