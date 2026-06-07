# pflow — `{{in:}}` / `{{out:}}` prompt-token ports

Date: 2026-06-07
Branch: `feat/pflow-m2-editor`
Status: approved design, pre-implementation

## Motivation

Today an agent's ports are abstract: the card shows knobs, but nothing ties a
knob to the prose that uses it. The user wants the **prompt to declare the
interface**: writing `{{in:meeting_note}}` or `{{out:summary}}` in a prompt
creates the corresponding input/output port (a knob on the card), and the token
text is coloured in the prompt so the prompt and the graph tell the same story.

This is fundamentally a **readability** feature, not just a codegen convenience:

- Wires gain meaning — a wire reads as "A's `summary` → B's `context`", not just
  "A → B".
- The prompt and the graph cannot drift: the port name IS the token in the prose.
- Fan-out is legible: `{{out:summary}}` + `{{out:actions}}` show two knobs going
  two places — the reader sees the dataflow branch.

**Design principle (load-bearing):** reading the prompt and reading the graph
must tell the same story. The knob label is exactly the token name (no
sanitised suffix shown), and codegen replaces a token in place so the value
lands where the prose put it.

## Decisions (from brainstorming Q&A)

1. **Port source per kind:**
   - `agent`: tokens REPLACE ports. No tokens → fall back to the single default
     `in`/`out` (today's behaviour).
   - `loop` / `branch` / `synthesize` / `split` / `join`: tokens ADD named ports;
     the kind's STRUCTURAL ports are always preserved (codegen + the 3 faithful
     migrations depend on them).
2. **Re-derive on a debounce** after typing settles (not every keystroke).
3. **Wire on token rename/delete:** the wire is KEPT; its now-unbacked port
   lingers as an ORPHAN port (shown, muted) until the user clears it. The wire
   renders as a DASHED line (inactive).
4. **Prompt UI:** a `contenteditable` div with `{{in:…}}`/`{{out:…}}` (braces
   included) wrapped in coloured spans (in = green-ish, out = accent).
5. **Codegen — input token:** REPLACE the token inline with the wired value
   (`${source}`), where the prose put it. (Untokened wired inputs still append
   as `<context>` blocks as today.)
6. **Codegen — output tokens (multi-output):**
   - One output token → the agent's whole result IS that output (today's
     behaviour, just named). No delimiter ceremony.
   - 2+ output tokens → codegen instructs the agent to emit each output inside a
     delimiter, then the generated code parses the result into per-output vars.
   - Missing section on parse → empty string (graceful, debuggable).

## Amendment (2026-06-07) — typed tokens

After Phases 1–5 shipped, the design gained **typed tokens**. This amendment
supersedes the "all token ports are `{type:"any"}`" line in Out of scope and the
original grammar; the orphan/dashed-wire/contenteditable decisions are unchanged.

### Typed token grammar (suffix form)

`{{in:NAME}}` / `{{out:NAME}}` → type **string** (default; unchanged behaviour).
`{{in:NAME:TYPE}}` / `{{out:NAME:TYPE}}` → typed, where `TYPE ∈ {string, json,
table}`. `NAME = [A-Za-z_][A-Za-z0-9_-]*`; `TYPE` is a fixed keyword. No
whitespace inside the braces. `parsePromptTokens` returns, per direction, a list
of `{ name, type }` (type defaults to `"string"`). De-duplicated by name; if the
same name appears with two types, the FIRST occurrence's type wins (and a future
validation may flag the conflict — out of scope here).

### Type vocabulary — exactly three

Rationale: to the LLM every value is text, so filename/path/note-name
distinctions evaporate (all strings, resolved by prose + tools, not codegen).
The only axis that changes generated code is flat-vs-structured serialization.

- **string** — bare `${value}` interpolation (today).
- **json** — in-port: `${JSON.stringify(value, null, 2)}`. out-port: the agent
  is instructed to emit valid JSON for that output.
- **table** — in-port: the value is rendered as a Markdown table before
  interpolation (a small deterministic renderer in the generated code; falls back
  to JSON if the value isn't tabular). out-port: the agent is instructed to emit
  a Markdown table.

The port's `schema.type` reflects the token type: string → `{type:"string"}`,
json → `{type:"object"}` (structured), table → `{type:"array"}` (rows). (These
are the closest existing PortSchema shapes; exactness isn't load-bearing — the
token TYPE keyword, carried on the port, drives codegen, not the schema.)

### Type-mismatch wires (red, non-blocking)

When an `out` port of type T1 is wired into an `in` port of type T2 and T1 ≠ T2,
the connector renders **red** (a third edge state beside normal and
dashed-orphan). The wire is allowed and codegen still runs — a lint, matching the
dashed-orphan precedent. `toFlowEdges` gains a `typeMismatch` flag on `data`
alongside `inactive`; `PflowEdge` renders red when set. `string`↔`string` and
exact-type matches are clean; any structured/flat or json/table cross is a
mismatch.

### Detect-ports button (inspector)

A deterministic stand-in for a future LLM pass (no API key wired). For each of the
node's CURRENT ports, if the port name appears anywhere in the prompt text and is
not already tokenised, wrap that occurrence as the matching token (using the
port's type to pick the suffix). Triggered by a button in the inspector's Prompt
section. The LLM-backed semantic detection is explicitly deferred.

### Migration fixtures

The 3 faithful fixtures are re-authored to embed typed tokens matching their
ports; goldens are regenerated; correctness is proven by RUNNING the generated
workflows (this supersedes the earlier "keep byte-identical" intent, which the
typed-inline direction made obsolete — inline replacement necessarily changes the
generated text).

## Scope & files

Phased. Each phase is independently testable.

### Phase 1 — token parsing (pure, `@perspecta/core`)
- `packages/core/src/pflow/tokens.ts` (new): `parsePromptTokens(prompt): {
  inputs: string[]; outputs: string[] }` — ordered, de-duplicated token names.
  Regex `{{(in|out):(NAME)}}` with `NAME = [A-Za-z_][A-Za-z0-9_-]*`. Exported
  `TOKEN_RE` for the highlighter to reuse (single source of truth for the
  grammar). Also `STRUCTURAL_PORT_IDS: Record<NodeKind, { inputs: string[];
  outputs: string[] }>` capturing each kind's protected port ids (derived from
  the current default-port shapes), used by the "add, never remove structural"
  rule.
- Tests: `packages/core/test/pflow/tokens.test.ts`.

### Phase 2 — port derivation (plugin, `flow-map.ts`)
- `derivePortsFromPrompt(node): { inputs: Port[]; outputs: Port[]; orphans:
  { inputs: Port[]; outputs: Port[] } }` — given a node, compute the ports its
  current prompt implies, following the per-kind rule (Decision 1). A derived
  port's id is `in:NAME` / `out:NAME` (stable while NAME unchanged), name =
  NAME, schema `{ type: "any" }`. Orphan ports = ports currently referenced by a
  wire but no longer present in the derived set (and not structural).
- `applyPromptEdit` is EXTENDED (or a sibling `applyPromptAndDerivePorts` is
  added) so that committing a prompt edit also re-derives the node's ports,
  preserving wires and surfacing orphans. Orphan ports are marked on the Port
  with `orphan?: true` (additive schema field) so the card/edge/inspector can
  render them muted/dashed and offer "clear".
- Tests: extend `packages/obsidian-plugin/test/flow-map.test.ts`.

### Phase 3 — schema additions (`@perspecta/core`)
- `Port` gains `orphan?: boolean` (additive, optional). Backward-compatible.
- Tests: extend `packages/core/test/pflow/schema.test.ts`.

### Phase 4 — dashed orphan wires (plugin)
- `toFlowEdges` marks an edge whose source OR target port is an orphan with a
  data flag (e.g. `data.inactive = true`); `FlowEdge` carries it.
- `PflowEdge.svelte` renders `stroke-dasharray` and drops/greys the marker when
  `data.inactive`. (BaseEdge `style` / a class on the path.)
- Tests: extend `flow-map.test.ts` (edge carries the flag); visual for the dash.

### Phase 5 — contenteditable coloured prompt (plugin)
- `prompt-field.svelte` (new): a `contenteditable` div that renders the prompt
  with `{{in:…}}`/`{{out:…}}` wrapped in coloured spans, emits the plain-text
  prompt on input (debounced), and handles the contenteditable hazards
  (caret-restore after re-render, paste-as-plain-text, Enter→newline). Replaces
  the `<textarea>` in the inspector's Prompt section.
- Colours: in = `var(--color-green)`, out = `var(--interactive-accent)`, via the
  existing kind-info colour vocabulary where possible.
- No unit test (no component harness); verified by build + manual, per prior
  inspector work.

### Phase 6 — codegen (`@perspecta/core`)
- Input token: `buildAgentCall` replaces each `{{in:NAME}}` in the prompt text
  with `${sourceExprForPortName(NAME)}` (the wired source for the port named
  NAME), instead of appending a `<context>` block for that port. Untokened wired
  ports keep the append behaviour. A tokened-but-UNWIRED port interpolates `""`.
- Output tokens:
  - 0 or 1 output token → unchanged (single result var).
  - 2+ → append a delimiter instruction to the prompt (emit each output as
    `<<<out:NAME>>>\n…\n<<<end>>>`), and after the `await agent(...)` call emit a
    deterministic parse: a small pure splitter (regex/string ops only — no
    banned tokens) producing `const NAME = extract(result, "NAME")` per output,
    missing → `""`. Downstream wires from `out:NAME` read the `NAME` var.
- Re-verify the 3 faithful migrations EXECUTE unchanged (they use named ports
  but no `{{ }}` tokens, so parsing yields no tokens → behaviour identical).
  Regenerate golden fixtures only if output legitimately changes; review any diff.
- Tests: `packages/core/test/codegen/*` — token-input weaving, multi-output
  parse (execute the generated code to prove the split works and missing → "").

## Token grammar

`{{in:NAME}}` and `{{out:NAME}}`, `NAME = [A-Za-z_][A-Za-z0-9_-]*`. Case-sensitive.
Whitespace inside the braces is NOT allowed (keeps the highlighter simple and the
grammar unambiguous while typing). De-duplicated by name, first-occurrence order.

## Edge cases

- **Typing churn:** debounce re-derivation so `{{in:sub|ject}}` mid-type doesn't
  thrash ports. The highlighter colours only COMPLETE tokens.
- **Duplicate names:** `{{in:x}}` twice → one port `x`; codegen replaces BOTH
  occurrences with the same source expression.
- **Same name in and out** (`{{in:x}}` + `{{out:x}}`): allowed — distinct ports
  (`in:x` vs `out:x`), distinct knobs.
- **Structural kinds:** a `loop` with `{{in:foo}}` keeps its structural `draft`
  input/`fix` output AND gains `foo`. Clearing the token removes only `foo`.
- **Orphan clear:** the inspector Ports section lists orphan ports with a
  "remove" control that drops the port and its wire.

## Testing & gate

- Unit: token parser, port derivation (all per-kind rules, orphan detection),
  schema additions, edge-flag mapping.
- Codegen: EXECUTE generated workflows (the established discipline) — token-input
  interpolation lands the value in place; 2+ outputs parse into distinct vars;
  missing section → "". Re-execute all 3 faithful migrations: byte-identical
  output (no tokens → no behaviour change).
- Build + both typechecks + full suites green; deploy byte-identical to both
  vaults; manual: type a token, see the knob appear and the text colour; rename a
  wired token, see the wire go dashed + orphan port; clear the orphan.

## Out of scope

- Token autocomplete / validation UI beyond colouring.
- ~~Typed ports from tokens~~ — NOW IN SCOPE via the 2026-06-07 amendment
  (string/json/table). The richer type taxonomy (path, note-name, filename)
  remains out of scope: those are all strings to the LLM and would only drive
  wiring validation, not codegen.
- Tokens in non-prompt fields (workflow description, config bodies).
- Whitespace-tolerant or namespaced token grammar.
