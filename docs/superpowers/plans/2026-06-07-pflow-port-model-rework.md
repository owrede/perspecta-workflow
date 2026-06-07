# pflow Port-Model Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove "structural ports"; make the inspector port editor the universal way to define ports (add/remove/retype) on every kind; no text field on plumbing kinds; tokens and inspector stay in sync via a derived token-lock rule.

**Architecture:** Control-flow is already inferred from wiring (regions.ts) and emit-kinds.ts uses no port names — so structural ports are only a plugin-side derivation constraint. We drop that constraint, generalize the default in/out fallback to all kinds, add pure port-editor helpers in flow-map.ts (with a derived `isPortTokenLocked` predicate), wire an editable Ports section in the inspector, and re-author the 3 fixtures. Codegen is essentially unchanged; correctness proven by running.

**Tech Stack:** Svelte 5 runes, Zod, @xyflow/svelte, vitest, the deterministic codegen pipeline.

---

## Phase 1 — Derivation: drop structural ports, generalize fallback

### Task 1.1: `derivePortsFromPrompt` treats all kinds uniformly + merges inspector-only ports

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

New rule:
- Ports = token-derived ports (from `{{in:}}`/`{{out:}}`) ∪ inspector-defined
  ports already on the node that are NOT token-derived and NOT structural-magic
  (there is no structural magic anymore) ∪ orphans (wired, undeclared).
- An existing node port is "inspector-defined" if its id is NOT a token id for a
  CURRENT token. We keep every current port unless it's a token-duplicate by
  name (the dedup) — i.e. tokens and existing ports merge by NAME.
- Default fallback (per side, all kinds except input/output direction):
  no `{{in:}}` token AND no input port at all → default `in`; same for out.
  `input` kind: never add inputs. `output` kind: never add outputs.

- [ ] **Step 1: Write failing tests** — replace the structural-kind tests, add merge/fallback tests:

```ts
describe("derivePortsFromPrompt (no structural ports)", () => {
  it("loop derives ports from tokens only — no hardcoded draft/fix", () => {
    const loop = { id: "lp", kind: "loop" as const, label: "L", prompt: "Emit {{out:verdict}} from {{in:work}}.", inputs: [], outputs: [] };
    const r = derivePortsFromPrompt(loop, []);
    expect(r.inputs.map((p) => p.id)).toEqual(["in:work"]);
    expect(r.outputs.map((p) => p.id)).toEqual(["out:verdict"]);
  });
  it("loop with no out-token keeps a default out (fallback applies to all kinds)", () => {
    const loop = { id: "lp", kind: "loop" as const, label: "L", prompt: "Process {{in:work}}.", inputs: [], outputs: [] };
    const r = derivePortsFromPrompt(loop, []);
    expect(r.outputs.map((p) => p.id)).toEqual(["out"]);
  });
  it("merges an inspector-only (token-less) port with token ports", () => {
    // node already has an inspector-added port `extra` (id in:extra) with no token
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "Use {{in:topic}}.", inputs: [{ id: "in:extra", name: "extra", schema: { type: "string" as const } }], outputs: [] };
    const r = derivePortsFromPrompt(node, []);
    expect(r.inputs.map((p) => p.id).sort()).toEqual(["in:extra", "in:topic"].sort());
  });
  it("input kind never gains an input; output kind never gains an output", () => {
    const inp = { id: "in", kind: "input" as const, label: "In", prompt: "", inputs: [], outputs: [] };
    expect(derivePortsFromPrompt(inp, []).inputs).toEqual([]);
    const outp = { id: "o", kind: "output" as const, label: "Out", prompt: "", inputs: [], outputs: [] };
    expect(derivePortsFromPrompt(outp, []).outputs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify fail** (`npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`).

- [ ] **Step 3: Rewrite `derivePortsFromPrompt`.** Remove the `STRUCTURAL_PORT_IDS` import and usage. New body:

```ts
export function derivePortsFromPrompt(
  node: { id: string; kind: NodeKind; prompt?: string; inputs: Port[]; outputs: Port[] },
  wires: Wire[],
): { inputs: Port[]; outputs: Port[] } {
  const { inputs: inToks, outputs: outToks } = parsePromptTokens(node.prompt ?? "");
  const tokenInput = (t: TokenPort): Port => ({ id: `in:${t.name}`, name: t.name, schema: { type: portSchemaTypeForToken(t.type) }, required: false });
  const tokenOutput = (t: TokenPort): Port => ({ id: `out:${t.name}`, name: t.name, schema: { type: portSchemaTypeForToken(t.type) } });
  const wiredInIds = new Set(wires.filter((w) => w.to.nodeId === node.id).map((w) => w.to.portId));
  const wiredOutIds = new Set(wires.filter((w) => w.from.nodeId === node.id).map((w) => w.from.portId));

  function build(toks: TokenPort[], make: (t: TokenPort) => Port, current: Port[], wiredIds: Set<string>): Port[] {
    const out: Port[] = [];
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();
    const add = (p: Port, orphan: boolean) => { out.push({ ...p, orphan }); seenIds.add(p.id); seenNames.add(p.name); };
    // 1) token ports (the locked, prompt-declared ones)
    for (const t of toks) { const p = make(t); if (!seenNames.has(p.name)) add(p, false); }
    // 2) inspector-defined ports already on the node, not duplicating a token name
    for (const cur of current) {
      if (seenIds.has(cur.id) || seenNames.has(cur.name)) continue;
      // a wired-but-undeclared port becomes an orphan; an unwired one is an
      // inspector-only port (kept as-is).
      const isOrphanCandidate = wiredIds.has(cur.id) && !toks.some((t) => `${cur.id}`.startsWith(cur.id));
      add(cur, false); // keep inspector ports; orphan-ness re-evaluated below
    }
    // 3) mark orphans: a wired current port whose name is not token-backed and
    //    whose id is a token-style id (in:/out:) that no longer has a token.
    return out.map((p) => {
      const tokenBacked = toks.some((t) => make(t).id === p.id);
      const looksTokenId = /^(in|out):/.test(p.id);
      const orphan = !tokenBacked && looksTokenId && wiredIds.has(p.id) && !toks.some((t) => t.name === p.name);
      return orphan ? { ...p, orphan: true } : { ...p, orphan: false };
    });
  }

  let inputs = build(inToks, tokenInput, node.inputs, wiredInIds);
  let outputs = build(outToks, tokenOutput, node.outputs, wiredOutIds);

  // default fallback, per side, for every kind EXCEPT the direction the kind lacks
  if (node.kind !== "input" && inputs.length === 0) inputs = [{ id: "in", name: "in", schema: { type: "any" }, required: true }];
  if (node.kind !== "output" && outputs.length === 0) outputs = [{ id: "out", name: "out", schema: { type: "any" } }];
  // input has no inputs; output has no outputs
  if (node.kind === "input") inputs = [];
  if (node.kind === "output") outputs = [];
  return { inputs, outputs };
}
```

NOTE: simplify the orphan logic if the above is over-complex during
implementation — the test cases define the required behavior; keep them green.
The essential merge is: token ports + existing non-duplicate ports, with the
per-side default fallback, and input/output direction constraints.

- [ ] **Step 4: Run — verify pass.** Adjust any earlier test that assumed structural ports (e.g. the old "structural kind: tokens ADD" test) to the new model.

- [ ] **Step 5: Remove `STRUCTURAL_PORT_IDS` from core.** Delete it from `packages/core/src/pflow/tokens.ts` and its export. Rebuild core. Fix any other importer (search: `rg STRUCTURAL_PORT_IDS`).

- [ ] **Step 6: Rework `dedupeStructuralPorts` → `dedupeDuplicateNamedPorts`.** Without structural ids, the heal becomes "no two ports share a name within a side; keep the first". Update its body + the `view.ts` import + its tests. Keep the load-time call.

- [ ] **Step 7: `defaultPortsForKind` — minimal default for all kinds.** Ensure it returns `{in},{out}` for every non-input/output kind (no special loop/branch ports). Confirm `applyAddNode`/`applyKindChange` use it and inject nothing extra. Update tests asserting old loop/branch defaults.

- [ ] **Step 8: Run full plugin + core suites; commit.**

```bash
git add -A && git commit -m "feat(pflow): remove structural ports; ports derive uniformly + per-side default fallback"
```

---

## Phase 2 — Control-flow detection robustness (name-agnostic)

### Task 2.1: prove regions detect with arbitrary port names

**Files:**
- Test: `packages/core/test/pflow/regions.test.ts` (or codegen tests)

- [ ] **Step 1: Add tests** — a loop whose back-edge output is named `verdict`
  (not `fix`) is still detected; a branch with outputs named `pathA`/`pathB`
  dispatches on those labels.

```ts
it("detects a loop back-edge regardless of port name", () => {
  // build a 2-node loop with output named 'verdict' wired back; assert analyzeRegions finds 1 loop region
});
it("branch dispatches on arbitrary output names", () => {
  // branch with outputs 'pathA'/'pathB'; generated code has /BRANCH:\s*pathA/ and /BRANCH:\s*pathB/
});
```

- [ ] **Step 2: Run.** These SHOULD pass already (detection is wiring-based).
  If any fails, fix the detection to not assume names. Commit only if a fix was
  needed; otherwise the tests stand as regression guards.

```bash
git add -A && git commit -m "test(pflow): control-flow detection is port-name-agnostic"
```

---

## Phase 3 — Port-editor helpers (pure, flow-map.ts)

### Task 3.1: `isPortTokenLocked` + add/remove/rename/retype

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

The derived lock predicate and four mutations. Token rewriting reuses the token
grammar (build `{{dir:name}}` / `{{dir:name:type}}`).

- [ ] **Step 1: Write failing tests:**

```ts
describe("port editor helpers", () => {
  const agent = (prompt: string, inputs = [], outputs = []) => ({ id: "ag", kind: "agent" as const, label: "A", prompt, inputs, outputs });

  it("isPortTokenLocked: true when a matching token exists", () => {
    const n = agent("Use {{in:topic}}.", [{ id: "in:topic", name: "topic", schema: { type: "string" as const } }]);
    expect(isPortTokenLocked(n, n.inputs[0], "in")).toBe(true);
  });
  it("isPortTokenLocked: false for an inspector-only port", () => {
    const n = agent("plain", [{ id: "in:extra", name: "extra", schema: { type: "string" as const } }]);
    expect(isPortTokenLocked(n, n.inputs[0], "in")).toBe(false);
  });
  it("applyAddPort adds an inspector-only port (no token written)", () => {
    const doc = /* DOC with ag */;
    const next = applyAddPort(doc, "ag", "in", "extra", "string");
    const ag = next.nodes.find((n) => n.id === "ag")!;
    expect(ag.inputs.some((p) => p.name === "extra")).toBe(true);
    expect(ag.prompt).not.toContain("{{in:extra}}"); // no token written
  });
  it("applyRemovePort removes an inspector-only port; refuses a token-locked one", () => {
    // locked: prompt has {{in:topic}} -> removing returns the doc unchanged (or throws-as-noop)
    // unlocked: removed
  });
  it("applyPortType on a token-backed port rewrites the token suffix", () => {
    const doc = /* ag, prompt 'Use {{in:topic}}.' */;
    const next = applyPortType(doc, "ag", "in", "topic", "json");
    expect(next.nodes.find((n) => n.id === "ag")!.prompt).toContain("{{in:topic:json}}");
  });
  it("applyPortRename on a token-backed port rewrites the token name", () => {
    const next = applyPortRename(/*doc*/, "ag", "in", "topic", "subject");
    expect(next.nodes.find((n) => n.id === "ag")!.prompt).toContain("{{in:subject}}");
  });
});
```

- [ ] **Step 2: Run — verify fail.**

- [ ] **Step 3: Implement** in flow-map.ts:

```ts
/** A port is token-locked when the node's prompt declares a matching token. */
export function isPortTokenLocked(node: { prompt?: string }, port: Port, dir: "in" | "out"): boolean {
  const toks = parsePromptTokens(node.prompt ?? "");
  const list = dir === "in" ? toks.inputs : toks.outputs;
  return list.some((t) => t.name === port.name);
}

/** Add an inspector-only port (no token written). Immutable. Skips input-kind
 *  inputs / output-kind outputs. Generates id `<dir>:<name>`. */
export function applyAddPort(doc, nodeId, dir, name, type): PflowDocument { /* ... */ }

/** Remove a port — but only if NOT token-locked. A token-locked port returns the
 *  doc unchanged (the UI hides Remove for it; this is a safety net). Drops wires
 *  on the removed port. Immutable. */
export function applyRemovePort(doc, nodeId, dir, portId): PflowDocument { /* ... */ }

/** Change a port's type. Updates schema.type; if the port is token-backed,
 *  rewrites the token in the prompt to carry the new suffix (string => no
 *  suffix). Immutable. */
export function applyPortType(doc, nodeId, dir, name, type): PflowDocument { /* ... */ }

/** Rename a port. Updates name + id; if token-backed, rewrites the token name in
 *  the prompt. Re-points wires from the old id to the new id. Immutable. */
export function applyPortRename(doc, nodeId, dir, oldName, newName): PflowDocument { /* ... */ }
```

Token rewriting helper (shared): given a prompt, dir, name, produce a new prompt
with `{{dir:name(:oldtype)?}}` replaced by `{{dir:newname(:newtype)?}}`. Build a
regex from the token grammar; replace all matches for that name+dir.

- [ ] **Step 4: Run — verify pass.**

- [ ] **Step 5: Commit.**

```bash
git add -A && git commit -m "feat(pflow-editor): pure port-editor helpers + isPortTokenLocked"
```

---

## Phase 4 — Inspector port editor UI

### Task 4.1: editable Ports section + wire handlers

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte`
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte`
- (No unit test — Svelte UI; verified by build + manual, per prior inspector work.)

- [ ] **Step 1: New props on InspectorPane.** Add callbacks:
  `onAddPort(nodeId, dir, name, type)`, `onRemovePort(nodeId, dir, portId)`,
  `onPortType(nodeId, dir, name, type)`, `onPortRename(nodeId, dir, oldName, newName)`.
  The node's full `inputs`/`outputs` + `prompt` are already in `node.data`.

- [ ] **Step 2: Rewrite the Ports section markup.** For each input and output:
  - editable name (text input → `onPortRename` on commit),
  - type `<select>` (string/json/table → `onPortType`),
  - a "from prompt" badge when `isPortTokenLocked(node.data, port, dir)`,
  - a Remove button ONLY when NOT token-locked (→ `onRemovePort`).
  - Below each list: an "+ Add input" / "+ Add output" button (→ `onAddPort`
    with a generated unique name like `in1`, type `string`). Hidden for the
    direction the kind lacks (input: no inputs add; output: no outputs add).
  Import `isPortTokenLocked` from flow-map.

- [ ] **Step 3: Prompt section visibility.** Already gated by `PROMPT_KINDS`
  (`showPrompt`). Confirm plumbing kinds (input/output/split/join) show NO prompt
  field and NO Detect-ports button — only the Ports section. (PROMPT_KINDS
  already excludes them; verify split/join are excluded — they are.)

- [ ] **Step 4: Wire handlers in editor.svelte.** Add the four functions calling
  the flow-map helpers via `commit(...)`, pass them to InspectorPane.

```ts
function onAddPort(nodeId, dir, name, type) { commit(applyAddPort(doc, nodeId, dir, name, type)); }
function onRemovePort(nodeId, dir, portId) { commit(applyRemovePort(doc, nodeId, dir, portId)); }
function onPortType(nodeId, dir, name, type) { commit(applyPortType(doc, nodeId, dir, name, type)); }
function onPortRename(nodeId, dir, oldName, newName) { commit(applyPortRename(doc, nodeId, dir, oldName, newName)); }
```

- [ ] **Step 5: Style the editor rows** with Obsidian tokens (reuse the existing
  `.pflow-insp__port` styles; add a small `.pflow-insp__port-badge`,
  `.pflow-insp__port-remove`, `.pflow-insp__add-port` button).

- [ ] **Step 6: Build + typecheck + full suite; confirm markers in bundle.**

- [ ] **Step 7: Commit.**

```bash
git add -A && git commit -m "feat(pflow-editor): editable inspector port editor (add/remove/retype, token-lock)"
```

---

## Phase 5 — Re-author the 3 fixtures without structural ports

### Task 5.1: meeting-followup, person-brief, natebjones-delta

**Files:**
- Modify: the 3 `*-faithful.pflow` fixtures
- Verify: their migration tests + run-the-code

- [ ] **Step 1: meeting-followup.** The loop (`review`) currently has ports
  `draft`(in)/`out`(name fix). Re-author so the loop's ports are token-derived:
  give it a prompt declaring `{{in:draft}}` and `{{out:fix}}`, set its port ids to
  `in:draft`/`out:fix`, and update the back-edge + forward wires to those ids.
  The back-edge cycle is unchanged → loop still detected.

- [ ] **Step 2: Generate + RUN meeting-followup.** Assert the review loop cycles
  (fail→fix→pass) and returns the saved path. (Use the run harness pattern from
  tokens.test.ts / scriptgen.test.ts.)

- [ ] **Step 3: person-brief.** The branch (`length`) has `draft`(in) +
  `long`/`ok`(out). Re-author so the branch declares them as tokens (the labels
  `long`/`ok` stay the output names → dispatch unchanged). Update wires to the
  new ids. Generate + RUN both arms (long→condense, ok→passthrough).

- [ ] **Step 4: natebjones-delta.** Two loops (`precond`, `propagate`) +
  synthesize (`delta`). Token-declare their ports; keep the back-edge cycles and
  synthesize's multi-input wiring. Generate + RUN: both loops cycle; returns
  cleanup_done.

- [ ] **Step 5: Run full core suite (migration tests + golden).** All green.

- [ ] **Step 6: Commit.**

```bash
git add -A && git commit -m "feat(pflow): re-author 3 fixtures without structural ports; verified by running"
```

---

## Phase 6 — Integration: deploy + heal vault + manual

- [ ] **Step 1: Build everything + full suites.**

```bash
cd packages/core && npm run build && cd ../obsidian-plugin && npm run typecheck && npm run build && cd ../.. && npx vitest run
```

- [ ] **Step 2: Deploy the tokenized fixtures to the vault** (back up first), and
  deploy the plugin to both vaults; verify byte-identical. Re-run the heal so any
  residual duplicate-name port is collapsed on load.

- [ ] **Step 3: Manual checks in Obsidian:**
  - Drop a fresh `loop` on the canvas → it has only a default `in`/`out`, NOT
    `draft`/`fix`.
  - Select an `input` node → NO prompt field, only the Ports section; add an
    output port there with type `json`.
  - On an agent: add a port in the inspector (no token) → it has a Remove button;
    type its token in the prompt → Remove disappears, "from prompt" badge shows.
  - Change a token-backed port's type to `json` in the inspector → the prompt
    token gains `:json`.
  - Remove a token from the prompt → its port's Remove button returns.
  - Open the 3 re-authored workflows → no dashed/duplicate ports; they compile.

- [ ] **Step 4: Final commit if the manual pass surfaced a fix.**

---

## Self-review notes (author)

- The codegen is essentially unchanged: regions.ts (wiring-based detection) and
  emit-kinds.ts (no port names) already support free port names. Phase 2 only
  ADDS regression tests. The risk is concentrated in Phase 1 (derivation rewrite)
  and Phase 5 (fixtures) — both covered by running generated code.
- Token-lock is DERIVED (isPortTokenLocked reads the prompt), never stored — so
  it can't drift. The UI hides Remove for locked ports; applyRemovePort also
  refuses a locked port as a safety net.
- applyPortType/Rename rewrite tokens via the shared token grammar so the prompt
  and inspector never disagree.
- Plumbing kinds get no prompt field (PROMPT_KINDS already excludes them); their
  ports are managed entirely by the port editor.
