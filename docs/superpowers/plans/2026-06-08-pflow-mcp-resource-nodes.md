# pflow MCP Resource Nodes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a pflow workflow reach external MCP services — a vault-global server registry (whitelist + on-demand probe + per-tool permission), a first-class MCP node, and codegen that emits companion subagent grant files.

**Architecture:** Pure, testable core in `@perspecta/core` (schema kind, registry resolution, tool classifier, lints, codegen subagent emit) consumed by the Obsidian plugin (settings UI, node visual, inspector, export). The probe (the only impure/Node-bound part) sits behind an `McpProbe` interface. The MCP node lowers to an `agent()` call with `agentType` + a generated `.claude/agents/<wf>-<nodeId>.md`.

**Tech Stack:** TypeScript, Zod (schema), Vitest (tests), Svelte 5 runes (editor), `@modelcontextprotocol/sdk` client (probe, Node-only).

**Reference spec:** `docs/specs/2026-06-08-pflow-mcp-resource-nodes-design.md`

**Test runner:** from repo root, `npx vitest run packages/core/test` and `npx vitest run packages/obsidian-plugin/test`. Plugin typecheck: `npm run -w packages/obsidian-plugin typecheck`. Build: `npm run -w packages/obsidian-plugin build`.

**Deploy:** `cd packages/obsidian-plugin && bash scripts/deploy-dev.sh && PERSPECTA_VAULT_ROOT="/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact" bash scripts/deploy-dev.sh`

---

## File Structure

**New (core):** `pflow/mcp-registry.ts` (registry types + pure resolution/classifier), tests `pflow/mcp-registry.test.ts`, `pflow/mcp-lints.test.ts`, `codegen/mcp-node.test.ts`.
**New (plugin):** `mcp/probe.ts` (McpProbe interface + Node stdio impl + tool→registry map), `mcp/mcpJson.ts` (.mcp.json reader), tests `mcp-json.test.ts`, `mcp-probe.test.ts`.
**Modified (core):** `pflow/schema.ts` (+mcp kind), `pflow/validate.ts` (+mcpLints), `codegen/scriptgen.ts` (mcp emit + subagent + artifacts), `index.ts` (export).
**Modified (plugin):** `settings.ts` (+mcpRegistry + MCP tab), `main.ts` (listMcpServers/probeMcpServer), `views/pflow-editor/{kind-info,flow-map,PflowNode.svelte,inspector-pane.svelte,editor.svelte,view.ts}`, `commands/exportWorkflow.ts`.

---

## Phase A — Core: schema, registry model, classifier

### Task A1: Add the `mcp` node kind

**Files:** Modify `packages/core/src/pflow/schema.ts` (NODE_KINDS); Test `packages/core/test/pflow/schema.test.ts`.

- [ ] **Step 1: Failing test** — append to `schema.test.ts`: a test asserting `NODE_KINDS` contains `"mcp"` and that `parsePflow` accepts a node `{ kind: "mcp", config: { mcpServer: "figma", expectedGrants: { get_design: "allow" } } }` with token-derived in/out ports.
- [ ] **Step 2:** Run `npx vitest run packages/core/test/pflow/schema.test.ts -t "mcp node kind"` → FAIL.
- [ ] **Step 3:** Add `"mcp"` to `NODE_KINDS` (between `"branch"` and `"script"`). `config` already accepts arbitrary keys, so no other schema change.
- [ ] **Step 4:** Re-run → PASS.
- [ ] **Step 5:** `git add packages/core/src/pflow/schema.ts packages/core/test/pflow/schema.test.ts && git commit -m "feat(pflow): add mcp node kind"`

### Task A2: Registry types + tool classifier

**Files:** Create `packages/core/src/pflow/mcp-registry.ts`; Test `packages/core/test/pflow/mcp-registry.test.ts`; export from `index.ts`.

- [ ] **Step 1: Failing test** — `classifyToolGroup`: readOnlyHint→read; destructiveHint→write; get/list/search→read; create/update/delete→write; unknown verb→write.
- [ ] **Step 2:** run → FAIL (module missing).
- [ ] **Step 3:** Create `mcp-registry.ts` with types `McpToolPermission = "blocked"|"ask"|"allow"`, `McpToolGroup = "read"|"write"`, `McpToolAnnotations`, `McpRegistryTool {description?, group, groupSource, permission}`, `McpRegistryServer {whitelisted, probe:{status,error?,probedAt?}, tools}`, `McpRegistry = Record<string,…>`; and `classifyToolGroup(name, ann?)` (annotations → READ_VERBS/WRITE_VERBS regex → unknown→write).
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** add `export * from "./pflow/mcp-registry.js";` to `index.ts`.
- [ ] **Step 6:** commit "feat(pflow): MCP registry types + tool classifier".

### Task A3: Registry resolution + group bulk

- [ ] **Step 1: Failing test** — `resolveServerGrants(server)` partitions tools into sorted `allow/ask/blocked`; `applyGroupPermission(server, "write", "blocked")` blocks all write tools immutably, leaves read tools.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement `ServerGrants {allow,ask,blocked}`, `resolveServerGrants` (partition+sort), `applyGroupPermission` (immutable map over tools, set permission where `t.group===group`).
- [ ] **Step 4:** run → PASS. **Step 5:** commit "feat(pflow): registry grant resolution + group bulk-permission".

### Task A4: expectedGrants snapshot + stricter comparison

- [ ] **Step 1: Failing test** — `snapshotGrants(server)` → `{tool: permission}`; `isPolicyStricter(expected, localServer)` returns tool names whose local permission is strictly stricter (strength allow>ask>blocked; absent local = blocked); `[]` when equal/looser.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement both with `STRENGTH={allow:2,ask:1,blocked:0}`.
- [ ] **Step 4:** run → PASS. **Step 5:** commit "feat(pflow): expectedGrants snapshot + stricter-policy detection".

---

## Phase B — Core: lints

### Task B1: The four MCP lints

**Files:** Modify `packages/core/src/pflow/validate.ts`; Test `packages/core/test/pflow/mcp-lints.test.ts`. New pure fn `mcpLints(doc, registry)` (keeps `validatePflow` registry-free).

- [ ] **Step 1: Failing test** — `mcp-server-missing` (no config.mcpServer); `mcp-server-not-whitelisted` (server not in registry/not whitelisted); `mcp-server-cold` (whitelisted, status!=hot); `mcp-policy-stricter` (expectedGrants exceeds local); clean when whitelisted+hot+no stricter.
- [ ] **Step 2:** run `npx vitest run packages/core/test/pflow/mcp-lints.test.ts` → FAIL.
- [ ] **Step 3:** Implement `mcpLints(doc, registry): PflowError[]` per the spec; only `mcp-server-missing` is documented blocking (export gating handled in codegen). Import `isPolicyStricter`.
- [ ] **Step 4:** run → PASS. **Step 5:** commit "feat(pflow): four MCP node lints".

---

## Phase C — Core: codegen

### Task C1: Subagent frontmatter generator (pure)

**Files:** Modify `scriptgen.ts`; Test `codegen/mcp-node.test.ts`.

- [ ] **Step 1: Failing test** — `mcpSubagentMarkdown(name, server, serverReg, description)` emits frontmatter with `name`, `mcpServers: [- server]`, `allowedTools` listing `mcp__<server>__<allowTool>`, `disallowedTools` listing blocked tools as `mcp__<server>__<tool>`, and NO allowedTools entry for ask tools; deterministic.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Import `McpRegistryServer`/`resolveServerGrants` into scriptgen; implement `mcpToolId(server,tool)=`mcp__${server}__${tool}`` and `mcpSubagentMarkdown` building YAML frontmatter + a short body. `allow`→allowedTools, `blocked`→disallowedTools, `ask`→neither.
- [ ] **Step 4:** run → PASS. **Step 5:** commit "feat(codegen): MCP subagent .md generator".

### Task C2: mcp node → agent call with agentType

**Files:** Modify `scriptgen.ts` (`emitNode`, `buildAgentCall`); Test `codegen/mcp-node.test.ts`.

- [ ] **Step 1: Failing test** — a doc with an `mcp` node (config.mcpServer:"figma") compiled by `generateClaudeCodeWorkflow` contains `agentType: "wf-fig"` and `await agent(`. A SECOND test runs the emitted body with a stub `agent` using the SAME emitted-code harness as `packages/core/test/codegen/person-brief-migration.test.ts` (compile the workflow body and execute it with a stub agent), asserting it resolves to the stub's value without a ReferenceError.
- [ ] **Step 2:** run `npx vitest run packages/core/test/codegen/mcp-node.test.ts -t "mcp node codegen"` → FAIL.
- [ ] **Step 3:** (a) Add optional `agentType?` param to `buildAgentCall`; compute `opts = agentType ? `{ label: ${label}, agentType: ${jsString(agentType)} }` : `{ label: ${label} }`` and replace BOTH `{ label: ${label} }` return sites with `${opts}`. (b) Add `mcpAgentTypeName(doc,node) = `${doc.workflow.name}-${node.id}`` sanitized to `[A-Za-z0-9_-]`. (c) Add `case "mcp"` in `emitNode`: `const v = varName(...); return `  const ${v} = ${buildAgentCall(doc, node, undefined, undefined, mcpAgentTypeName(doc,node))};``.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** run full `npx vitest run packages/core/test` → PASS (golden/migration byte-identical: agentType undefined for non-mcp ⇒ unchanged output).
- [ ] **Step 6:** commit "feat(codegen): mcp node lowers to agent() with agentType".

### Task C3: Multi-artifact builder (pure)

- [ ] **Step 1: Failing test** — `buildWorkflowArtifacts(doc, registry)` returns `{workflowJs, subagents:[{path,content}]}`: js contains `export const meta`; one subagent per mcp node at `.claude/agents/wf-fig.md` containing `mcp__figma__get_design`; zero subagents for a doc with no mcp nodes.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement `WorkflowArtifacts` + `buildWorkflowArtifacts`: `generateClaudeCodeWorkflow(doc)` for js; per mcp node with a server, `mcpSubagentMarkdown(mcpAgentTypeName, server, registry[server] ?? coldStub, node.label||node.id)` → `{path: `.claude/agents/${name}.md`, content}`. Import `McpRegistry`.
- [ ] **Step 4:** run → PASS. **Step 5:** commit "feat(codegen): buildWorkflowArtifacts — js + subagent files".

---

## Phase D — Plugin: .mcp.json reader + probe

### Task D1: .mcp.json reader

**Files:** Create `packages/obsidian-plugin/src/mcp/mcpJson.ts`; Test `packages/obsidian-plugin/test/mcp-json.test.ts`.

- [ ] **Step 1: Failing test** — `parseMcpJsonServers(text)` lists `{name, transport, command, args, env, url}` from `mcpServers`; returns `[]` for ""/"{}"/"not json".
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement `McpJsonServer` interface + `parseMcpJsonServers` (try/catch JSON.parse → [] on failure; infer transport from `type` or command/url).
- [ ] **Step 4:** run → PASS. **Step 5:** commit "feat(plugin): parse .mcp.json server list".

### Task D2: McpProbe interface + Node stdio impl + tool→registry map

**Files:** Create `packages/obsidian-plugin/src/mcp/probe.ts`; Test `packages/obsidian-plugin/test/mcp-probe.test.ts`. **Host decision (locked at plan time): in-plugin via Electron Node, SDK marked external.** Interface stays host-agnostic.

- [ ] **Step 1: Failing test** — `probedToolsToRegistry(tools)` maps each `{name, description, annotations}` to `{group (classified), groupSource: annotation|heuristic, permission:"ask"}`. (Does NOT call the live transport.)
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement `ProbedTool`, `McpProbe {probe(server):Promise<ProbedTool[]>}`, `probedToolsToRegistry` (uses `classifyToolGroup`; groupSource=annotation iff a hint decided it; permission default "ask"), and `NodeMcpProbe` using dynamic `import("@modelcontextprotocol/sdk/client/index.js")` + `.../client/stdio.js`, `connect`→`listTools`→map→`close`. stdio only; reject others with a clear error.
- [ ] **Step 4:** run → PASS (dynamic import only reached by NodeMcpProbe.probe, not unit-tested).
- [ ] **Step 5:** Add `"@modelcontextprotocol/sdk": "^1.29.0"` to plugin `dependencies`; add it to esbuild `external`; `npm install`.
- [ ] **Step 6:** `npm run -w packages/obsidian-plugin build` → PASS.
- [ ] **Step 7:** commit "feat(plugin): McpProbe + Node stdio probe + tool→registry map".

---

## Phase E — Plugin: settings registry

### Task E1: mcpRegistry in settings

**Files:** Modify `packages/obsidian-plugin/src/settings.ts`.

- [ ] **Step 1:** Add `mcpRegistry: McpRegistry` to `PerspectaSettings` (import type from `@perspecta/core`) and `mcpRegistry: {}` to `DEFAULT_SETTINGS`.
- [ ] **Step 2:** `npm run -w packages/obsidian-plugin typecheck` → PASS.
- [ ] **Step 3:** commit "feat(plugin): add mcpRegistry to settings".

### Task E2: MCP settings tab (whitelist, probe, per-tool permission)

**Files:** Modify `settings.ts` (tab), `main.ts` (`listMcpServers`, `probeMcpServer`). UI-heavy; verified by build + manual reload.

- [ ] **Step 1:** In `main.ts` add `listMcpServers()` (read `.mcp.json` via adapter → `parseMcpJsonServers`) and `probeMcpServer(name)` (set status probing→save; `new NodeMcpProbe().probe`→`probedToolsToRegistry`→hot, else failed+error; save; Notice). `new Date().toISOString()` is fine here (plugin runtime, not a workflow script).
- [ ] **Step 2:** Add an MCP tab in `settings.ts display()` rendering each `.mcp.json` server with a whitelist toggle (on→`probeMcpServer`, off→delete registry entry), probe status, and for hot servers a Read group + Write group, each tool with a Blocked/Ask/Always dropdown writing `mcpRegistry[server].tools[tool].permission` then save, plus a group-level "Set all/Block all" calling `applyGroupPermission`. Match the existing `Setting`/`renderSettingsShell` idiom; pre-load `listMcpServers()` for the async render.
- [ ] **Step 3:** `npm run -w packages/obsidian-plugin typecheck && npm run -w packages/obsidian-plugin build` → PASS.
- [ ] **Step 4: Manual** — deploy+reload; Settings→MCP lists `.mcp.json` servers; whitelisting `perspecta-workflow` (stdio, present in dev vault) probes→hot with tools grouped + dropdowns.
- [ ] **Step 5:** commit "feat(plugin): MCP settings tab — whitelist, probe, per-tool permission".

---

## Phase F — Plugin: the MCP node in the editor

### Task F1: KIND_INFO + PROMPT_KINDS + default ports

**Files:** Modify `kind-info.ts`, `flow-map.ts`.

- [ ] **Step 1:** Add `KIND_INFO.mcp` with a DISTINCT color (blue, not agent purple), a plug/connector icon, title "MCP Connector", description "Reaches an external service (an MCP server) and returns its result."
- [ ] **Step 2:** Add `"mcp"` to `PROMPT_KINDS`.
- [ ] **Step 3:** Ensure `defaultPortsForKind("mcp")` yields one in + one out (read the fn; add `mcp` to the default if it switches on kind).
- [ ] **Step 4:** `typecheck && build` → PASS (KIND_INFO is `Record<NodeKind,…>`, so omitting mcp would have failed typecheck).
- [ ] **Step 5:** commit "feat(pflow-editor): mcp node visual identity + prompt-kind + default ports".

### Task F2: Card shows the bound service prominently

**Files:** Modify `PflowNode.svelte`, `flow-map.ts`.

- [ ] **Step 1:** In `flow-map.ts` add `mcpServer?: string` to `FlowNodeData` and set `mcpServer: n.config?.mcpServer` in `toFlowNodes`. In `PflowNode.svelte`, for `data.kind === "mcp"` render a prominent service sub-label ("↗ {server}" or "no service" in a warning color).
- [ ] **Step 2:** `build` → PASS.
- [ ] **Step 3: Manual** — add an MCP Connector node; distinct color/icon; shows "no service".
- [ ] **Step 4:** commit "feat(pflow-editor): mcp node card shows bound service".

### Task F3: Inspector Mode A — service picker + grant summary + warnings

**Files:** Modify `inspector-pane.svelte`, `editor.svelte`, `view.ts`, `flow-map.ts`.

- [ ] **Step 1:** In `flow-map.ts` add `applyMcpServer(doc, nodeId, server)` (immutable set `config.mcpServer`) and `grantSummary(registry, server)` (uses `resolveServerGrants`; "N tools — a always · b ask · c blocked", or status/error/"not whitelisted").
- [ ] **Step 2:** Thread `registry` + `onMcpServer(nodeId, server)` from `view.ts` (reads plugin settings) → `editor.svelte` → `InspectorPane`.
- [ ] **Step 3:** In `inspector-pane.svelte`, when `node.data.kind === "mcp"`, render a Service `<select>` (hot servers) ABOVE Name/Prompt/Ports, the `grantSummary` line, and any `mcpLints` warnings for this node.
- [ ] **Step 4:** `typecheck && build` → PASS.
- [ ] **Step 5: Manual** — select mcp node; pick service; card + summary update; unavailable service warns.
- [ ] **Step 6:** commit "feat(pflow-editor): mcp inspector — service picker + grant summary + warnings".

---

## Phase G — Plugin: resource summary + multi-artifact export

### Task G1: Workflow-level External Resources summary (Mode B)

**Files:** Modify `mcp-registry.ts` (pure roll-up), `inspector-pane.svelte`, `editor.svelte`; Test `mcp-registry.test.ts`.

- [ ] **Step 1: Failing test** — `summarizeWorkflowResources(doc, registry)`: per distinct mcp server, `{server, nodeCount, available, allow, ask, blocked}`; `allMet` false when any service unavailable.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** Implement `ResourceServiceSummary`, `WorkflowResourceSummary`, `summarizeWorkflowResources` (count mcp nodes per server; available = whitelisted+hot; grants via `resolveServerGrants`). Import `PflowDocument` type.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** Render an "External Resources" section in Mode B (before Export): per-service line + a not-met warning. Compute `summarizeWorkflowResources(doc, registry)` in `editor.svelte`, pass to inspector.
- [ ] **Step 6:** `typecheck && build` → PASS.
- [ ] **Step 7:** commit "feat(pflow-editor): workflow External Resources summary (Mode B)".

### Task G2: Multi-artifact export + expectedGrants stamp

**Files:** Modify `commands/exportWorkflow.ts`, `view.ts`, `main.ts`, `flow-map.ts`; Test `export-workflow.test.ts`.

- [ ] **Step 1: Failing test** — `exportClaudeCodeWorkflowFile(adapter, mcpDoc, registry)` writes `.claude/workflows/wf.js` AND `.claude/agents/wf-fig.md` (containing `mcp__figma__get_design`); returns `{workflowPath, subagentPaths}` including the agent path. (Reuse the file's `fakeAdapter`.)
- [ ] **Step 2:** run → FAIL (signature/return differ).
- [ ] **Step 3:** Rewrite `exportClaudeCodeWorkflowFile` to take `registry`, use `buildWorkflowArtifacts`, mkdir `.claude/agents` when needed, write js + each subagent, return `{workflowPath, subagentPaths}` (`ExportResult`).
- [ ] **Step 4:** Update callers: `main.ts` `exportClaudeCodeWorkflow` and `view.ts` `onExport` pass `mcpRegistry` and use the result for the Notice ("Exported X + N connector agents"). Update the existing export test to pass `{}` and read `.workflowPath`.
- [ ] **Step 5:** run `npx vitest run packages/obsidian-plugin/test/export-workflow.test.ts` → PASS.
- [ ] **Step 6:** Add `applyMcpExpectedGrants(doc, registry)` to `flow-map.ts` (stamp each mcp node's `config.expectedGrants = snapshotGrants(registry[server])` when hot, immutable). Wire `onExport` to stamp the doc then `requestSave` (export writes the .pflow too; idempotent when registry unchanged).
- [ ] **Step 7:** `npx vitest run packages/obsidian-plugin/test && npm run -w packages/obsidian-plugin typecheck && npm run -w packages/obsidian-plugin build` → PASS.
- [ ] **Step 8:** commit "feat(plugin): multi-artifact export — subagent files + expectedGrants stamp".

---

## Phase H — End-to-end verification

### Task H1: Suites, build, deploy, smoke

- [ ] **Step 1:** `npx vitest run packages/core/test` → PASS (golden/migration byte-identical).
- [ ] **Step 2:** `npx vitest run packages/obsidian-plugin/test` → PASS.
- [ ] **Step 3:** `typecheck && build`; then NUL-byte scan over changed sources — only `codegen/scriptgen.ts` (intentional token sentinel) may contain NULs; no NEW file may.
- [ ] **Step 4:** Deploy to both vaults; verify `main.js` identical build↔vault.
- [ ] **Step 5: Manual smoke (whole loop)** — Intelligence Impact vault: Settings→MCP→whitelist `perspecta-workflow` (→hot). Open a `.pflow`, add an MCP Connector, bind `perspecta-workflow`, small prompt. Deselect → External Resources shows met. Export → `.claude/workflows/<name>.js` has `agentType`; `.claude/agents/<wf>-<node>.md` exists with correct `mcpServers`/`allowedTools`; the `.pflow` now carries `expectedGrants`.

---

## Self-Review

**Spec coverage:** registry model A2–A4 / settings E1–E2 / probe D1–D2; cold→hot D2+E2; per-tool Blocked/Ask/Always + read/write group + bulk A2/A3/E2; mcp node + IR A1/F1–F3; distinct visual F1–F2; inspector picker+summary+warning F3; four lints B1; codegen agentType+subagent+artifacts C1–C3/G2; import warning A4/B1/G2; resource summary G1; export feedback G2; McpProbe interface + chosen impl D2. All covered.

**Placeholder scan:** No TBD/TODO; pure-core steps carry concrete code in the spec/this plan. The two UI-heavy tasks (E2, F-series) give code direction + "match existing idiom" + a manual verification step, since exact Obsidian `Setting`/Svelte rendering is dictated by surrounding code.

**Type consistency:** `McpRegistry`/`McpRegistryServer`/`McpRegistryTool`/`McpToolPermission`/`McpToolGroup`/`ServerGrants`/`ProbedTool`/`WorkflowArtifacts`/`ExportResult` defined once and reused; fns `classifyToolGroup`/`resolveServerGrants`/`applyGroupPermission`/`snapshotGrants`/`isPolicyStricter`/`mcpLints`/`mcpSubagentMarkdown`/`mcpAgentTypeName`/`buildWorkflowArtifacts`/`probedToolsToRegistry`/`parseMcpJsonServers`/`summarizeWorkflowResources`/`applyMcpServer`/`applyMcpExpectedGrants`/`grantSummary` named consistently. `exportClaudeCodeWorkflowFile` signature change propagated to all callers (G2 step 4).

**Out of scope (noted):** http/sse/ws probe (stdio only in v1); insert-function-call helper; eval node; IR interpreter.
