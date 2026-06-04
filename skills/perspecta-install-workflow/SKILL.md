---
name: perspecta-install-workflow
description: Use when the user asks to install, update, repair, or verify Perspecta Workflow agent skills or MCP setup in an Obsidian vault.
---

# Install Perspecta Workflow agent support

Use the plugin settings tab first:

1. Open Obsidian settings.
2. Open Perspecta Workflow.
3. Open the `Install` tab.
4. Run `Install / Update agent skills`.

This writes plugin-owned files under `.claude/skills/`, generates
`_agents/workflows/INDEX.md`, and updates the vault `CLAUDE.md` with a delimited
Perspecta Workflow pointer block. It must not delete hand-authored skills.

If working from the repo, use:

```bash
scripts/install-skills.sh /absolute/path/to/vault
```

For MCP setup, build the server first:

```bash
npm run build -w @perspecta/core
npm run build -w @perspecta/mcp-server
```

Then register `packages/mcp-server/dist/server.js` as the `perspecta-workflow`
MCP server in the agent client.

