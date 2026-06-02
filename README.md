# Perspecta Workflow

An MCP server that turns Obsidian Canvas files into walkable agentic workflows.
Nodes are prompts, tool calls, data sources, or vault-memory contracts, chained
as a directed flowchart from a `start` node to an `end` node. Workflows compose
(a canvas can embed another canvas) and may loop.

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
    npm test          # vitest
    npm run build     # tsc -> dist/

## Register as an MCP server

    {
      "mcpServers": {
        "perspecta-workflow": {
          "type": "stdio",
          "command": "node",
          "args": ["/absolute/path/to/perspecta-workflow/dist/server.js"]
        }
      }
    }

Run `npm run build` first so `dist/server.js` exists.

## Spec

See the design spec in the Intelligence Impact vault:
`docs/superpowers/specs/2026-06-02-canvas-agentic-workflows-design.md`

## Status

v1: schema + linter (+ auto-color) + cursor/stepper MCP tools. Deferred to v2:
`config` node runtime behavior (e.g. `maxloops`), a headless LLM-API runtime
consuming the same tools, a conversational authoring helper, and optional
context namespacing for nested canvases.
