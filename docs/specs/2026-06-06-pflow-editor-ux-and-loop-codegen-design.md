# pflow editor UX + loop/output codegen — design

Date: 2026-06-06
Branch: `feat/pflow-m2-editor`
Status: approved design, pre-implementation

## Motivation

The `.pflow` migration of `meeting-followup` collapsed 8 visible canvas nodes
into a 4-node graph whose 4th node is an opaque `script` blob holding the
review loop, formatter, and save logic. The graph stopped being a faithful
picture of the workflow: no visible refine loop, no config, no visible save
destination. Two root causes:

1. **Editor gap.** The editor can't add/delete nodes, edit node name/type, or
   edit workflow-level config. The only way to author a `.pflow` is to
   hand-write JSON or have an agent regenerate it — so faithful graphs don't
   get built by hand.
2. **Codegen gap.** `scriptgen.ts` throws on `loop` and the other advanced
   kinds, so the only way to carry loop/format/save logic into a *working*
   exported workflow today is a `script` node. That forced the collapse.

This work closes both gaps, in the order the user prioritized: **editor UX
first**, then **loop/output codegen**, then a **faithful re-migration**.

## Decisions (from brainstorming Q&A)

- Editor UX is built first; codegen and re-migration follow.
- **Config is NOT a node.** Workflow-level config (name, description, args
  defaults like `target_folder`, `filename_template`, `on_exists`) is shown in
  the inspector when no node is selected. This removes the Config node from the
  target graph proposed earlier.
- Refine loop spans multiple nodes (Draft→Review) via a **refine back-edge
  wire**; the span is derived by graph traversal. The loop re-runs every node
  on the path each pass.
- Loop exit = **sentinel line in agent output + max passes** (e.g.
  `ALL_OWNED: yes`), regex-tested; bounded and deterministic.
- Save is an **agent** node that calls `write_note` itself and outputs
  `saved_path`; End is an **output** node returning it. No script nodes in the
  re-migrated workflow.
- Add-node menu **ghosts** (disabled + dimmed) the not-yet-compilable kinds.
- Node type change warns **only when it would orphan wires/ports**; no dialog
  when zero orphans result.

## Phase 1 — Editor UX

Files: `packages/obsidian-plugin/src/views/pflow-editor/*` plus
`flow-map.ts` and `styles.base.css`. No `@perspecta/core` changes in Phase 1.

### 1. Selected visual state

Selection state already exists (`selectedId` in `editor.svelte`;
`onpaneclick` clears it). Add a visible selected treatment on the node card
(accent ring/border) driven by a `selected` flag passed through `FlowNodeData`
or xyflow's built-in `selected` node prop.

### 2. Background right-click → Add-node menu

- `oncontextmenu` on the canvas pane opens an Obsidian `Menu` at the cursor.
- Lists all 10 kinds in vocabulary order. The 4 compilable kinds (`input`,
  `agent`, `output`, `loop`) are active. The 6 advanced kinds (`split`,
  `join`, `verify`, `synthesize`, `branch`, `script`) are `setDisabled(true)`
  and suffixed "(not yet exportable)".
- Selecting an active kind inserts a node at the cursor's flow-coordinate
  position with default label, empty prompt, and default ports:
  - `agent`: 1 input (`in`), 1 output (`out`)
  - `input`: 0 inputs, 1 output (`out`)
  - `output`: 1 input (`in`), 0 outputs
  - `loop`: 1 input (`in`), 1 output (`out`)
- The new node id is unique (`node-<n>` scanning existing ids). New node is
  auto-selected.
- A new immutable helper `applyAddNode(doc, node, x, y)` in `flow-map.ts`.

### 3. Delete node (confirm if non-empty)

- Trigger: right-click-on-node menu item "Delete node", and `Delete` /
  `Backspace` while a node is selected and focus is not in a text field.
- If the node's `prompt` (or `config.body`) is non-empty → Obsidian confirm
  modal: "This node has instructions. Delete anyway?" Empty → delete
  immediately.
- Deleting removes the node and every wire referencing it.
- Helper `applyDeleteNode(doc, nodeId)` in `flow-map.ts` (immutable).

### 4. Inspector: editable name + type

- **Name**: text input bound to `label` → `applyLabelEdit(doc, id, label)`.
- **Type**: `<select>` of the 10 kinds (advanced kinds shown but
  `disabled`). On change, run the orphan check (§6) before applying.
- Existing Prompt textarea and port lists stay.

### 5. Inspector when nothing selected → workflow config

- When `selectedId === null`, inspector shows workflow-level fields instead of
  "Select a node":
  - `workflow.name` (text)
  - `workflow.description` (textarea)
  - args defaults: `target_folder`, `filename_template`, `on_exists` — surfaced
    as editable fields that write into `workflow.args` defaults.
- Helpers `applyWorkflowMeta(doc, patch)` and `applyArgDefault(doc, key,
  value)` in `flow-map.ts`.
- This is where Config lives now (no Config node).

### 6. Type-change orphan check

- On type change, compute the node's ports under the new kind's defaults, find
  wires referencing a port the new kind won't have (incoming + outgoing).
- Zero orphans → apply immediately.
- Orphans → Obsidian confirm modal listing each orphaned wire in
  `from.node.port → to.node.port` form. Cancel aborts; confirm applies and
  drops those wires.
- Reused confirm helper (`confirmModal(app, title, body): Promise<boolean>`)
  shared by deletion (§3) and this check.

### 7. Arrowheads 2× bigger

- `toFlowEdges` sets `markerEnd: { type: MarkerType.ArrowClosed, width: 24,
  height: 24 }` (was default ~12). Update the `FlowEdge` type and the existing
  test accordingly.

## Phase 2 — loop + output codegen (`@perspecta/core`)

### Loop compilation

- A `loop` node has a **refine back-edge**: a wire from the loop node's `out`
  port back to an upstream node's input. Detect this as the back-edge (the wire
  whose target precedes its source in declaration/topo order).
- The **span** = nodes on the path from the back-edge target down to the loop
  node (graph traversal over forward wires).
- Topo-sort runs on the graph with back-edges removed (already the case once we
  exclude them; `topo.ts` throws on remaining cycles).
- Emit: a `for (let pass = 0; pass < maxPasses; pass++) { <span body>; if
  (<sentinel regex>) break; }` wrapping the span nodes' emitted code.
- `maxPasses` and the sentinel come from the loop node's `config`
  (`maxPasses`, `sentinel`); defaults `3` and `/ALL_OWNED:\s*yes/i`-style.
- The loop node's own prompt is the review step; it must instruct the agent to
  emit the sentinel line. Emit-lint still applies (no banned APIs).

### Output compilation

- `output` already emits `return <inputVar>`. Verify and test the case where
  its upstream is an `agent` node (returns that agent's variable), which the
  Save→End path needs.

### Port-level arg access

- Current weaving resolves any `input`-kind source to bare `args`. With a
  single input node that's fine. For correctness when a downstream agent reads
  a specific arg, weave `args.<portId>` (or `args.<portName>`) rather than the
  whole `args` object. Confirm against the single-input case so existing output
  stays byte-identical where only one arg exists.
  - NOTE: the re-migrated `meeting-followup` (config-in-inspector) has only
    `meeting` as a non-default arg wired into nodes, so this may be a no-op for
    the migration itself, but it is required for correctness and is covered by
    a dedicated test.

## Phase 3 — faithful re-migration

Re-migrate `meeting-followup.pflow` to the 6-node graph (Config now lives in
workflow args, not a node):

```
Meeting (input) ─┬─→ Draft (agent) ←──refine── Review (loop)
                 │        │                         ↑
                 │        └─────────────────────────┘
                 │                  │ done
                 │             Format (agent)
                 └──────────────────┴─→ Save (agent) ─→ End (output)
```

Nodes: `Meeting`(input), `Draft`(agent), `Review`(loop, refine→Draft),
`Format`(agent), `Save`(agent, calls write_note, outputs saved_path),
`End`(output, returns saved_path). Workflow args carry `meeting` (required)
plus `target_folder`/`filename_template`/`on_exists` defaults.

Validate it exports to a working CC workflow via `generateClaudeCodeWorkflow`.
Then apply the same treatment to `person-brief` and `natebjones-delta` after
the user confirms `meeting-followup` is correct.

## Testing

- Phase 1: unit tests for each `flow-map.ts` helper (`applyAddNode`,
  `applyDeleteNode`, `applyLabelEdit`, `applyKindChange` + orphan computation,
  `applyWorkflowMeta`, `applyArgDefault`); update the existing `markerEnd`
  test for the 24px size. UI wiring verified by build + manual reload (no
  component test harness in this plugin).
- Phase 2: codegen tests — loop emits a bounded `for` with sentinel break and
  the span body; output returns an agent var; `args.<port>` weaving; existing
  snapshot byte-identical where a single arg is used. emit-lint passes on loop
  output.
- Phase 3: a test that the re-migrated `meeting-followup.pflow` parses,
  validates, and `generateClaudeCodeWorkflow` produces lint-clean output.

## Out of scope

- Loop container/nesting UI; the other 6 node kinds' codegen.
- The "remember config back to frontmatter" behavior (no frontmatter target in
  a CC workflow; surfaced as advisory text only).
- Editing port schemas in the inspector (ports use kind defaults; richer port
  editing is future work).
