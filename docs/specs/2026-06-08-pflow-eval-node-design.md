# pflow Eval Node — Design

**Date:** 2026-06-08
**Status:** Approved for planning
**Branch:** feat/pflow-m2-editor
**Related:** [2026-06-08-pflow-mcp-resource-nodes-design.md](./2026-06-08-pflow-mcp-resource-nodes-design.md), [2026-06-07-pflow-prompt-token-ports-design.md](./2026-06-07-pflow-prompt-token-ports-design.md)

## Summary

A new `eval` node kind: a **gate-capable judge** that evaluates its wired input(s),
emits a `pass`/`fail` verdict, and either routes the flow via `pass`/`fail` output
ports or halts the run. It delivers the three concepts the user named — quality
gates, verifiers, and comparisons — as a single node kind with a **mode picker**,
where each mode is a **pre-populated, editable prompt template**.

The eval node is the checker with *teeth*, complementing the existing non-blocking
`verify` node (which is unchanged).

## Motivation

pflow already has "checking" nodes, but none of them actually **gate** a workflow:

- `verify` — emits `VERIFY: pass/fail`, **logs it, does not block**. No rubric. A
  note-to-self sanity check.
- `loop` — repeats an upstream span until a **regex sentinel** matches the
  generator's *own* output. This is a partial generate-and-check, but the judge is
  a regex on the producer's text, not a separate grader.
- `branch` — routes to one of several labelled paths based on an LLM decision.

What is missing is a node that (a) judges a candidate against an explicit
criterion, reference, or threshold, and (b) **stops or routes** the flow on the
result — a real quality gate. That is the `eval` node. It also completes the
"Karpathy loop": wire `eval.fail → loop back to the generator`, `eval.pass →
proceed`, with a separate grader rather than a regex on the generator's own prose.

## Relationship to existing nodes

| Node | Role | Gates? | Rubric? | Status |
|------|------|--------|---------|--------|
| `verify` | quick logged sanity check ("note to self") | no | no | **unchanged** |
| `eval` | quality gate / verifier / comparator | yes | yes (in prompt) | **new** |

`verify` keeps its name and behavior. We explicitly did **not** fold it into eval
as a mode — the two-tier model (toothless sanity check vs. gate-with-teeth) is the
point.

## Design

### One generic kind, modes as prompt templates

`eval` is a **single** node kind. A `mode` config field selects one of three
templates. The mode picker is, in effect, a **template chooser**: selecting a mode
pre-populates the node's editable prompt with a template that

1. describes the evaluation operation in plain language, and
2. references plausible `{{in:NAME}}` port tokens.

Ports are then **derived from the prompt** via the existing token machinery
(`parsePromptTokens` → `buildAgentCall`), exactly as for `agent` nodes. The user
sees the full operation and can tweak it. The mode field differentiates `eval`
from `agent` precisely by providing these built-in, gate-oriented templates that
`agent` lacks.

**Accepted trade-off:** because the prompt is freely editable, a user can edit it
into something that no longer evaluates anything — a node that *looks* like a
quality gate but emits no verdict. Static validation cannot catch this (the node
is structurally valid). The mitigation is a **deferred** `check-workflow` command
(see "Deferred" below) that semantically lints node intent.

### The three modes (v1)

All three ship in v1. Each is a starting template; the verdict line is always
`EVAL: pass` / `EVAL: fail` (parallel to `VERIFY:` and `BRANCH:`).

**criteria** — judge a candidate against a rubric written in the prompt.
Ports: `[candidate]` (in). Rubric lives in the prompt body, not a port.
Template:
```
Evaluate {{in:candidate}} against these criteria:
- <criterion 1>
- <criterion 2>
Emit a line exactly: EVAL: pass  (if all criteria are met)  OR  EVAL: fail
```

**comparison** — judge a candidate against a reference/baseline.
Ports: `[candidate, reference]` (in).
Template:
```
Compare {{in:candidate}} against the reference {{in:reference}}.
Emit a line exactly: EVAL: pass  (if the candidate matches/meets the reference)
OR  EVAL: fail. Briefly explain the decisive difference.
```

**threshold** — extract a number and test it against a bound.
Ports: `[candidate]` (in). The dimension/bound live in the prompt body.
Template:
```
Score {{in:candidate}} on <dimension> from 1 to 10.
Emit a line exactly: EVAL: pass  (if the score >= 7)  OR  EVAL: fail.
State the score you assigned.
```
Note: pflow has no structured-metric source yet, so threshold extracts a number
from prose. It is the least-rigorous mode but is a useful scoring primitive for
the Karpathy loop ("score >= 7 → pass, else loop back and improve").

### Ports

- **Inputs:** derived from the active template's tokens. `criteria`/`threshold` →
  `[candidate]`; `comparison` → `[candidate, reference]`. Because ports follow the
  prompt, switching mode rewrites the prompt and re-derives ports; a port that is
  dropped but still wired becomes an **orphan** (dashed wire), identical to the
  existing prompt-edit / kind-change behavior.
- **Outputs:** two ports, `pass` and `fail` (wire-driven routing), reusing the
  branch machinery. The eval node always **logs** its verdict line as well, so a
  trace exists even when no port is wired.

### Gating: ports + halt toggle

The eval node provides **both** routing mechanisms:

1. **`pass`/`fail` output ports** — wire `fail` back to a generator (Karpathy
   loop), to a fix step, or to an alternate path; wire `pass` to proceed. This is
   the flexible, wire-driven gate, reusing the existing branch/loop machinery.
2. **`block on fail` toggle** (config `blockOnFail: boolean`) — when on, a failed
   verdict throws and **halts the run** (a hard quality gate). One click for the
   common "stop the run if this fails" case, no wiring required.

The two compose: with `blockOnFail` on, the `fail` arm still emits but the throw
fires after the verdict is logged.

### Mode switching behavior

Switching mode **always overwrites** the prompt with the new template, guarded by
a confirm dialog when the current prompt is non-empty (the existing `confirmModal`
pattern used by delete and kind-change):

```
prompt non-empty? → confirmModal "Replace prompt with <mode> template?" [Replace] [Keep]
prompt empty?     → fill template directly
```

On **Replace**, the prompt becomes the new template and ports re-derive. On
**Keep**, the `mode` flag still updates but the prompt is preserved — the resulting
prompt/mode mismatch is exactly what the deferred `check-workflow` lint flags
later. Mode reliably *means* its template (predictable), and user edits are never
silently destroyed.

### Codegen

The eval node is a **synthesis of two existing emitters** — no new core machinery:

- **Verdict + log:** the shape of `emitVerify` — `buildAgentCall(doc, node,
  "Emit a verdict line exactly: EVAL: pass  OR  EVAL: fail", overrides)` followed
  by `log(v)`.
- **pass/fail routing:** the shape of `emitBranchRegion` — a fixed two-arm region
  with labelled paths `pass` and `fail`, dispatched by `/EVAL:\s*pass/i` vs
  `/EVAL:\s*fail/i`, with arm reconvergence and pass-through handled by the
  identical region logic already in `emit-kinds.ts`.
- **block on fail:** one guard emitted after the verdict —
  `if (/EVAL:\s*fail/i.test(String(v))) throw new Error("Quality gate failed: <label>");`

Implementation: add an **eval region** to `regions.ts` (paralleling the branch
region: entry = the eval node, two fixed labelled paths `pass`/`fail`) and an
`emitEvalRegion` in `emit-kinds.ts` that composes the verdict, the optional
block-on-fail throw, and the two-arm dispatch. `emitNode` gains a `case "eval"`.

### Schema

`packages/core/src/pflow/schema.ts`:
- add `"eval"` to `NODE_KINDS`.
- the existing freeform `config` carries:
  - `mode`: `"criteria" | "comparison" | "threshold"` (default `"criteria"`).
  - `blockOnFail`: `boolean` (default `false`).

### Editor / visual

- **kind-info.ts:** new `KIND_INFO.eval` entry — **cyan** accent
  (`var(--color-cyan, #2e9bd9)`, joining the verify/synthesize/branch checker
  family) with a **distinct icon** (shield-check or gauge, not verify's
  badge-check). Add `"eval"` to `PROMPT_KINDS`.
- **inspector-pane.svelte:** for eval nodes only, render
  - a **mode dropdown** (criteria / comparison / threshold) that triggers the
    confirm-and-overwrite prompt swap, and
  - a **`block on fail` toggle**.
- **flow-map.ts:** an `applyEvalMode(doc, nodeId, mode)` transform (swap template +
  re-derive ports, mirroring `applyPromptAndDerivePorts`) and an
  `applyBlockOnFail(doc, nodeId, value)` transform. The eval templates live as
  string constants alongside the transforms.

## Testing

- **schema:** an eval node with each mode round-trips through parse/serialize.
- **codegen (criteria):** emits an `EVAL: pass/fail` agent call + `log`, and a
  two-arm `if (/EVAL:\s*pass/i…) … else if (/EVAL:\s*fail/i…)` dispatch.
- **codegen (comparison):** derives two input context blocks (`candidate`,
  `reference`) from the template tokens.
- **codegen (block on fail):** emits the `throw` guard when `blockOnFail` is true,
  and omits it when false.
- **codegen (reconvergence):** an eval node downstream of a branch, and a node
  downstream of an eval node's pass arm, both resolve their source vars correctly
  (the C2-class bug from the MCP work — guard against arm-local dangling vars).
- **ports:** switching mode from comparison to criteria orphans the `reference`
  wire (dashed), like kind-change.
- **flow-map:** `applyEvalMode` replaces the prompt with the template and
  re-derives ports; `applyBlockOnFail` flips the flag.

## Deferred (not in this work)

**`check-workflow` semantic lint** — a perspecta-workflow skill/command that reads
each node's prompt/config and reasons (LLM pass, not regex) about whether the node
actually does its job. For eval nodes specifically: confirm the prompt defines a
real evaluation (judges its `{{in:}}` inputs, emits a pass/fail verdict) and
**flag eval nodes that are not really evaluating**, with a suggested fix. This is
the semantic counterpart to the static `validate.ts` / `mcpLints` (which check
structure). Generalizes beyond eval (empty-prompt agent, unreachable branch arm).

## Out of scope (v1)

- A structured-metric source (threshold extracts from prose for now).
- Multi-criteria scoring breakdowns / weighted rubrics (the prompt can express
  these, but there is no structured config for them).
- Folding `verify` into eval (explicitly rejected — two-tier model is intentional).
