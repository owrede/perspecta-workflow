# pflow — remove "structural ports"; inspector port editor; no pseudo-prompts

Date: 2026-06-07
Branch: `feat/pflow-m2-editor`
Status: approved direction, spec for review

> Scope note: this spec now covers THREE coupled changes — (A) remove structural
> ports (control-flow inferred from wiring), (B) an inspector port editor
> (add/remove/retype) as the universal port-definition mechanism, (C) no text
> field on plumbing kinds. They share the port-derivation rewrite, so they ship
> together.

## Motivation

The editor is for authoring workflows from a blank canvas: a user adds nodes and
defines their ports via prompt tokens (`{{in:name}}` / `{{out:name}}`). Today the
control-flow kinds (loop, branch, synthesize, split, join) carry **structural
ports** — fixed port ids the plugin's port-derivation refuses to remove (e.g. a
loop's `draft` input and `fix` output). These ports:

- appear on a freshly-dropped node that the user never created,
- cannot be removed by editing the prompt (removing `{{out:fix}}` leaves `fix`),
- are not derivable from the prompt, contradicting "the prompt declares the
  interface."

The user correctly identified this as wrong: on an empty canvas there is no
source for a "structural" port. Ports must ALWAYS be user-defined.

## Key finding (grounds the whole change)

The **codegen already infers control-flow from wiring/topology, not from port
names** (`packages/core/src/pflow/regions.ts`):

- `findLoopRegions` finds the back-edge by detecting a CYCLE (`reaches`), not by
  looking for a port named `fix`.
- `findBranchRegions` reads paths from whatever outputs are wired; the path label
  is `port.name` (arbitrary, user-chosen).
- `findSplitJoinRegions` matches split→join by reachability.

And `emit-kinds.ts` references NO specific port names/ids — it emits purely from
the region structure (`backEdge`, `memberIds`, `paths`).

Therefore the codegen does **not** need structural ports. `STRUCTURAL_PORT_IDS`
only constrains the plugin's `derivePortsFromPrompt`. Removing the concept is
mostly a plugin change; the codegen is essentially unchanged.

## Design

### 1. Port derivation (plugin) — treat ALL kinds like agent

In `derivePortsFromPrompt` (`flow-map.ts`):

- Drop the `STRUCTURAL_PORT_IDS` protection. EVERY kind derives its ports from
  `{{in:}}`/`{{out:}}` tokens.
- The default-fallback (already added for agent) generalizes:
  - A node with no `{{in:}}` token (and no wired input) keeps a default `in`
    port — EXCEPT `input` kind (source-only, no inputs).
  - A node with no `{{out:}}` token (and no wired output) keeps a default `out`
    port — EXCEPT `output` kind (sink-only, no outputs).
- `input`/`output` kinds keep their direction constraint (input: outputs only;
  output: inputs only) — these aren't "structural", they're the kind's nature.
- Orphan handling is unchanged (a wired port no longer declared → orphan/dashed).

`STRUCTURAL_PORT_IDS` is removed from `@perspecta/core` (or kept unused and
deprecated; prefer removal to avoid drift). `dedupeStructuralPorts` is reworked
or removed: with no structural ports, the duplicate-name healing becomes a plain
"no two ports share a name within a side" dedup (still useful — keep it, renamed
`dedupeDuplicateNamedPorts`, deduping by name keeping the first).

### 2. Codegen — confirm topology inference is robust to free port names

No intended change. But VERIFY:

- A loop whose back-edge port is named anything (not `fix`) still detected — it
  is, because `findLoopRegions` uses the cycle, not the name. Add a test with a
  differently-named back-edge port.
- A loop's loop-carried variable hoisting (`emitLoopRegion`) keys on member node
  ids, not port names — confirm.
- Branch paths labelled by arbitrary output names still dispatch — they do
  (`p.label = port.name`), the BRANCH sentinel uses the label. Add a test.

### 3. Migration fixtures — re-author without structural ports

The 3 faithful fixtures currently hand-write loop/branch ports with the old fixed
ids (loop `in`/`out` named `draft`/`fix`; branch `in` + `long`/`ok`). Re-author
so those nodes' ports come from tokens too:

- The loop's prompt declares its ports with tokens; its back-edge output and
  carried input get token-derived ids (`out:fix`, `in:draft`). The wiring (the
  back-edge cycle) is unchanged, so region detection still fires.
- The branch's outputs (`long`/`ok`) become token-derived; the dispatch labels
  are still the port names.

Then: regenerate goldens; VERIFY BY RUNNING all 3 (loop cycles, both branch arms,
2-loop natebjones) — same discipline as before.

### 4. Node creation defaults

`defaultPortsForKind` (used by `applyAddNode`): a freshly-added node of any
control-flow kind should arrive with the SAME minimal default as an agent — one
`in`, one `out` — NOT pre-baked structural ports. (input: out only; output: in
only.) The user then declares real ports via tokens. Confirm `applyAddNode` uses
this and no kind injects extra ports.

## 5. Inspector port editor (B) — the universal mechanism

The inspector's Ports section becomes editable for EVERY kind:

- **Add port**: an "+ Add input" / "+ Add output" control. Creates a port with a
  generated unique id (`in:<name>` / `out:<name>` once named; a transient id
  until named), default type `string`, editable name + type. For an `input`
  kind only outputs are addable; for `output` kind only inputs (their nature).
- **Type picker** per port: `string | json | table` dropdown. Changing it:
  - updates the port's `schema.type`,
  - AND, if the port has a token in the prompt, rewrites that token's suffix
    (`{{in:x}}` ↔ `{{in:x:json}}`) so prompt and inspector stay consistent.
- **Rename** per port: editable name. If token-backed, rewrites the token name
  in the prompt too.
- **Remove** per port — governed by the lock rule below.

### Token-lock rule (the sync invariant)

A port is **token-locked** when a matching `{{dir:name}}` token exists in the
node's prompt. The editor enforces:

- Token-locked port → **no Remove control** (shown with a small "from prompt"
  badge). To remove it, delete the token from the prompt.
- Inspector-only port (no token) → **Remove control present**. Removing it drops
  the port (and any wire on it). If the user later types its token, it becomes
  token-locked and Remove disappears.
- Adding a port in the inspector does NOT write a token (inspector-only ports are
  allowed on prompt-bearing nodes). Typing the token is what locks it.

`derivePortsFromPrompt` must therefore MERGE two sources for prompt-bearing kinds:
token-derived ports (locked) + inspector-defined ports (carried on the node,
unlocked) + orphans. For plumbing kinds, only inspector-defined ports + orphans
(no tokens exist). Represent the lock as a derived UI property (a port is locked
iff its name appears as a token in the current prompt) — NOT a stored flag, so it
can never drift from the prompt.

## 6. No text field on plumbing kinds (C)

PROMPT kinds (agent, verify, synthesize, loop, branch) keep the prompt field.
PLUMBING kinds (input, output, split, join) show **no prompt/dataflow field** in
the inspector — only the port editor. Rationale: a text field on a node that
emits no LLM call would mislead users into thinking the prose has effect.

`PROMPT_KINDS` (in kind-info.ts) already gates the inspector's Prompt section —
it lists exactly agent/verify/synthesize/loop/branch. So this is already correct
for the field's VISIBILITY; the change is ensuring plumbing-kind ports are fully
managed by the port editor (section 5) since they have no token path.

Detect-ports button: only shown for prompt-bearing kinds (it scans a prompt).

## What does NOT change

- Region detection algorithm (cycle/reachability based) — already name-agnostic.
- `emit-kinds.ts` emit logic.
- The token grammar, typed tokens, dashed orphan wires, red mismatch wires,
  multi-output protocol, Detect-ports button.

## Risks

- A loop with NO back-edge wiring is no longer "a loop with structural ports" —
  it's a node whose region won't be detected, and `emitNode` throws the existing
  "must be emitted as part of a control-flow region" error. That's correct: an
  unwired loop is genuinely incomplete. The editor should still let you build it
  incrementally (the error is at codegen/export, not in the editor).
- Re-authoring the fixtures could surface a codegen assumption I haven't found.
  Mitigated by running each generated workflow (the established discipline).

## Testing & gate

- Unit (derivation): every kind derives tokens → ports; default in/out fallback;
  input/output direction constraint; merge of token-locked + inspector-only ports
  on prompt kinds; plumbing kinds keep only inspector ports + orphans.
- Unit (port editor helpers, pure in flow-map): `applyAddPort`,
  `applyRemovePort` (refuses/oops on token-locked), `applyPortType` (rewrites
  token suffix when token-backed), `applyPortRename` (rewrites token), and a
  `isPortTokenLocked(node, port)` predicate.
- Unit (control-flow name-agnostic): back-edge detection with a non-`fix` port
  name; branch dispatch with arbitrary labels.
- Codegen: regenerate + RUN all 3 migrations (loop, branch arms, dual-loop).
- Full build + both typechecks + suites green; deploy byte-identical; manual:
  (1) drop a fresh loop → only default in/out, no `draft`/`fix`; (2) add a port
  in the inspector on an input node (no prompt field shown); (3) type a token →
  its port's Remove disappears; (4) change a token-backed port's type → the
  prompt token gains the suffix; (5) removing the token re-enables Remove.

## Out of scope

- A token syntax to explicitly mark "this is the loop-back output" — not needed,
  the cycle in the wiring already identifies it.
- Changing how branch labels are chosen (still the output port name).
