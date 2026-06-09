# Perspecta Workflow — Code Map

> Updated 2026-06-09. One line per module; regenerate when packages gain/lose files.
> Quick orientation lives in `AGENTS.md`; this is the detailed map.

## What this repo is

Perspecta Workflow turns Obsidian Canvas files into agent-readable, executable
workflows. Three workspaces (npm monorepo, Vitest, TypeScript):

| Package | Role |
|---|---|
| `packages/core` | Filesystem-agnostic engine: canvas parsing, graph/linter/stepper, pflow IR + validation, MCP registry, codegen, skill generation |
| `packages/mcp-server` | MCP stdio server exposing `workflow_*` tools; probe CLI |
| `packages/obsidian-plugin` | Authoring UI: canvas marker/coloring, pflow visual editor (Svelte Flow), settings + MCP tab, skill sync, export |

`skills/` holds the source-of-truth local skills installed into vaults.
Build artifacts ship from `dist/`; the plugin bundles `mcp-server.mjs` and
`mcp-probe.mjs` (pre-built, SDK inlined — the Obsidian renderer cannot import
external npm packages).

## packages/core/src

### Canvas-workflow layer (v1: marked canvases + node notes)

- `types.ts` — Core types: `Canvas`/`CanvasNode`/`CanvasEdge`, `WorkflowNode`, `NodeType`, `NODE_COLORS`/`NODE_COLOR_HEX`.
- `canvas.ts` — Parse Canvas JSON + node-note frontmatter into workflow graphs (`parseCanvas`, `parseNodeNote`).
- `frontmatter.ts` — YAML frontmatter split/parse, CRLF-tolerant (`splitFrontmatter`, `parseNoteFrontmatter`).
- `graph.ts` — Directed graph from canvases, reference resolution, vault-root discovery (`buildGraph`, `findVaultRoot`, `reachableFrom`).
- `linter.ts` — Structural validation: one start node, reachable ends, sequencing (`lint`).
- `stepper.ts` — Runtime execution state machine: step through nodes, resolve templates, track context (`Stepper`).
- `context.ts` — `{{variable}}` template resolution + `ContextBag` store (`resolveTemplate`).
- `marker.ts` — Detect/stamp the `perspecta.workflow` canvas marker, legacy-tolerant (`isWorkflowCanvas`, `stampWorkflowMarker`).
- `registry.ts` — Workflow metadata summaries: name, trigger, purpose, node count (`summarizeWorkflow`).
- `skillgen.ts` — Render per-workflow SKILL.md (YAML frontmatter + tables, injection-safe) (`renderWorkflowSkill`).
- `fs.ts` — Pluggable `WorkflowFileSystem` abstraction + `InMemoryFileSystem`.
- `path.ts` — Pure-JS POSIX path helpers (browser-safe, no Node imports).
- `semver.ts` — Semver compare/parse for skill-version reconciliation.
- `index.ts` — Barrel: re-exports everything above plus pflow + codegen; `VERSION`.

### pflow IR layer (v2: visual compiler) — `pflow/`

- `schema.ts` — `PflowDocument` data model: nodes/wires/ports, `PortSchema` union, `NODE_KINDS` (input/output/agent/split/join/loop/verify/synthesize/branch/eval/mcp/script). Zod schemas (`PortZ` etc.).
- `tokens.ts` — Parse `{{in:NAME:TYPE}}` / `{{out:NAME:TYPE}}` prompt tokens; string/json/table typing (`parsePromptTokens`).
- `topo.ts` — Topological order + graph queries (`topoOrder`, `nodeById`, `inWires`, `outWires`).
- `regions.ts` — Detect loop / split-join / branch regions and membership (`analyzeRegions`).
- `validate.ts` — Document validation: schema compatibility, wiring, required ports, regions; `mcpLints()` (server-missing, tool-blocked, …) (`validatePflow`).
- `mcp-registry.ts` — MCP permission model: three-way tool groups (read/interactive/write), per-group defaults + `"default"` sentinel, grant resolution (`resolveToolPermission`, `applyGroupPermission`, `setToolPermission`).

### Codegen — `codegen/`

- `scriptgen.ts` — Compile a `PflowDocument` to an executable Claude Code workflow script; agent steps, wire/port variables, MCP subagents (`generateClaudeCodeWorkflow`, `buildWorkflowArtifacts`, `mcpSubagentMarkdown` → `.claude/agents/<wf>-<nodeId>.md` with `agentType: "wf-<nodeId>"`).
- `emit-kinds.ts` — Specialized emitters: verify, synthesize, loop/split-join/branch regions, eval quality gate.
- `emit-lint.ts` — Scan emitted code for banned tokens (`Date.now`, `Math.random`, `require`, `fetch`, `fs`) that break determinism (`lintEmittedScript`).

Determinism invariant: identical document + registry ⇒ byte-identical artifacts
(declared-order iteration, no clock/randomness).

## packages/mcp-server/src

- `server.ts` — MCP stdio server: `workflow_start/current/advance/status/context`, lint, export tools.
- `NodeFileSystem.ts` — `WorkflowFileSystem` over `node:fs`/`node:path`.
- `probe-cli.ts` — Standalone probe child process: lists a target MCP server's tools (JSON stdin → tools stdout); spawned because the renderer can't host the SDK.

## packages/obsidian-plugin

- `mcp-server.mjs` / `mcp-probe.mjs` — Bundled, SDK-inlined artifacts shipped inside the plugin folder (desktop-only).
- `esbuild.config.mjs` — Plugin bundle build; `scripts/gen-changelog.mjs` → `src/changelog.generated.ts`.

### src/

- `main.ts` — Plugin entry: registers `ResultsView` + `PflowEditorView`; commands (use-canvas-as-workflow, validate, apply-node-colors, set-node-type, insert-prompt-node, rebuild-workflow-skills, export-claude-code-workflow); wires ColorWatcher, node menu, MCP probing, skill sync.
- `settings.ts` — Settings tab incl. the MCP tab: server list, permission sub-screen (group defaults + per-tool icon controls), probe trigger, `GROUP_CUSTOM_SENTINEL`.

### src/commands/

- `convertToWorkflow.ts` — Stamp the workflow marker (idempotent).
- `validate.ts` — Run linter over a preloaded canvas.
- `autocolor.ts` — Recompute node colors from graph roles.
- `insertNode.ts` — Create node note + add file-node to canvas.
- `setNodeType.ts` — Set `node_type` frontmatter; `NODE_TYPE_OPTIONS`.
- `exportWorkflow.ts` — Export pflow doc → `.claude/workflows/<name>.js` + per-MCP-node `.claude/agents/*.md`; user feedback incl. connector suffix (`formatConnectorSuffix`).

### src/fs/

- `preload.ts` — Recursively read a canvas + all referenced files (nested canvases too) into a flat map.
- `ObsidianFileSystem.ts` — Synchronous FS over the preloaded map; buffers writes.
- `paths.ts` — Ancestor-dir computation for generated files.

### src/live/

- `colorWatcher.ts` — Debounced auto-color with marker gating + self-write suppression.
- `nodeMenu.ts` — Canvas right-click "Set node type" via internal canvas API hit-testing.

### src/mcp/

- `mcpJson.ts` — Parse `.mcp.json` server entries (`parseMcpJsonServers`).
- `nodeResolver.ts` — Locate a Node binary from the renderer (nvm/Homebrew/PATH; macOS minimal-PATH workaround).
- `probe.ts` — Spawn a server, list tools, classify groups (`McpProbe`/`NodeMcpProbe`, `ProbedTool`, `probedToolsToRegistry`). External `child_process`, NOT dynamic import — reuse this plumbing for any new MCP calls.
- `setupPrompt.ts` — Generate the "mirror my MCP servers into the vault's .mcp.json" agent prompt; classifies cloud/local/OAuth/plugin servers.

### src/skills/

- `WorkflowSkillSyncService.ts` — Orchestrates install: preload, plan, write skills + registry + CLAUDE.md pointer, bundled skills.
- `syncWorkflowSkills.ts` — Pure diff/plan of per-workflow skills (`planWorkflowSkills`).
- `reconcileGenericSkill.ts` — Version-compare write/skip decision, self-healing stamps.
- `claudePointer.ts` — Upsert the "Workflows:" pointer block in CLAUDE.md.
- `bundledSkills.ts` — Static bundled skills (install / overview / run).

### src/view & src/views/pflow-editor/

- `view/ResultsView.ts` — Lint-result side panel.
- `view.ts` — `PflowEditorView` Obsidian view hosting the Svelte editor.
- `editor.svelte` — Editor orchestration: load/validate doc, panes, UX.
- `canvas-pane.svelte` — Svelte Flow wrapper (move/select/connect/add/delete signals).
- `flow-map.ts` — `PflowDocument` ⇄ xyflow mapping; port derivation from prompts; wiring edits (`toFlowNodes`, `applyAddWire`, `COMPILABLE_KINDS`).
- `PflowNode.svelte` — Node card: ports (inputs left / outputs right), kind icon, wired-port dots.
- `PflowEdge.svelte` — Custom edge with horizontal "stick" (no collapsed curves).
- `inspector-pane.svelte` — Selected-node inspector: prompts, ports, MCP server binding, eval config.
- `prompt-field.svelte` — Contenteditable prompt editor with inline token highlighting, caret-preserving, XSS-safe.
- `flow-controls.svelte` — In-flow helper: background right-click add, node delete, keybindings.
- `eval-templates.ts` — Eval-node prompt templates (criteria/comparison/threshold) + port derivation.
- `kind-info.ts` — Per-kind icons/colors/titles shared by card + inspector.
- `confirm-modal.ts` — Yes/no modal.

## skills/ (vault-installed)

- `perspecta-install-workflow` — Install/update agent skills + MCP setup via plugin settings.
- `perspecta-workflow-overview` — Explains the system: marked canvases, node notes, discovery.
- `perspecta-workflow-run` — How to list/run workflows via the `workflow_*` MCP tools.

## Tests

Mirrored per package: `packages/*/test/**`. Notable patterns:

- `core/test/codegen/*` — golden + migration tests (`person-brief-migration.test.ts` is the stub-`agent` harness pattern to copy for new codegen tests).
- `core/test/pflow/*` — schema round-trips, validation, MCP registry/lints.
- `obsidian-plugin/test/*` — pure-helper tests (no Svelte rendering); `mcp-inspector-helpers.test.ts` is the pattern for inspector logic.
- `versionParity.test.ts` — manifest/package version lock.

## Build & deploy

- `npm test` — all Vitest suites. `npm run build` — all workspaces.
- Plugin typecheck reads `core/dist` — rebuild `@perspecta/core` first or typecheck is falsely clean.
- `npm run deploy -w perspecta-workflow-plugin` — build + copy to the dev vault (`scripts/deploy-dev.sh`, default `Perspecta-Dev`); user testing additionally happens in the "Intelligence Impact" vault.
