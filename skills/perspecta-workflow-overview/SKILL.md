---
name: perspecta-workflow-overview
description: Use when the user asks what Perspecta Workflow does, how pflow workflows work, what files it writes, or how agents should discover workflow processes in an Obsidian vault.
---

# Perspecta Workflow overview

Perspecta Workflow lets you author **`.pflow` workflows** — typed node-and-wire
documents edited in a visual editor inside Obsidian. They live under `_agents/`
(e.g. `_agents/person-brief.pflow`).

A `.pflow` is **compiled (exported)** to a native Claude Code dynamic-workflow
script at `.claude/workflows/<name>.js`; that script is the runnable artifact.
Agents discover workflows by listing `_agents/*.pflow` and via the per-workflow
skills under `.claude/skills/` (each skill's `description` says when to use it).

To run one, run its exported `.claude/workflows/<name>.js` with the workflow's
`args`. See the `perspecta-workflow` skill for the procedure (including exporting
a `.pflow` that has not been exported yet).
