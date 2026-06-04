import { SKILLS_DIR, type SkillWrite } from "./syncWorkflowSkills.js";

const overview = `---
name: perspecta-workflow-overview
description: Use when the user asks what Perspecta Workflow does, how workflow canvases work, what files it writes, or how agents should discover workflow processes in an Obsidian vault.
---

# Perspecta Workflow overview

Perspecta Workflow turns marked Obsidian Canvas files into walkable agent
workflows. Agents can discover workflows from \`_agents/workflows/INDEX.md\`
and generated skills in \`.claude/skills/\`.

Prefer MCP tools when connected. If MCP is unavailable, read the canvas JSON and
node notes directly, start at the start node, follow labeled edges, and stop at
the end node.
`;

const install = `---
name: perspecta-install-workflow
description: Use when the user asks to install, update, repair, or verify Perspecta Workflow agent skills or MCP setup in an Obsidian vault.
---

# Install Perspecta Workflow agent support

Open Obsidian settings, then Perspecta Workflow, then the Install tab. Run
\`Install / Update agent skills\`.

The install action writes plugin-owned skills under \`.claude/skills/\`,
generates \`_agents/workflows/INDEX.md\`, and updates vault \`CLAUDE.md\` with a
delimited Perspecta Workflow pointer block. It must not delete hand-authored
skills.

For MCP setup, build \`packages/mcp-server/dist/server.js\` and register it as
the \`perspecta-workflow\` MCP server in the agent client.
`;

const run = `---
name: perspecta-workflow-run
description: Use when the user asks to run, walk, list, or choose a Perspecta workflow from an Obsidian vault, including /perspecta:workflow or /ppa:workflow.
---

# Run a Perspecta workflow

1. Read \`_agents/workflows/INDEX.md\` to list workflows.
2. Match the task to the workflow's purpose and trigger text.
3. Prefer MCP tools: \`workflow_start\`, \`workflow_current\`,
   \`workflow_advance\`, \`workflow_status\`, and \`workflow_context\`.
4. If MCP tools are unavailable, read the canvas and node notes manually.

Never overwrite workflow canvases or node notes unless the user explicitly asks
for authoring or repair.
`;

export function bundledSkillWrites(): SkillWrite[] {
  return [
    { path: `${SKILLS_DIR}/perspecta-workflow-overview/SKILL.md`, content: overview },
    { path: `${SKILLS_DIR}/perspecta-install-workflow/SKILL.md`, content: install },
    { path: `${SKILLS_DIR}/perspecta-workflow-run/SKILL.md`, content: run },
  ];
}
