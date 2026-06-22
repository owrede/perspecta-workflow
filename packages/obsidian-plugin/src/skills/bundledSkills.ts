import { SKILLS_DIR, type SkillWrite } from "./syncWorkflowSkills.js";

const overview = `---
name: perspecta-workflow-overview
description: Use when the user asks what Perspecta Workflow does, how pflow workflows work, what files it writes, or how agents should discover workflow processes in an Obsidian vault.
---

# Perspecta Workflow overview

Perspecta Workflow lets you author **\`.pflow\` workflows** — typed node-and-wire
documents edited in a visual editor inside Obsidian. They live under \`_agents/\`
(e.g. \`_agents/person-brief.pflow\`).

A \`.pflow\` is **compiled (exported)** to a native Claude Code dynamic-workflow
script at \`.claude/workflows/<name>.js\`; that script is the runnable artifact.
Agents discover workflows by listing \`_agents/*.pflow\` and via the per-workflow
skills under \`.claude/skills/\` (each skill's \`description\` says when to use it).

To run one, run its exported \`.claude/workflows/<name>.js\` with the workflow's
\`args\`. See the \`perspecta-workflow\` skill for the procedure (including
exporting a \`.pflow\` that has not been exported yet).
`;

const install = `---
name: perspecta-install-workflow
description: Use when the user asks to install, update, repair, or verify Perspecta Workflow agent skills or MCP setup in an Obsidian vault.
---

# Install Perspecta Workflow agent support

Open Obsidian settings, then Perspecta Workflow, then the Install tab. Run
\`Install / Update agent skills\`.

The install action writes plugin-owned skills under \`.claude/skills/\` (one
generated skill per \`.pflow\` under \`_agents/\`) and updates vault \`CLAUDE.md\`
with a delimited Perspecta Workflow pointer block. It must not delete
hand-authored skills.

\`.pflow\` workflows are authored in the visual editor and live under \`_agents/\`.
To make one runnable, open it in the editor and use **Export** to compile it to
\`.claude/workflows/<name>.js\`.

For MCP setup, build \`packages/mcp-server/dist/server.js\` and register it as
the \`perspecta-workflow\` MCP server in the agent client.
`;

const run = `---
name: perspecta-workflow-run
description: Use when the user asks to run, list, or choose a Perspecta workflow from an Obsidian vault, including /perspecta:workflow or /ppa:workflow.
---

# Run a Perspecta workflow

1. List the \`.pflow\` files in \`_agents/\` to see the available workflows.
2. Match the task to a workflow's \`workflow.description\`.
3. Run it via its exported script at \`.claude/workflows/<name>.js\`, passing the
   workflow's \`args\`. If that script does not exist, the \`.pflow\` has not been
   exported yet — open it in the Perspecta Workflow editor and use **Export**
   first. See the \`perspecta-workflow\` skill for the full procedure.

Never overwrite a \`.pflow\` document unless the user explicitly asks for
authoring or repair.
`;

export function bundledSkillWrites(): SkillWrite[] {
  return [
    { path: `${SKILLS_DIR}/perspecta-workflow-overview/SKILL.md`, content: overview },
    { path: `${SKILLS_DIR}/perspecta-install-workflow/SKILL.md`, content: install },
    { path: `${SKILLS_DIR}/perspecta-workflow-run/SKILL.md`, content: run },
  ];
}
