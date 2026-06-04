---
name: perspecta-workflow-overview
description: Use when the user asks what Perspecta Workflow does, how workflow canvases work, what files it writes, or how agents should discover workflow processes in an Obsidian vault.
---

# Perspecta Workflow overview

Perspecta Workflow turns marked Obsidian Canvas files into walkable agent
workflows. Nodes point to Markdown notes with `WorkflowNode` frontmatter and are
connected by directed, labeled edges.

Key artifacts:

- workflow canvases: `.canvas` files with a `perspecta.workflow` marker;
- node notes: Markdown files with `class: WorkflowNode` and `node_type`;
- generated workflow registry: `_agents/workflows/INDEX.md`;
- generated skills: `.claude/skills/<workflow>/SKILL.md`;
- generic workflow skill: `.claude/skills/perspecta-workflow/SKILL.md`.

Agents should prefer the MCP server when connected. If MCP tools are unavailable,
read the canvas JSON and node notes directly, start at the `start` node, follow
labeled edges, and stop at the `end` node.

