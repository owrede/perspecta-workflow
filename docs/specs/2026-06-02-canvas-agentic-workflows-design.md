# Canvas-Based Agentic Workflows — Design Spec

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Vault:** Intelligence Impact (`inim`)

## Purpose

Use Obsidian Canvas as a visual programming surface for agentic workflows: prompts, tool calls, data sources, and vault-memory contracts chained as a flowchart that an agent follows from a start node to an end node. Workflows are composable (a canvas can embed another canvas) and may contain bounded or — at top level only — infinite loops.

The **primary v1 deliverable is the canvas-walking tool layer**, not an executor. The same tools serve two interchangeable consumers: an interactive agent (Claude Code / Codex / Copilot) walking the flow step-by-step today, and a headless LLM-API runtime later.

## Architecture

Three cleanly separated layers:

```
CONSUMER (interchangeable)
  • Claude Code / Codex / Copilot   (interactive, v1)
  • Headless LLM-API runtime         (v2, same tools)
        │ calls
CANVAS-WALKER TOOL LAYER  (primary v1 deliverable)
  • Linter/validator (+ auto-color)
  • Cursor/stepper (start, current, advance, context bag)
  • Node renderer (frontmatter → instruction text)
        │ reads/writes
THE CANVAS + NODE NOTES  (the "program")
  • <workflow>.canvas   (graph: nodes + directed edges)
  • node notes (.md, class: WorkflowNode, frontmatter)
```

**Principle:** the canvas is the *program*, the tool layer is the *interpreter*, the consumer is *interchangeable*. The tool layer is the stable contract between them.

**Placement:** the tool layer is an **MCP server** (`mcp__workflow__*`), sitting alongside `mcp__vault-memory__*`. The linter also runs as a standalone script for CI / manual checks.

## Node Schema & Types

Every workflow node is a **`file`-node** on the canvas pointing to a `.md` note with `class: WorkflowNode`. Frontmatter is the source of truth; **color is auto-derived** by the linter from `node_type` (structure drives appearance — same philosophy as the graph.json class colors).

```yaml
---
class: WorkflowNode
node_type: prompt | tool | data | contract | start | end | loop | config
outputs: [summary]          # names this node writes into the shared context bag
# type-specific fields:
tool: search_hybrid         # node_type: tool
params: { query: "{{topic}}" }
contract: assemble_dossier  # node_type: contract
source: "[[some note]]"     # node_type: data
condition: "{{count}} < 10" # node_type: loop (optional)
---
Body = the prompt text / human instruction, with {{placeholders}} resolved against the context bag.
```

| `node_type` | Auto-color | Role |
|---|---|---|
| `start` | green | entry; exactly one per canvas |
| `end` | red | exit; ≥1 required, reachable |
| `prompt` | purple | LLM instruction (body text) |
| `tool` | orange | a tool call (`tool` + `params`) |
| `data` | cyan | read a vault note / data source |
| `contract` | blue | invoke a vault-memory contract |
| `loop` | yellow | edge-driven (see Loop Semantics) |
| `config` | gray | **v2** — params like `maxloops`; v1 lints it as inert |
| *(subworkflow)* | — | `file`-node targeting another `.canvas`; type inferred from extension, not frontmatter |

## Edge Semantics

- Edges are **directed** (`fromNode` → `toNode`), using JSON Canvas's native `fromNode`/`toNode`/`fromSide`/`toSide`/`label`.
- An edge `label` is meaningful for **branch** and **loop** decisions: the stepper reports each outgoing edge with its label, and the **agent/consumer chooses** which to follow. The tool never auto-decides a branch.
- A node with multiple outgoing edges = a branch point. Labels (e.g. `yes`/`no`, `repeat`/`done`) disambiguate.

## Loop Semantics

The loop node's behaviour is read off its outgoing edges (not a frontmatter mode flag):

- **While-loop:** loop node has a `condition` + two labelled edges (e.g. `repeat` / `exit`). The consumer evaluates the condition against the context bag and follows `repeat` or `exit`.
- **Infinite loop:** loop node has a single unlabelled back-edge and no `condition` — a genuine cycle, exit only via external interruption.

## Composability (Nested Canvases)

A `.canvas` dragged into another becomes a **`file`-node whose target is a `.canvas`** — a *subworkflow node*. The tool distinguishes it by the target extension.

- **Every embedded workflow needs its own `start` and `end` node.**
- **Traversal — step into child, shared context:** when the cursor reaches a subworkflow node it descends into the child at its `start` node, walks to the child's `end`, then pops back to the parent and continues. The stepper maintains a **call stack of cursors** to know when to pop.
- **Shared context bag:** parent and child share one flat context bag; the child can read/write any value by name. *Trade-off:* name collisions are possible and a child can clobber parent state. An optional namespace can be added later if this bites.

### Infinite-loop prohibition in embedded workflows

A workflow that is **ever embedded anywhere** must have **zero infinite-loop nodes** (an unbounded child would stall the parent). The linter:

1. Runs a vault-wide "who embeds whom" pass (free — it already walks subworkflow file-nodes).
2. Flags any infinite-loop node in a file that has ≥1 inbound embed-reference.

A purely top-level workflow (zero inbound embed-references) may contain infinite loops. The moment any other canvas embeds it, the infinite loop becomes a lint error — so the fix is either to give the loop an exit edge (make it bounded) or to not embed that workflow. The linter error names the embedding parent(s) so the cause is clear.

## Data Passing — Named Context Bag

The stepper maintains a running key–value **context bag** across the walk (shared across nested canvases per above).

- A node declares `outputs: [summary]` to name what it writes.
- A later node references `{{summary}}` in its body or `params`.
- The stepper resolves `{{…}}` templates against the accumulated context before handing the node to the consumer.
- Mirrors vault-memory contracts' named-binding accumulation, so the `contract` node type integrates naturally.

## Tool Interface — Cursor / Stepper API

Stateful traversal. The tool holds a position (cursor) in the flow and hands the agent one node at a time with its outgoing edges; the agent advances. Proposed surface (names indicative):

| Tool | Purpose |
|---|---|
| `workflow_start(canvas)` | Validate, locate the `start` node, initialise cursor + empty context bag + call stack. Returns the start node rendered. |
| `workflow_current()` | Return the current node: resolved instruction text, `node_type`, type-specific params, and **all outgoing edges with labels**. |
| `workflow_advance(edge?, outputs?)` | Record this node's `outputs` into the context bag, then move the cursor along the chosen `edge` (required at branch/loop points). Descends into / pops out of subworkflows automatically. |
| `workflow_context()` | Inspect the current context bag (debugging). |
| `workflow_status()` | Cursor position, call-stack depth, whether at an `end` node. |

The consumer is responsible for actually executing each node's intent (running the prompt, calling the tool, invoking the contract); the stepper only renders instructions, tracks position, and manages context. This is what makes the consumer interchangeable.

## Linter / Validator Rules

The linter both **validates** and **auto-applies colors**. A canvas is a well-formed workflow iff:

1. Exactly **one `start`** node.
2. **At least one `end`** node, and every `end` is reachable from `start`.
3. Every workflow node note has `class: WorkflowNode` and a valid `node_type`.
4. No **dangling edges** (every edge's `fromNode`/`toNode` exist).
5. Every non-`end` node has ≥1 outgoing edge (no dead ends that aren't ends).
6. Branch/loop nodes with multiple outgoing edges have **distinct labels**.
7. **Embed rule:** any file with ≥1 inbound embed-reference contains **no infinite-loop** nodes.
8. Each embedded child canvas independently satisfies rules 1–7.

Side effect on pass: rewrite each workflow node's canvas color from its `node_type` (idempotent).

## Scope

### v1 (this spec)

- `WorkflowNode` frontmatter schema + a `Class` note (`_src/classes/WorkflowNode.md`) per existing class taxonomy.
- Linter/validator (rules above) + auto-color, runnable standalone and inside the MCP server.
- Cursor/stepper MCP tools (start, current, advance, context, status), including nested-canvas descent/pop and the shared context bag.

### v2 (later, out of scope here)

- `config` node honored at runtime (e.g. `maxloops` to force-exit any loop after N iterations).
- Headless LLM-API runtime consuming the same stepper tools.
- Conversational authoring helper (scaffold start/end, add typed nodes, wire edges).
- Optional context namespacing for nested canvases.

## Open Questions / Deferred

- **Context namespacing:** shared flat bag is v1; revisit if collisions bite.
- **`config` semantics:** lint-inert in v1; full behaviour (maxloops etc.) specified in v2.
- **Branch condition evaluation:** in v1 the *consumer* evaluates conditions (the agent reads `{{…}}` and decides). A formal expression evaluator is a v2 runtime concern.
