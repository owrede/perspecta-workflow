# Perspecta Workflow - Agent Guide

## Role

Perspecta Workflow turns Obsidian Canvas files into agent-readable workflows. It
ships a filesystem-agnostic core, an MCP server, and an Obsidian plugin.

## Source Map

Detailed per-module map: `docs/CODE-MAP.md`.

- `packages/core/` - canvas parsing, graph/linter/stepper, registry, skill generation.
- `packages/mcp-server/` - MCP stdio server exposing workflow tools.
- `packages/obsidian-plugin/` - Obsidian authoring UI, canvas marker, node coloring, settings, skill sync.
- `skills/` - source-of-truth local skills installed into vaults.

## Commands

- `npm test` - run all Vitest suites.
- `npm run build` - build all workspaces.
- `npm run build -w @perspecta/core` - build core only.
- `npm run build -w @perspecta/mcp-server` - build MCP server.
- `npm run build -w perspecta-workflow-plugin` - build Obsidian plugin.
- `npm run deploy -w perspecta-workflow-plugin` - build + copy the plugin to the
  local test vault (`scripts/deploy-dev.sh`; `PERSPECTA_VAULT_ROOT`-overridable,
  defaults to `Perspecta-Dev`, skips gracefully if absent).

## Conventions

This repo follows the Perspecta Suite conventions for naming, settings structure,
agent skills, metadata, and lean refactors. Source of truth:
`../perspecta-suite/docs/SUITE-CONVENTION-CATALOG.md`.

When alignment work discovers a suite-wide pattern, update the catalog before
continuing and retouch already-aligned plugins if needed.

