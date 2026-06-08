# pflow MCP Resource Nodes — Design

> **Status:** approved design (2026-06-08). Implementation plan to follow.
> **Scope:** ONE coherent feature — MCP servers as a workflow resource, comprising
> (a) a vault-global settings registry, (b) a first-class MCP node, (c) codegen that
> emits subagent grants, (d) a workflow-level resource summary. Eval node, scripts,
> subagents-as-resources, and non-MCP data connectors are explicitly OUT of scope
> (separate later specs).

## North star

perspecta-workflow exists to **VISUALIZE** agent workflows so a human can understand,
design, and orchestrate them. Every decision below leads with the user's mental model
and what the canvas communicates; implementation lowering is secondary and invisible to
the user. In particular: an MCP node represents **reaching outside the vault to talk to
an external service** — a weighty, distinct act that must be loud on the canvas, even
though it shares implementation machinery with the agent node.

## The runtime constraint that shapes everything

Verified against Claude Code's Workflow runtime and subagent docs:

- The dynamic-workflow `agent(prompt, opts)` primitive accepts only
  `label / phase / schema / model / isolation / agentType`. **There is NO per-call
  tool/MCP parameter** (`allowedTools`, `mcpServers`, etc. do not exist on `agent()`).
- The ONLY way to grant an MCP server (and restrict tools) to a step is to point it at a
  **subagent definition** (`.claude/agents/*.md`) via `agentType`, whose frontmatter
  carries `mcpServers`, `allowedTools`, `disallowedTools`, `permissionMode`.
- MCP servers for a project are declared in `.mcp.json` (vault root). `tools/list`
  returns each tool's `name`, `description`, `inputSchema`, and optional
  `annotations` (`readOnlyHint` / `destructiveHint`) — many servers omit annotations.
- The workflow script body cannot call tools, MCP, Bash, or the filesystem directly —
  everything goes through agents.

**Consequence:** an MCP node compiles to an agent step **plus** a generated companion
subagent `.md`. Export emits multiple artifacts. No new `agent()` options are ever
emitted — we stay strictly within the verified runtime surface.

## Architecture (three layers + one summary)

1. **Settings registry** (vault-global): whitelist servers from `.mcp.json`, probe them
   on demand (cold → hot), set per-tool permission, grouped read/write.
2. **MCP node** (editor + IR): a first-class, visually distinct node bound to one
   whitelisted service; lowers to an agent step.
3. **Codegen/export**: reads the registry, emits the workflow `.js` + one subagent `.md`
   per MCP node.
4. **Workflow resource summary** (inspector, no node selected): a read-only roll-up of
   the workflow's external footprint + requirements-met status.

---

## Layer 1 — Settings registry (vault-global)

A new **MCP** section in perspecta-flow settings, modeled on the Claude app's connector
permission UI (Blocked / Ask / Always-allow).

### Server list & whitelist

- Read `.mcp.json` at the vault root → list all servers by name. A server not yet opted
  in is **cold** (listed, not usable in workflows).
- An opt-in (whitelist) checkbox per server. Whitelisting triggers a **probe**.
- Each hot server shows its tool count (e.g. "Figma · 17").

### Probe (cold → hot), on demand

- Probing is **never automatic** — one explicit click (whitelist toggle or a
  "Probe / Re-probe" button). Nothing launches a server unless the user asks.
- The probe launches that one server, performs the MCP handshake, calls `tools/list`,
  and caches each tool's `{ name, description, inputSchema, annotations }`.
- Probe is performed through a **host-agnostic `McpProbe` interface**
  (`probe(serverName): Promise<ProbedTool[]>`). The concrete implementation — running in
  the existing Node `packages/mcp-server` vs. in-plugin via Electron's Node — is chosen
  during planning. The plugin builds browser-target, so spawning processes there is a
  real risk; deferring the impl keeps the design clean.
- States surfaced per server: `cold` / `probing` / `hot` / `failed` (with the error
  message). A failed probe leaves the server cold and shows the error.

### Per-tool permission (Claude-app vocabulary)

Three states per tool:

- **Blocked** — hidden from the agent entirely (→ `disallowedTools`).
- **Ask** — the agent may use it but is prompted before each use (granted, not
  auto-allowed). **This is the default** for a newly probed tool (safe: nothing runs
  unattended until promoted).
- **Always allow** — the agent uses it without prompting (→ `allowedTools`).

### Read vs. write grouping

- Tools are split into a **Read** group and a **Write/destructive** group in the UI.
- Classification per tool: **annotations first** (`readOnlyHint` true → read;
  `destructiveHint` true → write) → **name/verb heuristic** fallback
  (`get|list|search|read|fetch|describe|view` → read;
  `create|update|delete|write|set|add|remove|put|post|patch` → write;
  **unknown → write**, the safe side) → **user override** (each tool's group is
  user-correctable in settings).
- The classification drives only the **grouping + a group-level bulk action**: setting a
  whole group's permission at once. Blocking the **Write** group makes the server
  effectively read-only for ALL workflows. Each tool still carries its own
  Blocked/Ask/Always state.

### Settings data shape

```ts
mcpRegistry: {
  [serverName: string]: {
    whitelisted: boolean;
    probe: { status: "cold" | "probing" | "hot" | "failed"; error?: string; probedAt?: string };
    tools: {
      [toolName: string]: {
        description?: string;
        group: "read" | "write";                       // classified, user-overridable
        groupSource: "annotation" | "heuristic" | "user";
        permission: "blocked" | "ask" | "allow";       // default "ask"
      };
    };
  };
}
```

Stored in the existing `PerspectaSettingsStore`. Vault-global: every workflow reads the
same registry.

---

## Layer 2 — The MCP node (editor + IR)

### Mental model (primary)

An MCP node = **this step reaches outside the vault to talk to an external service.**
It is its own node kind, visually and conceptually distinct from an agent node — even
though it lowers to an agent step internally (that lowering is invisible to the user).

### On the canvas

- **Distinct visual identity:** its own accent color (NOT agent purple) and a
  connector/plug icon, so it reads as an external boundary at a glance.
- **The bound service name shown prominently on the card** (e.g. "Figma"), not a subtle
  badge — the external service is foregrounded.
- Input/output ports behave exactly like an agent node (token-derived from the prompt +
  inspector-editable).

### Inspector (Mode A, mcp node selected)

Leads with the external-resource framing, in this order:

1. **Service** — a picker of *whitelisted, hot* servers from the registry.
2. **Permitted actions** — a read-only grant summary resolved against the registry
   (e.g. "17 tools — 11 always · 4 ask · 2 blocked").
3. **Policy-mismatch warning** when present (see lints).
4. Then the usual **Name / Prompt / Ports** sections.

### Behaviour

The node keeps the normal prompt field with `{{in:}}`/`{{out:}}` tokens — the user
writes what to do ("Use the figma server to fetch the design at {{in:url}}; return it as
{{out:design}}"). All existing token/port/typed-input/codegen machinery applies
unchanged. (Design rationale: this is "Option A" — an agent step pre-granted one server;
it has no power ceiling, reuses everything, and degrades gracefully if the probe is
stale. A future additive "insert function call" helper may use the probed function list
to drop precise call snippets into the prompt — out of scope here.)

### IR / schema

- `"mcp"` joins `NODE_KINDS`.
- The binding + an import-warning snapshot live in the existing `config` field (the same
  field `loop` already uses for `maxPasses`/`sentinel`), so no new top-level node field:

```ts
{
  id, kind: "mcp", label, prompt, inputs, outputs, phase?,
  config: {
    mcpServer: "figma",
    // Snapshot of the per-tool permission this node was EXPORTED against, STAMPED
    // at export time (the registry is read then anyway) and written back into the
    // .pflow. Used to warn on import into a stricter vault. Optional: a node never
    // yet exported (or hand-authored) has none and simply skips the import check.
    expectedGrants?: { [toolName: string]: "blocked" | "ask" | "allow" };
  }
}
```

### Portability & the import warning

- A `.pflow` stores only the server **name** (and the optional `expectedGrants`
  snapshot). The actual **policy lives in the destination vault's registry** and is
  resolved at export time. This is correct: policy is an environment concern, not a
  workflow concern, so the `.pflow` stays portable.
- On load, an MCP node compares its `expectedGrants` snapshot to the local registry and
  warns if the local policy is **stricter** (a tool it expected allowed/ask is now
  blocked or downgraded) — making a capability loss **visible** instead of silent.

### Lints (shown on the node)

- `mcp-server-missing` — no service selected. **BLOCKING** for export: without a service,
  no valid subagent can be emitted. This is the only blocking MCP lint.
- `mcp-server-not-whitelisted` — bound service isn't whitelisted in this vault.
  Non-blocking/informational (export still proceeds; the resulting subagent grants nothing
  useful, which the export feedback states).
- `mcp-server-cold` — bound service is whitelisted but not probed (no tool data).
  Non-blocking: export proceeds with an empty/coarse grant; user is told to probe.
- `mcp-policy-stricter` — this vault's policy is stricter than the node's
  `expectedGrants` (capability lost on import). Non-blocking; informational.

Rationale: a workflow with an unavailable/cold service can still export — it just
produces a weaker subagent, which the export feedback surfaces. Only the total absence of
a service selection blocks, because there is nothing to compile.

---

## Layer 3 — Codegen & export

### User action & perception

The user clicks the existing **Export** button (inspector, no node selected). One action.
They should perceive: "my visual workflow became a runnable Claude Code workflow, and the
external-service permissions I see on the canvas were carried over faithfully."

### Emitted artifacts

1. **The workflow `.js`** (as today). An mcp node lowers to a normal
   `await agent(prompt, { label, agentType: "<wf>-<nodeId>" })`. Its prompt has tokens
   substituted exactly like an agent node, plus a generated line naming the service it
   may use.
2. **One `.claude/agents/<wf>-<nodeId>.md` per mcp node**, with frontmatter derived from
   the registry:
   - `mcpServers: [<server>]` — grants the service.
   - `allowedTools` — the server's **always-allow** tools.
   - `disallowedTools` — the server's **blocked** tools.
   - **Ask** tools are granted (not in `disallowedTools`) but NOT in `allowedTools`, so
     they prompt at run time.
   - a generated `description` + system prompt naming the service and its permitted
     actions.

### Export feedback (user-facing)

Beyond "wrote `<name>.js`", report the connector agents written and surface any MCP
requirement problems, e.g.:

> Exported `natebjones-delta.js` + 3 connector agents.
> ⚠ 1 node: this vault blocks `figma.create_file` (node expected it allowed).

### Honest trade-offs (documented, not hidden)

- **Export is a function of `.pflow` + registry**, not the `.pflow` alone: the same
  workflow exported in two vaults with different registries produces different subagent
  files. This is correct (policy is environmental); the export feedback makes it visible.
- **"Ask" tools prompt the human DURING a run** — friction for unattended/repeatable
  workflows, but exactly the chosen safety posture. Documented so users know "ask" tools
  pause the run.
- **No new `agent()` options** are ever emitted — only `agentType` + the companion `.md`.
- **Export stamps `expectedGrants` back into the `.pflow`** for each MCP node (the
  snapshot the import-warning compares against). So export writes the `.pflow` in addition
  to the generated artifacts. This is the only path that mutates the document on export;
  it is idempotent when the registry is unchanged (same snapshot → no diff).

---

## Layer 4 — Workflow-level resource summary (inspector, no node selected)

A new **External Resources** section in the inspector's Mode B (workflow config), beside
Name / Description / Save defaults / Export.

### What it shows (read-only, derived — stores nothing new in the `.pflow`)

A roll-up across ALL MCP nodes in the workflow — the whole flow's external footprint:

- **Per distinct service used:** which nodes use it + the effective permission summary
  resolved against this vault's registry —
  e.g. "Figma — used by 2 nodes · 11 always / 4 ask / 2 blocked."
- A clear **requirements-met / not-met** status for the workflow as a whole.

### Warnings when requirements aren't met (aggregated from the node lints)

- A bound service **not whitelisted / cold** → "⚠ Figma is not available in this vault
  (not whitelisted)."
- **Policy stricter than expected** → "⚠ This vault blocks `figma.create_file`, which
  this workflow expects."
- An mcp node with **no service** → "⚠ 1 connector node has no service selected."

### Why (user's view)

Today a user only learns a workflow can't fully run when it fails mid-execution or when
export quietly produces a weaker subagent. This section makes the **external contract of
the workflow visible up front** — "to run this faithfully, this vault needs Figma
whitelisted with `create_file` allowed." It's the manifest you'd read before trusting a
shared workflow, and it sits right above the Export button so you see requirements →
see they're met → export.

This section is pure presentation over data already present (MCP nodes + registry),
computed from the same lints used per node — cheap, and keeps the `.pflow` clean.

---

## Components & boundaries (for the implementation plan)

| Unit | Responsibility | Depends on |
|---|---|---|
| `McpProbe` interface | `probe(server) → ProbedTool[]`; impl deferred to plan | MCP SDK client |
| settings registry (store + UI) | whitelist, probe trigger, per-tool permission, read/write grouping | `McpProbe`, `.mcp.json` reader, `PerspectaSettingsStore` |
| tool classifier | annotations → heuristic → user override → `read`/`write` | ProbedTool annotations/name |
| `mcp` node kind (schema) | `NODE_KINDS += "mcp"`; `config.mcpServer` + `config.expectedGrants` | core schema |
| mcp node (editor) | distinct card visual; inspector Service picker + grant summary | registry (read) |
| mcp lints | server-missing / not-whitelisted / cold / policy-stricter | registry (read), node config |
| codegen: agent lowering | mcp node → `agent(..., { agentType })` | existing scriptgen |
| codegen: subagent emit | `.claude/agents/<wf>-<nodeId>.md` from registry grants | registry (read), node config |
| export multi-artifact | write `.js` + subagent `.md`s; rich feedback | `exportClaudeCodeWorkflowFile` |
| workflow resource summary | derived roll-up + requirements status (Mode B) | registry (read), mcp lints |

## Testing strategy

- **Tool classifier** — pure unit tests: annotations win; verb heuristic; unknown→write;
  user override sticks.
- **Registry resolution** — given a registry + a server, derive `allowedTools` /
  `disallowedTools` / ask set; group bulk-block makes a server read-only.
- **Schema** — `mcp` kind parses; `config.mcpServer` / `expectedGrants` round-trip.
- **Lints** — each of the four fires on the right condition and only then.
- **Codegen** — an mcp node emits `agentType` + a deterministic subagent `.md` with the
  correct frontmatter for a known registry; byte-identical across runs; the workflow `.js`
  still executes with a stub `agent` via the established emitted-code test harness.
- **Import warning** — a node whose `expectedGrants` exceeds the local registry produces
  `mcp-policy-stricter`; an equal/looser registry does not.
- **Probe** — against a fake `McpProbe` (no live server in unit tests); a live-probe
  smoke test belongs with whichever host the plan picks.
- **Resource summary** — derived roll-up aggregates per service and reports met/not-met
  for representative registries.

## Out of scope (separate later specs)

- **Eval node / Karpathy loop** — a dedicated grader node.
- **Non-MCP data connectors** — old-school DB read/write; revisit after MCP is proven.
- **Subagents-as-resources & scripts/tools** as distinct attachment types.
- **"Insert function call" helper** in the MCP node prompt editor (additive).
- **IR interpreter / debug step-through** — deferred.
