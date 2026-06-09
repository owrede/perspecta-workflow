# Implementation Plan — pflow Memory (vault-memory contract) Node

**Date:** 2026-06-09
**Design:** [`docs/specs/2026-06-09-pflow-memory-contract-node-design.md`](../specs/2026-06-09-pflow-memory-contract-node-design.md)
**Builds on the landed MCP-node infrastructure** (registry, probe, settings UI,
lints, subagent codegen).

## Pick-up summary (read this first if resuming cold)

The MCP node feature is **already implemented** in the repo: `mcp` is a
`NODE_KIND`; `packages/core/src/pflow/mcp-registry.ts` holds the registry +
grant resolution; `packages/core/src/pflow/validate.ts` `mcpLints()` has the four
MCP lints; codegen lives in `packages/core/src/codegen/scriptgen.ts`
(`mcpSubagentMarkdown`, `generateClaudeCodeWorkflow`, `buildWorkflowArtifacts`,
emitting `agentType: "wf-<nodeId>"` + one `.claude/agents/<wf>-<nodeId>.md`); the
plugin has `src/mcp/probe.ts` (`McpProbe` / `ProbedTool` / `probedToolsToRegistry`),
the settings MCP tab, and the editor (`views/pflow-editor/PflowNode.svelte`,
`inspector-pane.svelte`, `flow-map.ts`).

This plan **extends** that machinery with a **contract mode** that activates when
an `mcp` node's bound server is `vault-memory` AND a contract is selected. We add
NO new node kind. We reuse `mcpSubagentMarkdown` and the export path verbatim; the
only codegen change is the **agent step body** in contract mode (a deterministic
pre-bound `vm_<contract>` call) and **output-port projection**.

Run the test suite with `npm test` (vitest, see `vitest.config.ts`). Branch off
`main` as `feat/pflow-memory-contract-node`.

## Decisions locked by the design (do not re-litigate)

1. Specialization of the `mcp` node (not a new kind).
2. Deterministic typed call (not prompt-driven).
3. All contract inputs become ports; each wired-or-pinned.
4. Discovery via probe: vault-memory's `vm_*` tools ARE the contracts.
5. Output ports derived from `output_shape` (top-level + 1-level projection;
   `bundle` fallback).

## Parallelization

- **Core (Phase 1–3)** is pure TS, independently testable, and is the critical
  path. Do it first.
- **Plugin probe/describe adapter (Phase 4)** and **editor UI (Phase 5)** depend
  on Phase 1–3 types but are independent of each other — can be done in either
  order or in parallel by two people.
- **Export wiring (Phase 6)** depends on Phase 3 codegen.

---

## Phase 1 — Core types & contract snapshot (schema)

**File:** `packages/core/src/pflow/contract.ts` (new), re-exported from `index.ts`.

1. Define the contract snapshot + projection types:
   ```ts
   export interface ContractInputDef { name: string; schema: PortSchema; required: boolean; }
   export interface ContractSnapshot {
     inputs: ContractInputDef[];          // from describe_contract input JSON Schema
     outputs: ContractOutputDef[];        // from output_shape (Phase 2)
     writesTo: string[];                  // sink summary for the badge
     describedAt?: string;
   }
   export interface ContractOutputDef { name: string; schema: PortSchema; projection: string; }
   //  projection: dotted access path off the bundle, e.g. "steps" or "write_back.doc_id"
   ```
2. `jsonSchemaToPortSchema(js: unknown): PortSchema` — map a vault-memory input
   JSON Schema property to the existing `PortSchema` union (`string`/`number`/
   `boolean`/`array{items}`/`object{properties}`; unknown → `{type:"any"}`).
   **Pure.** This is the bridge between vault-memory's JSON Schema and pflow's
   `PortSchema` (`schema.ts`).
3. `parseContractInputs(inputSchema, required): ContractInputDef[]` — top-level
   properties → input defs; `required` array → the `required` flag.

**Tests** (`packages/core/test/pflow/contract.test.ts`):
- `jsonSchemaToPortSchema`: scalars, `array{items:string}`, nested object,
  unknown→any.
- `parseContractInputs`: `meeting-prep`-shaped schema → 3 inputs, `required`
  honored (use a literal fixture mirroring the real `vm_meeting_prep` inputSchema:
  `vault`, `meeting_path`, `context_doc_ids:string[]`, all required).

---

## Phase 2 — output_shape → output ports

**File:** `packages/core/src/pflow/contract.ts` (same module).

1. `parseContractOutputs(outputShape: unknown): ContractOutputDef[]`:
   - Top-level properties of `output_shape` → one output def each
     (`projection` = the property name; schema via `jsonSchemaToPortSchema`).
   - **One level of nested projection** for object-typed top-level props: emit a
     child def per nested leaf with `projection = "<top>.<leaf>"` and a flattened
     port name (prefer the leaf name; if it collides, use `<top>_<leaf>`).
     The design calls out `write_back.doc_id → doc_id` specifically — make that
     case produce a `doc_id` port.
   - Absent / non-object / empty `output_shape` → a single
     `{ name: "bundle", schema: {type:"any"}, projection: "" }` (empty projection
     = the whole bundle).
2. Keep it **deterministic**: iterate object keys in declared order; do not sort
   (matches `scriptgen` determinism via declared order).

**Tests:**
- `meeting-prep` output_shape (`{steps:{...compiled:{ok,doc_id}}}`) → a `steps`
  port (object) — and verify the documented `write_back.doc_id → doc_id` case
  with a `code-review-brief`-shaped fixture (`output_shape` has
  `write_back.doc_id`).
- opaque/missing output_shape → single `bundle` port.
- name-collision flattening is deterministic.

---

## Phase 3 — Codegen: contract-mode agent step + projections

**File:** `packages/core/src/codegen/scriptgen.ts` (extend; do NOT fork the MCP path).

The node is still an `mcp` node, so `buildWorkflowArtifacts` already emits the
`agentType` step + calls `mcpSubagentMarkdown`. Branch the **step body** on
contract mode:

1. **Detect contract mode:** `node.config?.mcpServer === "vault-memory" &&
   typeof node.config?.contract === "string"`.
2. **Resolve args object** from the node's inputs:
   - For each input port: if wired, use the upstream binding expression the
     existing agent emitter already computes for `{{in:}}` tokens; if pinned
     (`config.contractInputs[name]` present), use that literal.
   - Build a single args object keyed by contract-input name.
3. **Emit the deterministic call** (replaces the free-text prompt for this node):
   ```js
   const <var> = await agent(
     `Call the MCP tool \`vm_<contract>\` with EXACTLY these arguments and ` +
     `return its JSON result verbatim, with no commentary:\n` +
     "```json\n" + <stableJson(args)> + "\n```",
     { label: "<label>", agentType: "<wf>-<nodeId>" }
   );
   ```
   - `<stableJson>` = `JSON.stringify(args, Object.keys(args).sort(), 2)` so
     output is **byte-identical** across runs (determinism invariant).
   - Wired values must be interpolated as **code expressions** (the upstream
     binding var), not JSON-stringified strings — reuse the same interpolation the
     agent emitter uses for woven context. Pinned literals are JSON literals.
4. **Output projections:** when a downstream wire reads an output port whose
   `ContractOutputDef.projection` is set, compile the reference to
   `<var>` + optional-chained projection (e.g. `<var>?.write_back?.doc_id`); empty
   projection → `<var>`. The output-port→projection map comes from the node's
   stored `contractSnapshot.outputs` (Phase 5 stamps it into `config`); if absent
   (hand-authored), fall back to a single `bundle`=`<var>`.
5. **Subagent grant:** `mcpSubagentMarkdown` is reused unchanged — vault-memory's
   grants resolve from the registry exactly like any server. (The contract's
   internal MemorySink writes are not MCP tools, so nothing extra to grant; the
   `vm_<contract>` tool itself is the grant that matters.)

**Tests** (`packages/core/test/codegen/memory-contract-node.test.ts`):
- An `mcp` node with `config.mcpServer:"vault-memory"`, `config.contract:"meeting_prep"`,
  one pinned input (`vault:"inim"`) + two wired inputs → emits the deterministic
  `vm_meeting_prep` call with **sorted-key** JSON args; `agentType: "wf-<id>"`.
- Byte-identical across two emissions.
- Passes `emit-lint` (no banned tokens).
- A downstream node wired to a `doc_id` projection port compiles to
  `...?.write_back?.doc_id`.
- A non-vault-memory `mcp` node is UNAFFECTED (still the existing prompt-driven
  emit) — guard against regression.
- Runs under the established stub-`agent` harness (copy the pattern from
  `packages/core/test/codegen/person-brief-migration.test.ts`, as
  `mcp-node.test.ts` does).

---

## Phase 4 — Plugin: describe_contract adapter + contract discovery

**Files:** `packages/obsidian-plugin/src/mcp/probe.ts` (extend) and a new
`packages/obsidian-plugin/src/mcp/describeContract.ts`.

1. **Contract discovery from probe results:** add a pure helper (in core or the
   plugin per where `ProbedTool` filtering best fits — `ProbedTool` lives in the
   plugin, so put it here):
   ```ts
   export function contractsFromProbe(tools: ProbedTool[]): string[]
   //  filter name.startsWith("vm_") → strip prefix → sorted unique
   ```
2. **describe_contract adapter** — host-agnostic, mirroring `McpProbe`:
   ```ts
   export interface ContractDescriber {
     describe(server: McpJsonServer, contract: string): Promise<RawContractDescription>;
   }
   ```
   The concrete impl calls vault-memory's `describe_contract` MCP tool via the
   same transport `probe.ts` already uses (reuse its spawn/handshake; factor the
   shared MCP-call plumbing if it isn't already a helper). Returns the raw input
   JSON Schema + `output_shape` + Sinks/write_back summary.
3. **Snapshot builder:** `toContractSnapshot(raw): ContractSnapshot` using the
   Phase 1–2 core parsers (`parseContractInputs`, `parseContractOutputs`, plus the
   `writesTo` sink summary).

**Tests** (`packages/obsidian-plugin/test/contract-discovery.test.ts`):
- `contractsFromProbe`: `vm_*` filtered, prefix stripped, sorted; non-`vm_` tools
  dropped.
- `toContractSnapshot` against a captured real `describe_contract` JSON fixture
  for `meeting_prep` (capture once via the live tool; commit as a fixture).
- Adapter uses a **fake** describer in unit tests; a live describe is a smoke test
  alongside whichever host runs the live probe (same stance as the probe tests).

---

## Phase 5 — Editor: contract-mode inspector + card

**Files:** `packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte`,
`PflowNode.svelte`, and helpers (mirror `mcp-inspector-helpers.test.ts`).

1. **Contract picker:** in the inspector, when the selected `mcp` node's server is
   `vault-memory`, render a **Contract** dropdown populated from
   `contractsFromProbe(registry["vault-memory"] probe tools)`. (If vault-memory is
   cold, show the existing cold hint + a Probe action — reuse the MCP-tab path.)
2. **On select:** call the `ContractDescriber`, build the snapshot, and **stamp**
   `config.contract`, `config.contractSnapshot` into the node. Regenerate ports:
   - input ports = `snapshot.inputs` (typed; `required` flag carried);
   - output ports = `snapshot.outputs` (carry the `projection` on the `Port` —
     add an optional `projection?: string` to `PortZ` in `schema.ts`, Phase 1
     adjacent; it round-trips and is read by Phase 3 codegen).
3. **Per-input wire/pin control:** for each input port, a control to either leave
   it wired or pin a literal into `config.contractInputs[name]` (typed editor per
   `PortSchema`: text for string, number, list for array). This mirrors the
   existing typed-input editing; factor a small helper and unit-test it like
   `mcp-inspector-helpers.test.ts`.
4. **Write-back badge:** render `snapshot.writesTo` as a read-only inspector line
   and a small card badge ("✎ writes → …") in `PflowNode.svelte`.
5. **Card visual:** in contract mode show the 🧠 icon/accent and the contract name
   prominently (distinct from the generic MCP plug). Keep it a visual branch of the
   existing `mcp` card — same node kind.

**Tests** (`packages/obsidian-plugin/test/contract-inspector-helpers.test.ts`):
- snapshot → input/output port arrays (pure helper, no Svelte).
- pin/unpin updates `config.contractInputs` immutably; typed literal coercion.
- the `projection` survives a `parsePflow`→serialize round-trip (add a case to
  `schema.test.ts` for `PortZ.projection`).

---

## Phase 6 — Lints + export feedback

**Files:** `packages/core/src/pflow/validate.ts` (`mcpLints` — extend),
`packages/obsidian-plugin/src/commands/exportWorkflow.ts` (feedback string).

1. **Add three memory lints** inside `mcpLints` (gated on contract mode so generic
   MCP nodes are unaffected):
   - `memory-contract-missing` — server is `vault-memory`, no `config.contract`.
     **Blocking** (push as an error that blocks export, like `mcp-server-missing`).
   - `memory-input-unbound` — a `required` contract input (from
     `config.contractSnapshot.inputs`) is neither wired (no incoming wire to its
     port) nor pinned (`config.contractInputs[name]` absent). **Blocking.**
   - `memory-contract-stale` — the live registry's vault-memory `vm_*` set no
     longer lists `config.contract`, or the live input schema differs from the
     snapshot. **Non-blocking**, informational. (Needs the live registry, which
     `mcpLints` already receives — compare against probe tools.)
2. **Export feedback:** extend the connector-suffix/feedback path to name a
   missing/stale contract, e.g. "⚠ 1 node: contract `meeting-prep` not found in
   this vault's vault-memory registry." (`formatConnectorSuffix` is the existing
   hook point.)

**Tests** (`packages/core/test/pflow/memory-lints.test.ts`,
`packages/obsidian-plugin/test/export-workflow.test.ts`):
- each lint fires only on its condition; blocking vs non-blocking respected.
- a fully-bound contract node produces zero memory lints and exports.
- export feedback mentions a stale/missing contract.

---

## Verification (definition of done)

1. `npm test` green; new tests cover Phases 1–6.
2. Build the plugin (`npm run build` or the repo's plugin build script) with no
   type errors; `styles.css` regenerated if the card/inspector added rules.
3. Manual smoke in the INIM-VM-TEST vault (real contracts exist there:
   `meeting-prep`, `project-status`, `code-review-brief`):
   - whitelist + probe `vault-memory`; add an `mcp` node; pick `vault-memory`;
     the Contract dropdown lists the three; select `meeting-prep`;
   - input ports `vault` / `meeting_path` / `context_doc_ids` appear; pin `vault`,
     wire the other two; output ports appear from `output_shape`; the write-back
     badge shows the sink;
   - Export writes `.claude/workflows/<wf>.js` with the deterministic
     `vm_meeting_prep` call + one `.claude/agents/<wf>-<node>.md` granting
     vault-memory.
4. Re-export with an unchanged registry is idempotent (byte-identical artifacts).

## Risk notes

- **describe_contract transport:** `probe.ts` spawns the server in Electron's
  renderer via external `child_process` (see its header comment). The contract
  describer must reuse that exact plumbing, not a dynamic `import`. Factor the
  shared MCP-call helper before adding the describer if it isn't already shared.
- **Per-vault contracts:** the active vault must be the one whose `_contracts/`
  holds the contract. The probe/registry is keyed by the `.mcp.json` `vault-memory`
  entry; confirm `VAULT_MEMORY_ACTIVE_VAULT` (the vault root `.mcp.json` sets
  `inim`) matches where the target contracts live, or the dropdown will list a
  different vault's contracts. Surface this in the stale lint, don't silently
  mismatch.
- **output_shape variety:** real contracts vary; the `bundle` fallback guarantees a
  usable port even when `output_shape` is opaque. Deep (>1 level) projection is
  explicitly out of scope — do not attempt array projection here.
