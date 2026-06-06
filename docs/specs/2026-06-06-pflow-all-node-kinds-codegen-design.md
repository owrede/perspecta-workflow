# Codegen for all remaining pflow node kinds — design

Date: 2026-06-06
Branch: `feat/pflow-m2-editor`
Status: approved design, pre-implementation

## Motivation

`scriptgen.ts` compiles only `input`, `agent`, `output`, `script`. The other
six kinds — `loop`, `split`, `join`, `verify`, `synthesize`, `branch` — throw
at export time, so the editor ghosts them and faithful graphs (e.g. a visible
refine loop) cannot be exported. This work implements codegen for all six so no
kind throws and the editor un-ghosts every kind.

## Decisions (from brainstorming Q&A)

- **Scope:** all 6 kinds, full fidelity (no deferral).
- **split→join body:** compile to the CC `pipeline(items, stage1, stage2, …)`
  primitive — each node in the split→join span becomes a pipeline stage.
- **branch:** the branch node is an agent that emits a sentinel `BRANCH:
  <label>`; codegen dispatches with `if (/BRANCH: <label>/i.test(choice)) {…}`.
- **span/path membership:** derived from graph topology (traversal), not new
  schema fields. Same model as the loop's refine-span.
- **verify-fail:** non-blocking — verify emits a `VERIFY: pass|fail` verdict,
  logs it, and passes its value through. Gating is expressed by wiring
  verify→branch, not baked into verify.
- **loop:** refine back-edge wire + sentinel + maxPasses (as designed prior
  session).

## Architecture

Two new modules in `@perspecta/core`, to keep `scriptgen.ts` focused:

- `pflow/regions.ts` — pure graph analysis. Given a document, identify
  control-flow regions: loop spans (from refine back-edges), split→join spans,
  and branch paths. Returns structured region descriptors. One responsibility:
  "what are the control-flow regions and which nodes belong to each."
- `codegen/emit-kinds.ts` — per-kind emit functions, called by `scriptgen.ts`.

`scriptgen.ts` changes its top-level emit from "emit each node in topo order"
to "emit each REGION in topo order." A region is either a single node or a
control-flow block (loop / split-join / branch) that absorbs its member nodes;
absorbed members are not emitted again at top level.

emit-lint still runs on the full emitted string (no banned tokens). Determinism
invariant preserved: every emitter iterates declared order; same document →
byte-identical output.

## Per-kind compilation

### verify (sequential, non-blocking)

An agent whose prompt is augmented to emit `VERIFY: pass|fail` plus notes.
Emits:
```
const <var> = await agent(`<prompt + woven context>\n\nEmit a verdict line: VERIFY: pass|fail`, { label });
log(<var>);
```
Its output value is its checked input passed through (the verdict is recorded
via log, not fatal). Downstream nodes/branch may act on the verdict.

### synthesize (sequential, multi-input)

Identical emit to `agent`, but explicitly allowed/expected to have multiple
incoming wires; the existing agent emitter already weaves ALL incoming wires as
labelled `<context name="…">` blocks in declared order. Emits a single
`const <var> = await agent(<template with all context blocks>, { label });`.

### loop (back-edge + sentinel)

A refine back-edge is a wire from the loop node's output port back to an
upstream node's input. The span = nodes on the forward path from the back-edge
target down to the loop node. Topo runs on the graph minus back-edges. Emits:
```
let <loopVar>;
for (let pass = 0; pass < <maxPasses>; pass++) {
  <span body — the span nodes' emitted code>
  if (<sentinelRegex>.test(<loopVar>)) break;
}
```
`maxPasses` (default 3) and `sentinel` (default `ALL_OWNED:\\s*yes`) from the
loop node's `config`. The loop node's own prompt must instruct the agent to
emit the sentinel line.

### split + join (pipeline fan-out)

split has an array-typed input; its matching join collects results. The span =
nodes strictly between split and join (forward traversal from split until
join). Each agent node in the span becomes a pipeline stage. Emits:
```
const <joinVar> = await pipeline(
  <splitArrayExpr>,
  (item) => agent(<stage1 prompt>, { label }),
  (prev) => agent(<stage2 prompt>, { label }),
  …
);
```
join's output is the results array (`<joinVar>`). Existing validation enforces
split/join pairing, array input, and split→join reachability.

### branch (sentinel dispatch)

The branch node is an agent emitting `BRANCH: <label>`. Each outgoing port
carries a label (the port `name`). Paths = nodes reachable from each labelled
output port until reconvergence (or graph end). Emits:
```
const <choiceVar> = await agent(`<prompt>\n\nChoose ONE path; emit: BRANCH: <labels…>`, { label });
if (/BRANCH:\s*<labelA>/i.test(<choiceVar>)) {
  <pathA nodes>
} else if (/BRANCH:\s*<labelB>/i.test(<choiceVar>)) {
  <pathB nodes>
} else {
  <last path nodes>
}
```

## Region-based emit loop

`scriptgen.ts`:
1. Build region descriptors via `regions.ts`.
2. Compute the set of nodes absorbed by some region.
3. Walk topo order; for each node:
   - if it is a region entry (loop/split/branch) → emit the region block;
   - else if it is absorbed by a region → skip (already emitted);
   - else → emit the single node (existing input/agent/output/verify/
     synthesize/script path).

## Validation additions (`validate.ts`)

- branch: at least one labelled outgoing path (outgoing wire whose source port
  has a non-empty name used as the label).
- loop: exactly one back-edge into its span; span must be non-empty.
- Reuse existing split/join pairing, array-input, and reachability rules.
- **Nested regions are out of scope:** if a region's span/path contains another
  region entry (e.g. a split inside a loop), emit a clear validation error
  ("nested control-flow regions are not supported") rather than miscompile.

## Editor

`COMPILABLE_KINDS` in `flow-map.ts` expands to all 10 NODE_KINDS, un-ghosting
every kind in the add-menu and the inspector type dropdown.

## Testing

`packages/core/test/codegen/`:
- One test per kind: emits the expected control-flow shape, is byte-identical
  across two emissions, and passes emit-lint (no throw).
- Combined: branch fed by a verify verdict; split→agent→join pipeline.
- Re-migration: a faithful `meeting-followup` document with a real `loop` node
  parses, validates, and `generateClaudeCodeWorkflow` produces lint-clean
  output.
- Negative: a nested region throws the clear "not supported" error.

## Out of scope

- Nested control-flow regions (single level only this pass).
- Re-migrating the three real workflows to use the new kinds (separate pass
  once codegen lands).
- Runtime execution of the generated workflows (codegen correctness is verified
  by shape + lint + determinism, not by running them).
