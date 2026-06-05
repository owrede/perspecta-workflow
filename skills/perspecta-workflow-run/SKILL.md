---
name: perspecta-workflow-run
description: Use when the user asks to run, walk, list, or choose a Perspecta workflow from an Obsidian vault, including /perspecta:workflow or /ppa:workflow.
---

# Run a Perspecta workflow

1. Read `_agents/workflows/INDEX.md` to list available workflows.
2. Match the user's task to the workflow's purpose and "when to use" text.
3. Prefer MCP tools when connected:
   - `workflow_start(canvasPath)`
   - `workflow_current(session)`
   - `workflow_advance(session, edge?, outputs?)`
   - `workflow_status(session)`
   - `workflow_context(session)`
4. If MCP tools are unavailable, read the canvas and node notes manually.
5. Keep the user informed at branch points and when outputs are recorded.

Never overwrite workflow canvases or node notes unless the user explicitly asks
for authoring or repair.

