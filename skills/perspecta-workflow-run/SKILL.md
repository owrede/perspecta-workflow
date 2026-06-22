---
name: perspecta-workflow-run
description: Use when the user asks to run, list, or choose a Perspecta workflow from an Obsidian vault, including /perspecta:workflow or /ppa:workflow.
---

# Run a Perspecta workflow

1. List the `.pflow` files in `_agents/` to see the available workflows.
2. Match the task to a workflow's `workflow.description`.
3. Run it via its exported script at `.claude/workflows/<name>.js`, passing the
   workflow's `args`. If that script does not exist, the `.pflow` has not been
   exported yet — open it in the Perspecta Workflow editor and use **Export**
   first. See the `perspecta-workflow` skill for the full procedure.

Never overwrite a `.pflow` document unless the user explicitly asks for
authoring or repair.
