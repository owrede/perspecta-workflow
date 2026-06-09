# pflow Memory (vault-memory contract) Node — Design

> **Status:** approved design (2026-06-09). Implementation plan:
> [`docs/plans/2026-06-09-pflow-memory-contract-node.md`](../plans/2026-06-09-pflow-memory-contract-node.md).
> **Builds on:** [`2026-06-08-pflow-mcp-resource-nodes-design.md`](2026-06-08-pflow-mcp-resource-nodes-design.md)
> (the MCP node, settings registry, probe, grant export — all inherited).
> **Scope:** ONE feature — let a workflow node instantiate a **vault-memory
> contract** as a deterministic, typed call, with a contract picker, typed input
> ports, output ports derived from the contract's `output_shape`, and codegen
> that emits a single-purpose connector subagent. Out of scope: a generic
> non-vault-memory parameterized-tool node; authoring/editing contracts from
> pflow; runtime execution of generated workflows.

## North star

perspecta-workflow VISUALIZES agent workflows. A **Memory node** says, on the
canvas: *"instantiate this named memory recipe with these inputs, get a
structured result back — and note that it may write a memory into the vault."*
It is loud and distinct (🧠 icon, own accent), but it lowers through the same
agent + companion-subagent machinery the MCP node already established.

## What a vault-memory contract is (analyzed 2026-06-08)

A **contract** is a declarative, parameterized memory-assembly pipeline stored
as `_contracts/<name>.yaml` (or `.contract` with editor state). Shape:

- **`inputs` + `required`** — a typed input schema. vault-memory turns this into
  a Zod schema with `additionalProperties:false` (typos rejected).
- **`sources`** — read handles (vault filesystems); resolvable/overridable.
- **`sinks`** — write targets, **MemorySink-only** (the un-bypassable MEM-05
  invariant). A contract's write goes through this chokepoint, NOT through MCP
  tools the pflow registry can block.
- **`assembly`** — ordered steps `{as:<binding>, verb:<vm-verb>, args}` with
  `{{template}}` resolution and named-binding accumulation (`__ref_x:{{prior}}`).
- **`write_back`** — optional delivery through the DeliveryAdapter. Many
  contracts (e.g. `meeting-prep`) write the product themselves inside `assembly`
  and return only `{ok, doc_id}` — no body.
- **`output_shape`** — JSON Schema of the returned bundle `{steps, write_back}`.

Exposed three ways over MCP:

1. `describe_contract(name [,vault])` — **pure**; returns the input JSON Schema +
   a markdown summary (Inputs / Sources / Sinks / Assembly / write_back /
   Output Shape). Does not execute.
2. `instantiate_contract(name, inputs, …)` — executes end-to-end; Zod-validates
   inputs; returns the `{steps, write_back}` bundle or a sealed `InstantiateError`.
3. `register_contracts_as_tools` — registers each contract as a dynamic MCP tool
   `vm_<name>` whose `inputSchema` is the contract's `inputs`. **Per-vault**:
   contracts live in a specific vault's `_contracts/`, and the registry tracks
   them per configured vault.

**Key consequence for pflow:** instantiating a contract is a *deterministic,
typed* single MCP call (`vm_<name>`), unlike a generic MCP node where the agent
freely decides which tools to call. The Memory node preserves that determinism
at the workflow boundary.

## Decisions (from brainstorming Q&A, 2026-06-09)

1. **Node identity — specialization of the MCP node.** `kind:"mcp"`,
   `config.mcpServer:"vault-memory"`, plus new `config.contract`. When server ==
   vault-memory AND a contract is selected → **contract mode** rendering +
   codegen. Inherits registry / probe / whitelist / grant export unchanged.
2. **Execution model — deterministic typed call.** Codegen emits a
   single-purpose connector agent whose only job is to call `vm_<contract>` with
   the exact pre-bound inputs and return the JSON bundle verbatim. Not the
   free-text prompt-driven MCP path.
3. **Input ports — all inputs are ports; each wired-or-pinned.** Every contract
   input becomes an input port. Per port: wire from upstream OR pin a literal in
   `config.contractInputs`. Required-but-unbound → blocking lint.
4. **Discovery — probe vault-memory, its `vm_*` tools ARE the contracts.**
   Reuse the existing MCP probe (`tools/list`). Selecting a contract triggers one
   `describe_contract` call for the input schema + output_shape, snapshotted into
   `config`.
5. **Output — ports derived from `output_shape`.** Parse the contract's
   `output_shape`; expose top-level properties as output ports, with one level of
   projection for common nested leaves (e.g. `write_back.doc_id` → `doc_id`).
   Fallback to a single `bundle` port when `output_shape` is absent/opaque.

## The node — contract mode

### Selection flow

- Service picker (inherited) → `vault-memory`. A new **Contract** picker appears,
  populated from the probe: vault-memory's `vm_*` dynamic tools, `vm_` stripped
  for display.
- Selecting a contract calls `describe_contract(name)` once; the result is
  **snapshotted into `config.contractSnapshot`** so the node renders cold-safe
  (no live server needed after selection).

### Inputs → ports (all wireable-or-pinned)

- Each input in the snapshot's `inputSchema` becomes an **input port**, typed
  from the schema (`string` / `array` / …) for existing typed-input validation.
- Inspector per port: **wire** (leave for an upstream connection) or **pin** a
  literal stored in `config.contractInputs[<name>]`.
- A `required` input that is neither wired nor pinned → **blocking** lint
  `memory-input-unbound`.

### Outputs → ports (derived from `output_shape`)

- Parse the snapshot's `outputShape`; top-level properties → output ports.
- One level of nested projection for common leaves (notably
  `write_back.doc_id` → a `doc_id` port). The port records its **projection path**
  so codegen can emit the access expression.
- No/opaque `output_shape` → a single `bundle` output port carrying the whole
  `{steps, write_back}` object.

### Write-back badge (read-only)

- From `describe_contract`'s Sinks / write_back summary: a read-only inspector
  line and a small card badge (e.g. "✎ writes → _memory/"). The side effect is
  **visible, not wireable** — it is internal to vault-memory's MemorySink, not a
  pflow-grantable tool.

### Schema delta (extends the MCP node `config`; no new top-level node field)

```ts
config: {
  mcpServer: "vault-memory",
  contract?: string,                              // bare contract name
  contractInputs?: { [input: string]: unknown },  // pinned literals
  contractSnapshot?: {
    inputSchema: JSONSchema,        // → input ports + typed validation
    outputShape?: JSONSchema,       // → output ports
    writesTo?: string[],            // sink summary → badge
    describedAt?: string,
  },
  expectedGrants?: { [tool: string]: "blocked" | "ask" | "allow" }, // inherited
}
```

Output ports additionally carry a `projection?: string` (e.g. `"write_back.doc_id"`)
in the port model so codegen emits the right access expression.

### Lints (additive to the inherited MCP lints)

- `memory-contract-missing` — server is vault-memory, no contract selected.
  **BLOCKING** (nothing to compile).
- `memory-input-unbound` — a `required` input is neither wired nor pinned.
  **BLOCKING**.
- `memory-contract-stale` — live probe no longer lists this contract, or its
  input schema differs from the snapshot. **Non-blocking**; "re-probe to refresh."

## Codegen & export

The Memory node lowers exactly like an MCP node — an `agent(..., {agentType})`
step plus one companion `.claude/agents/<wf>-<nodeId>.md` that grants
`vault-memory` — but in **contract mode** the agent prompt is a deterministic,
pre-bound instruction rather than free text.

### Emitted agent step

Inputs are resolved from wires/pins into a single args object, then embedded:

```js
const <var> = await agent(
  `Call the MCP tool \`vm_<contract>\` with EXACTLY these arguments and return ` +
  `its JSON result verbatim, no commentary:\n` +
  `\`\`\`json\n${JSON.stringify(<resolvedArgs>, null, 2)}\n\`\`\``,
  { label: "<label>", agentType: "<wf>-<nodeId>" }
);
```

- `<resolvedArgs>` weaves wired inputs (as the upstream binding expressions) and
  pinned literals (from `config.contractInputs`) by the contract's input names.
- Output-port consumers read projections off `<var>`: a `doc_id` port with
  `projection:"write_back.doc_id"` compiles downstream references to
  `<var>?.write_back?.doc_id`. A bare `steps` port → `<var>.steps`. The
  single-port fallback → `<var>`.
- Determinism preserved: stable key order in `JSON.stringify` (sort keys), same
  document → byte-identical output, runs through existing `emit-lint`.

### Companion subagent `.md`

Same emitter as the MCP node, with vault-memory's grants resolved from the
registry. Because the contract's *internal* writes bypass MCP tools, the
**relevant grant is the `vm_<contract>` tool itself** (and `describe_contract` if
the agent needs to confirm shape) — group/permission classification from the
registry still applies (e.g. block `instantiate`-style tools the workflow
shouldn't call ad-hoc).

### Export feedback

Inherited multi-artifact feedback, plus contract-aware notes, e.g.:

> Exported `meeting-prep-flow.js` + 1 connector agent.
> ⚠ 1 node: contract `meeting-prep` not found in this vault's vault-memory
> registry (re-probe or check the vault).

### Honest trade-offs

- **Agent-mediated, not a raw tool call.** The runtime has no direct tool-call
  primitive in the workflow body (per the MCP node design), so even a
  deterministic contract call routes through a single-purpose agent. The prompt
  pins the args to minimize deviation, but a model *could* still misbehave; this
  is the same ceiling every MCP node has.
- **Snapshot can drift.** `contractSnapshot` is point-in-time; a changed contract
  in the vault surfaces as `memory-contract-stale`, not a silent miscompile.
- **Per-vault contracts.** A `.pflow` records only the contract **name**; the
  actual contract (and its inputs) lives in the destination vault. Importing into
  a vault lacking that contract is surfaced (stale lint + export feedback), not
  hidden — same portability stance as MCP policy.

## Components & boundaries (for the plan)

| Unit | Responsibility | Depends on |
|---|---|---|
| contract discovery | filter probe results to `vm_*`; strip prefix | MCP probe (inherited) |
| `describe_contract` adapter | fetch + snapshot inputSchema/outputShape/writesTo | vault-memory MCP, `McpProbe` host |
| input-schema → ports | typed input ports from JSON Schema | core port model |
| output_shape → ports | top-level + 1-level projection → output ports w/ `projection` | core port model |
| contract-mode inspector | Contract picker, per-input wire/pin, write-back badge | discovery, snapshot |
| memory lints | contract-missing / input-unbound / contract-stale | registry, snapshot |
| codegen: contract agent step | deterministic pre-bound `vm_<contract>` call + projections | scriptgen, snapshot |
| codegen: subagent emit | reuse MCP subagent emitter w/ vault-memory grants | registry |
| card visual | 🧠 icon/accent in contract mode; write-back badge | editor node |

## Testing strategy

- **Discovery** — `vm_*` filter + prefix strip; non-vault-memory server ignores
  contract mode.
- **Snapshot** — `describe_contract` result maps to inputSchema/outputShape/
  writesTo; round-trips through `config`.
- **Input ports** — every input → port; required/optional preserved; pinned
  literal stored in `contractInputs`; typed validation honors schema type.
- **Output ports** — top-level props → ports; `write_back.doc_id` projection
  port; opaque output_shape → single `bundle` port.
- **Lints** — each of the three fires only on its condition (contract-missing,
  required-unbound, stale snapshot vs probe).
- **Codegen** — a known contract + pinned/wired inputs emits the deterministic
  agent step with sorted-key JSON args; projection ports compile to
  `<var>.write_back.doc_id` etc.; byte-identical across runs; passes emit-lint;
  subagent `.md` grants vault-memory deterministically.
- **Cold-safe render** — node renders from snapshot with no live server.

## Out of scope (later specs)

- Generic parameterized-tool node for non-vault-memory servers.
- Authoring / editing / saving contracts from inside pflow.
- Deep (>1 level) `output_shape` projection and array-projection output ports.
- Runtime execution of generated workflows (codegen verified by shape + lint +
  determinism).
- Wiring the contract's write-back target as an editable pflow input.
