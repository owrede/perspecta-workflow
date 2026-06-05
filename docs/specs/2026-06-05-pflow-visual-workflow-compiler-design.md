# Perspecta Workflow as a Visual Compiler for Agentic Workflows

- **Status:** Design approved 2026-06-05; ready for implementation planning.
- **Author:** Oliver Wrede (with Claude)
- **Supersedes (conceptually):** the `.canvas`-based authoring model in
  `2026-06-02-canvas-agentic-workflows-design.md` and the skill-discovery specs.
  perspecta-workflow is new and unused; this is a deliberate conceptual reset.
- **Suite conventions:** follows
  `../perspecta-suite/docs/SUITE-CONVENTION-CATALOG.md` (referenced sections
  inline). Target convention version: as of 2026-06-05.

## 1. Problem and thesis

Anthropic shipped **dynamic workflows** in Claude Code (research preview,
v2.1.154+): a task is orchestrated by a **JavaScript script** that spawns
subagents, which a runtime executes in the background. The script holds the
control flow and intermediate results; the user sees only the final answer.
The runtime **journals every `agent()` call** so a run is resumable — a rerun
replays the longest unchanged *prefix* of identical `(prompt, opts)` calls from
cache and runs only the divergent tail live. There is no official GUI for
authoring these scripts, and the script format itself is undocumented.

perspecta-workflow will become **a visual node editor that compiles a typed
dataflow graph into native agentic workflows** for multiple targets. One
authored artifact (`.pflow`), one in-memory intermediate representation (IR),
and multiple deterministic code emitters.

```
                         ┌──────────────────────────┐
   .pflow file  ◄──────► │   Typed-port IR (Zod)    │  ◄── single source of truth
   (Svelte Flow editor)  └───────────┬──────────────┘
                                     │  pure functions, fs-agnostic, in @perspecta/core
              ┌──────────────────────┼───────────────────────┐
              ▼                      ▼                        ▼
   scriptgen (M1)          packetgen (M3)           importer (M4)
   → .claude/workflows/    → .workflow/ultracode/   CC .js  → IR
     <name>.js (CC native)   plan.md + packets        (visualize / refactor)
   DETERMINISTIC codegen   (Codex via skill)
```

### 1.1 The load-bearing constraint: determinism is a correctness invariant

Because the CC runtime journals `agent()` calls and keys its resume cache on the
exact `(prompt, opts)` sequence, **re-exporting an unchanged graph must produce
byte-identical output**, or every downstream cache entry is invalidated. This
makes script emission a *correctness* problem, not a stylistic one. The
consequences, which drive the whole architecture:

- The export is a **pure function `IR → string`** (deterministic codegen),
  **never** LLM generation. An LLM cannot guarantee byte-identical reproduction
  across model versions/providers, and routinely emits banned non-determinism
  (`Date.now()`, `Math.random()`, UUIDs) or pure-literal violations.
- An LLM may assist **only at authoring time**, and only to draft **prompt
  text**, which is then frozen as static string data in the graph. By export it
  is just a literal the emitter interpolates. The LLM never sits in the export
  path.
- The emitted script is sandbox-bound: no `fs`/shell/`require`/network from the
  script itself (only spawned agents touch the world). A post-emit lint enforces
  this (§6.4).

This is a classic compiler backend: clean IR + small constrained target +
hard invariants ⇒ deterministic, structure-directed emission. (Research basis:
the resume-cache and sandbox behavior are documented at
`code.claude.com/docs/en/workflows`; the script API surface is reconstructed
from the runtime contract and community sources and is treated as preview-stable
but version-pinned, see §9.)

### 1.2 Two targets are two media, not two dialects

Research into `github.com/PabloNAX/ultracode-skill` (a Codex "dynamic workflows"
port) showed it is **not a runtime** — it is a prompt-only skill that tells a
host agent to *behave like* a workflow by hand-authoring Markdown planning
documents and calling the host's **native** subagent primitive (Codex's
`spawn_agent`). It exposes no `agent()`/`pipeline()` API and no JS script.

Therefore the two export targets are different *media*:

| Target | perspecta-workflow emits | Nature |
|---|---|---|
| **Claude Code native** | a deterministic `.js` script (`agent`/`pipeline`/`parallel`/`meta`) | executable code for a runtime |
| **Codex (ultracode-style skill)** | a Markdown `plan.md` + packet documents | prose evidence docs an LLM follows |

Both compile from the same IR through different backends. The Codex backend is
actually closer to the existing `skillgen.ts` (already emits Markdown) than the
CC backend is. This validates the one-IR/multi-backend architecture.

## 2. Goals and non-goals

**Goals**
- A typed-port dataflow IR rich enough to represent the structured subset of
  dynamic workflows (fan-out, bounded loops, adversarial verify, synthesis,
  agent-decided branching) **and**, via a raw `script` node, *any* workflow.
- A deterministic CC code emitter producing 100%-native, 100%-compatible
  `.claude/workflows/<name>.js` that survives the resume-cache contract.
- A custom visual editor (Svelte Flow) with ComfyUI-style typed I/O ports and
  socket-level compatibility checking.
- A new `.pflow` file format as the authored source of truth.

**Non-goals (this spec)**
- LLM-based script generation (rejected on correctness grounds, §1.1).
- Bidirectional sync against *arbitrary hand-edited* CC scripts. Import (M4) is
  a one-way analysis that may degrade unmappable regions to `script` nodes;
  perspecta owns only the `.pflow` it authored.
- Mobile support is out of scope only where a dependency forces it; the design
  keeps `isDesktopOnly: false` because it uses pure file I/O (no shell-out).
- Touching the legacy `.canvas` machinery beyond freezing it (§8).

## 3. The typed-port IR

Lives in `@perspecta/core`, defined with Zod (matching the suite's vault-memory
pattern). Pure, fs-agnostic, headless-testable.

### 3.1 Document shape

```
PflowDocument
├── pflowFormatVersion: 1                 // migration anchor (convention §11.4)
├── workflow:
│     ├── name: string                    // becomes the /<name> command on save
│     ├── description: string
│     └── args?: PortSchema               // the workflow's input schema (args global)
├── nodes: PflowNode[]
├── wires: Wire[]                          // output-port → input-port (data wires)
└── editor:                               // spatial state, plugin-only
      ├── viewport: { x, y, zoom }         // not persisted on every change (anti-thrash)
      └── nodePositions: { nodeId, x, y, width?, height? }[]
```

### 3.2 Node and port shape

```
PflowNode
├── id: string
├── kind: NodeKind                        // §4
├── label: string
├── prompt?: string                       // instruction text — the LLM-authorable DATA
├── inputs:  Port[]
├── outputs: Port[]
├── phase?: string                        // optional: this node opens a progress phase
├── log?: string                          // optional: emit a narrator line
└── config?: Record<string, unknown>      // kind-specific (model, mode, maxIterations, budget…)

Port
├── id: string                            // unique within the node
├── name: string                          // display + codegen variable hint
├── schema: PortSchema
└── required?: boolean                    // inputs only; default true

PortSchema  (JSON-Schema-like; IS the agent({schema}) argument at codegen time)
├── type: "string" | "number" | "boolean" | "object" | "array" | "any"
├── items?: PortSchema                    // when type === "array"
├── properties?: Record<string, PortSchema>   // when type === "object"
└── required?: string[]                   // when type === "object"
```

A port's `schema` is reused verbatim as the `agent({ schema })` argument, so no
translation layer exists between the editor's type system and the emitted code.
`type: "array"` is the type that licenses fan-out: a `split` node requires an
array-typed input (§4).

### 3.3 Wire shape and derived control order

```
Wire
├── from: { nodeId: string, portId: string }   // an OUTPUT port
└── to:   { nodeId: string, portId: string }    // an INPUT port
```

Wires are **data** dependencies. Control order is **derived** by topological
sort of the dataflow DAG (`pflow/topo.ts`), so there is no separately stored
control graph that can desync from the data graph (vault-memory's key
anti-desync lesson: derive edges, don't store them). Cycles are illegal except
the bounded back-edge inside a `loop` region (§4).

## 4. Node and edge vocabulary

Edges are uniform typed data wires (§3.3); expressiveness lives in node kinds.
Every kind has a single deterministic codegen target for the CC backend.

**Core execution**

| Kind | Meaning | CC codegen |
|---|---|---|
| `input` | Workflow entry; exposes typed `args` | reads the `args` global, typed by `workflow.args` |
| `agent` | One subagent call | `await agent(prompt, { schema, model, label })` |
| `output` | Workflow result | the script's `return` value |

**Fan-out (explicit split/join pair — fork/join / BPMN-gateway style)**

| Kind | Meaning | CC codegen |
|---|---|---|
| `split` | Opens a region; **requires an array input**; binds a per-item variable | opens `pipeline(items, …)` (default) or `parallel(items.map(() => …))` |
| `join` | Closes the matching region; collects per-item results into an array output | the awaited `pipeline`/`parallel` result array |

`split.config.mode` ∈ `{ "pipeline", "parallel" }`. `"pipeline"` (no barrier) is
the default per the runtime's own guidance. Nodes on the path between a balanced
split/join run **per item**. The validator enforces: each `split` has exactly
one matching `join`; the region is single-entry/single-exit; everything between
them is region-internal (reuses the existing reachability analysis in
`linter.ts`). `parallel` results are `.filter(Boolean)`-guarded in emitted code
because the runtime turns a thrown agent into `null`.

**Control & quality patterns** (what makes it a real dynamic workflow)

| Kind | Meaning | CC codegen |
|---|---|---|
| `loop` | Bounded iteration | `while (i++ < N && (!budget.total || budget.remaining() > FLOOR)) {…}`; `N` from `config.maxIterations`. Bounded so resume stays deterministic. |
| `verify` | Adversarial review of an input | `parallel` of `config.voters` refuter agents + majority vote; survives iff `≥ ceil(voters/2)` do not refute |
| `synthesize` | Merge many results into one | a final `await agent()` over the collected inputs |
| `branch` | **Agent-decided** routing (never human — a background run can't prompt) | `await agent({ schema: { type:"string", enum:[…labels] } })`, then a `switch` over the result |

**Escape hatch**

| Kind | Meaning | CC codegen |
|---|---|---|
| `script` | Raw JS body supplied by the user or importer | emitted **verbatim** inside the script body; its declared input/output ports are its contract with the rest of the graph |

The `script` node guarantees Idea B (M4) can represent *any* workflow: whatever
the importer cannot map to a structured node becomes a `script` node carrying
the original code, with ports inferred from the values it consumes/produces. The
graph is never "unrepresentable," only "partially structured." `script` bodies
are still subject to the emit-lint (§6.4), so they cannot smuggle
non-determinism.

`phase` and `log` are node **annotations** (fields on any node), not separate
kinds, keeping the graph clean.

## 5. The custom editor (M2)

Modeled directly on vault-memory's contract designer (proven in-suite).

- **`PflowEditorView extends TextFileView`**, registered for the `.pflow`
  extension. On `setViewData`: parse + Zod-validate; on invalid input, render an
  **error banner instead of crashing**. On change: serialize via `getViewData`
  and `requestSave()` (debounced). This guards against Obsidian's
  mount-time failure modes.
- **Svelte 5 + `@xyflow/svelte`** (Svelte Flow), mounted via `mount()`.
  Three-pane CSS-grid layout: **palette** (draggable node kinds) / **canvas**
  (the graph) / **inspector** (selected node's ports, prompt, config).
- **Typed ports as Svelte Flow `Handle`s** — one handle per port (not the single
  generic in/out vault-memory uses). Handle color encodes the port's schema
  `type`. `onConnect` **rejects schema-incompatible connections**, giving
  ComfyUI-style socket-level validation. This is the payoff of the rich type
  system. M1 compatibility is intentionally shallow (§9): `any` joins anything;
  same `type` joins; `array` requires matching `items.type`; deep structural
  subtyping of `object` properties is deferred.
- **Inspector** generates a form from each node's port schemas (vault-memory's
  `zod-to-form` pattern) and is where prompt text is authored — the **only**
  place an LLM may assist (drafting prompt copy), per §1.1.
- **Spatial state** persisted in `.pflow`'s `editor` block; node-move commits
  debounced; viewport not persisted (anti-thrash). **Wires derive from the data
  model** and are never stored as a separate desyncable list.
- All styling via Obsidian CSS variables; `proOptions={{ hideAttribution:true }}`.
  `isDesktopOnly: false` (pure file I/O, no shell-out).
- CSS classes scoped `perspecta-workflow-*` per convention §6.2.

## 6. Code generation (CC backend, M1)

### 6.1 Emitter structure
`codegen/scriptgen.ts`: pure `PflowDocument → string`. Walks the topologically
ordered DAG, emitting one statement per node per §4. Threads dataflow as script
variables named from port names (collision-safe). Opens/closes `split`/`join`
regions as `pipeline`/`parallel` calls.

### 6.2 `meta` as an AST-built pure literal
`meta` is constructed as an AST object-literal node and serialized, so the
pure-literal rule (no spreads, variables, function calls, or computed keys) is
**structurally unviolatable**. Fields: `name`, `description`, and `phases`
derived from the distinct node `phase` annotations (with `model` per phase where
a node sets `config.model`).

### 6.3 Determinism guarantees
No timestamps, randomness, or ordering ambiguity in emitted code. Node and port
iteration is by a stable sort (declared order, then id). **Keystone test:** emit
twice from the same IR and assert byte-identical output.

### 6.4 Emit-lint (hard gate)
After emission (every target), scan for banned tokens: `Date.now`, `Math.random`,
argless `new Date(`, `require(`, `import(`, `fetch(`, `fs.`. Any hit **fails the
export** with a precise message pointing at the offending node (relevant for
`script` nodes especially). This protects the resume-cache and sandbox contracts
even against hand-written `script` bodies.

### 6.5 Output location
Writes to `.claude/workflows/<name>.js` (project) via Obsidian's vault adapter —
the standard CC saved-workflow location, becoming a `/<name>` command. A header
comment marks it generated (convention §11.2):
`// Generated by Perspecta Workflow v<version> from <name>.pflow — do not hand-edit.`

## 7. Repository structure, build, testing

### 7.1 New files (monorepo split preserved)
```
packages/core/src/
  pflow/schema.ts        # Zod IR + .pflow document            (NEW, M1)
  pflow/validate.ts      # typed-port + split/join validator    (NEW, M1; extends linter.ts)
  pflow/topo.ts          # dataflow → control order             (NEW, M1)
  codegen/scriptgen.ts   # IR → CC .js                          (NEW, M1)
  codegen/emit-lint.ts   # banned-token gate                    (NEW, M1)
  codegen/packetgen.ts   # IR → Codex packets                   (M3; not in M1)
  importer/from-cc.ts    # CC .js → IR                          (M4; not in M1)
packages/obsidian-plugin/src/
  views/pflow-editor/    # Svelte Flow editor                   (NEW, M2)
```

### 7.2 Build
The plugin gains Svelte + `@xyflow/svelte`, bundled inline by esbuild (as
vault-memory does). `@perspecta/core` stays dependency-light and pure (no Svelte,
no Obsidian). Node ≥ 22 (convention §5).

### 7.3 Testing (TDD; convention §9.4)
`core` is the test priority, all headless:
- IR Zod validation; required-input-wired; port-schema compatibility.
- split/join balance, single-entry/single-exit region checks.
- topological control-order derivation; cycle rejection (except bounded `loop`).
- **scriptgen golden-file tests**: fixture `.pflow` → exact expected `.js`.
- **determinism test**: emit twice, byte-identical (§6.3).
- emit-lint rejection cases (each banned token; a `script` node smuggling one).

Editor: schema-compatibility and derive-wires logic tested as pure functions;
the Svelte view smoke-tested once (Obsidian wrappers tested once per suite §9.4).

Vitest gotcha (convention §9.4): when aliasing `obsidian` to a stub, resolve with
`fileURLToPath(new URL(...))`, never `.pathname` (the checkout path contains a
space).

## 8. Legacy `.canvas` handling

The existing `.canvas` marker, autocolor, node coloring, and skill-sync code is
**frozen, not deleted** in M1/M2 — it is tested, working code, and removing it is
not on the critical path. A later milestone decides whether a `from-canvas`
importer is worthwhile or the code is retired. This plan does not modify it.

## 9. Risks and mitigations

- **Undocumented, preview-stage target format.** The CC workflow script API is
  not officially documented and may shift. *Mitigation:* a single emitter is the
  one place to adapt; pin the targeted runtime version in this doc and in a
  `codegen` constant; golden-file tests will surface drift loudly.
- **Rich type system over-build.** JSON-Schema-like ports risk scope creep.
  *Mitigation:* M1 implements only what validation and codegen consume; no schema
  editing UI beyond the inspector form; no structural subtyping beyond
  `any` + shallow structural match initially.
- **Editor-before-IR churn.** M1+M2 ship together; building UI against an
  unproven IR can thrash the data model. *Mitigation:* land `core` IR + scriptgen
  with passing golden tests **before** wiring the editor's save path to it; the
  editor renders a proven IR.
- **`script` node as a correctness hole.** Verbatim JS could violate sandbox
  rules. *Mitigation:* emit-lint runs on `script` bodies too; ports are its only
  contract; documented as advanced/escape-hatch.

## 10. Milestones

| M | Deliverable | In this plan? |
|---|---|---|
| **M1** | Typed-port IR + `.pflow` schema + validator + topo + scriptgen + emit-lint (headless, fully tested) | **Yes** |
| **M2** | Custom Svelte Flow editor (`.pflow` view, typed ports, inspector, export command) | **Yes** |
| M3 | Codex packet emitter (`packetgen`) | No |
| M4 | Import/visualize arbitrary CC workflows → IR (Idea B), degrading to `script` nodes | No |
| M5 | (folded into M1 vocabulary) `script` escape-hatch hardening + advanced patterns | Partial |

**This plan (M1+M2)** delivers the interim goal end-to-end: author a workflow
visually in a `.pflow` editor and export a 100%-native Claude Code dynamic
workflow to `.claude/workflows/<name>.js`, with deterministic, resume-safe output
guaranteed by golden-file and byte-identity tests.

## 11. New-convention checkpoint (suite §8.9)

This work introduces patterns that may warrant suite-wide conventions and should
be proposed upstream in `perspecta-suite` before broad rollout:
- A custom `TextFileView` + Svelte Flow editor pattern (shared with vault-memory)
  — candidate for a documented suite convention or a shared component.
- A "generated agentic-workflow artifact" marker convention (§11.2 extension).
- Deterministic-codegen guidance (banned-token lint) as a suite practice for any
  plugin emitting runtime scripts.
