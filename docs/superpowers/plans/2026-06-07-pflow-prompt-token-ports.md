# pflow Prompt-Token Ports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a node's prompt declare its interface — `{{in:NAME}}` / `{{out:NAME}}` tokens create input/output ports (knobs), render coloured in the prompt; codegen interpolates input tokens in place and parses 2+ outputs into named variables; renamed/deleted tokens leave dashed "orphan" wires.

**Architecture:** Pure token parsing in `@perspecta/core`; port derivation + orphan detection in the plugin's `flow-map.ts`; an additive `Port.orphan?` schema flag; dashed-edge rendering via an edge data flag; a `contenteditable` coloured prompt field replacing the textarea; codegen that replaces `{{in:}}` inline with the wired source and uses a delimiter+parse protocol for 2+ outputs. The 3 faithful migrations contain no tokens, so they must re-run byte-identical.

**Tech Stack:** Svelte 5 (runes, contenteditable), Zod schema, @xyflow/svelte custom edges, vitest, the existing deterministic codegen pipeline.

---

## Phase 1 — Token parsing (core, pure)

### Task 1.1: `parsePromptTokens` + grammar

**Files:**
- Create: `packages/core/src/pflow/tokens.ts`
- Test: `packages/core/test/pflow/tokens.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test** — create `packages/core/test/pflow/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parsePromptTokens } from "../../src/pflow/tokens.js";

describe("parsePromptTokens", () => {
  it("extracts in and out token names in first-occurrence order", () => {
    const r = parsePromptTokens("Use {{in:topic}} and {{in:notes}}, produce {{out:draft}}.");
    expect(r.inputs).toEqual(["topic", "notes"]);
    expect(r.outputs).toEqual(["draft"]);
  });
  it("de-duplicates repeated tokens", () => {
    const r = parsePromptTokens("{{in:x}} ... {{in:x}} ... {{out:y}} {{out:y}}");
    expect(r.inputs).toEqual(["x"]);
    expect(r.outputs).toEqual(["y"]);
  });
  it("allows the same name as both in and out (distinct)", () => {
    const r = parsePromptTokens("{{in:x}} -> {{out:x}}");
    expect(r.inputs).toEqual(["x"]);
    expect(r.outputs).toEqual(["x"]);
  });
  it("accepts digits/underscore/hyphen; rejects leading digit", () => {
    const r = parsePromptTokens("{{in:a_1}} {{in:b-2}} {{in:9bad}}");
    expect(r.inputs).toEqual(["a_1", "b-2"]);
  });
  it("ignores whitespace-bearing or malformed braces", () => {
    const r = parsePromptTokens("{{in: x}} {{ in:y}} {{in:z }} {{out:}}");
    expect(r.inputs).toEqual([]);
    expect(r.outputs).toEqual([]);
  });
  it("returns empty arrays for empty/undefined prompt", () => {
    expect(parsePromptTokens("")).toEqual({ inputs: [], outputs: [] });
    expect(parsePromptTokens(undefined as unknown as string)).toEqual({ inputs: [], outputs: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/pflow/tokens.test.ts`
Expected: FAIL — module/function not found.

- [ ] **Step 3: Implement the parser** — create `packages/core/src/pflow/tokens.ts`:

```ts
import type { NodeKind } from "./schema.js";

/** Token grammar: {{in:NAME}} / {{out:NAME}}, NAME = [A-Za-z_][A-Za-z0-9_-]*.
 *  No whitespace inside the braces. Build a FRESH RegExp per scan (the global
 *  flag makes them stateful via lastIndex). Shared by the prompt highlighter. */
export const TOKEN_SOURCE = "\\{\\{(in|out):([A-Za-z_][A-Za-z0-9_-]*)\\}\\}";
export function tokenRegExp(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g");
}

export interface PromptTokens {
  inputs: string[];
  outputs: string[];
}

/** Ordered, de-duplicated input/output token names found in a prompt. */
export function parsePromptTokens(prompt: string): PromptTokens {
  const inputs: string[] = [];
  const outputs: string[] = [];
  if (!prompt) return { inputs, outputs };
  const re = tokenRegExp();
  let m: RegExpExecArray | null;
  while ((m = re.exec(prompt)) !== null) {
    const [, dir, name] = m;
    const bucket = dir === "in" ? inputs : outputs;
    if (!bucket.includes(name)) bucket.push(name);
  }
  return { inputs, outputs };
}

/** Protected structural port ids per kind: ids the prompt-token derivation must
 *  never remove. agent → empty (tokens fully own its ports); structural kinds →
 *  their default-port ids, so tokens only ADD. */
export const STRUCTURAL_PORT_IDS: Record<NodeKind, { inputs: string[]; outputs: string[] }> = {
  input: { inputs: [], outputs: ["out"] },
  output: { inputs: ["in"], outputs: [] },
  agent: { inputs: [], outputs: [] },
  split: { inputs: ["in"], outputs: ["out"] },
  join: { inputs: ["in"], outputs: ["out"] },
  loop: { inputs: ["in"], outputs: ["out"] },
  verify: { inputs: ["in"], outputs: ["out"] },
  synthesize: { inputs: ["in"], outputs: ["out"] },
  branch: { inputs: ["in"], outputs: ["out"] },
  script: { inputs: ["in"], outputs: ["out"] },
};
```

NOTE: STRUCTURAL_PORT_IDS lists the DEFAULT port ids per kind (input→out;
output→in; everything else→in/out) — what a freshly-created node of that kind
has. The faithful migrations use richly-named structural ports (e.g. loop
`draft`/`fix`); those survive via Phase 2's separate "preserve any wired port"
rule, not this list. Structural-by-id is the floor; wired ports are also kept.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/pflow/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Export from core index.** The index uses wildcard re-exports (`export * from "./pflow/X.js"`). Add, alongside the other `./pflow/*` lines in `packages/core/src/index.ts`:

```ts
export * from "./pflow/tokens.js";
```

- [ ] **Step 6: Build core + verify export**

Run: `cd packages/core && npm run build && node -e "console.log(typeof require('./dist/index.js').parsePromptTokens)"`
Expected: prints `function`.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/pflow/tokens.ts packages/core/test/pflow/tokens.test.ts packages/core/src/index.ts
git commit -m "feat(pflow): parsePromptTokens + token grammar + structural port ids"
```

---

## Phase 3 — Schema: additive `Port.orphan?` (do BEFORE Phase 2 build so TS sees the field)

### Task 3.1: add `orphan?: boolean` to Port

**Files:**
- Modify: `packages/core/src/pflow/schema.ts:31-37` (PortZ)
- Test: `packages/core/test/pflow/schema.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/core/test/pflow/schema.test.ts`:

```ts
describe("Port.orphan", () => {
  it("parses a port carrying orphan:true", () => {
    const doc = parsePflow(JSON.stringify({
      ...MINIMAL,
      nodes: [
        { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "args", schema: { type: "any" }, orphan: true }] },
        ...MINIMAL.nodes.slice(1),
      ],
    }));
    expect(doc.nodes[0].outputs[0].orphan).toBe(true);
  });
  it("parses a port with no orphan field (backward compat)", () => {
    const doc = parsePflow(JSON.stringify(MINIMAL));
    expect(doc.nodes[0].outputs[0].orphan).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/pflow/schema.test.ts`
Expected: the orphan:true case FAILS (Zod strips it → undefined).

- [ ] **Step 3: Add the field** to `PortZ` in `packages/core/src/pflow/schema.ts`:

```ts
export const PortZ = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  schema: PortSchemaZ,
  required: z.boolean().optional(),
  orphan: z.boolean().optional(),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/pflow/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Rebuild core (so the plugin's d.ts sees `orphan`)**

Run: `cd packages/core && npm run build && grep -n "orphan" dist/pflow/schema.d.ts`
Expected: `orphan` appears.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/pflow/schema.ts packages/core/test/pflow/schema.test.ts
git commit -m "feat(pflow): additive Port.orphan? flag"
```

---

## Phase 2 — Port derivation (plugin)

### Task 2.1: `derivePortsFromPrompt` + `applyPromptAndDerivePorts`

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts`
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/obsidian-plugin/test/flow-map.test.ts`:

```ts
import {
  derivePortsFromPrompt,
  applyPromptAndDerivePorts,
} from "../src/views/pflow-editor/flow-map.js";

describe("derivePortsFromPrompt", () => {
  it("agent: tokens replace ports", () => {
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "{{in:topic}} -> {{out:draft}}", inputs: [{ id: "in", name: "in", schema: { type: "any" as const }, required: true }], outputs: [{ id: "out", name: "out", schema: { type: "any" as const } }] };
    const r = derivePortsFromPrompt(node, []);
    expect(r.inputs.map((p) => p.id)).toEqual(["in:topic"]);
    expect(r.outputs.map((p) => p.id)).toEqual(["out:draft"]);
  });
  it("agent: no tokens, no wires -> default in/out", () => {
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "plain", inputs: [], outputs: [] };
    const r = derivePortsFromPrompt(node, []);
    expect(r.inputs.map((p) => p.id)).toEqual(["in"]);
    expect(r.outputs.map((p) => p.id)).toEqual(["out"]);
  });
  it("structural kind: tokens ADD, structural port preserved", () => {
    const loop = { id: "lp", kind: "loop" as const, label: "L", prompt: "{{in:extra}}", inputs: [{ id: "in", name: "draft", schema: { type: "any" as const }, required: true }], outputs: [{ id: "out", name: "fix", schema: { type: "any" as const } }] };
    const r = derivePortsFromPrompt(loop, []);
    expect(r.inputs.map((p) => p.id).sort()).toEqual(["in", "in:extra"].sort());
    expect(r.outputs.map((p) => p.id)).toContain("out");
  });
  it("a wired port dropped by an edited prompt becomes an orphan", () => {
    const node = { id: "ag", kind: "agent" as const, label: "A", prompt: "{{in:topic}}", inputs: [{ id: "in:notes", name: "notes", schema: { type: "any" as const } }], outputs: [] };
    const wires = [{ from: { nodeId: "up", portId: "o" }, to: { nodeId: "ag", portId: "in:notes" } }];
    const r = derivePortsFromPrompt(node, wires);
    expect(r.inputs.find((p) => p.id === "in:notes")?.orphan).toBe(true);
    expect(r.inputs.some((p) => p.id === "in:topic")).toBe(true);
  });
});

describe("applyPromptAndDerivePorts", () => {
  it("commits prompt and re-derives ports immutably", () => {
    const next = applyPromptAndDerivePorts(DOC, "ag", "{{in:topic}} {{out:r}}");
    const ag = next.nodes.find((n) => n.id === "ag")!;
    expect(ag.prompt).toBe("{{in:topic}} {{out:r}}");
    expect(ag.inputs.map((p) => p.id)).toEqual(["in:topic"]);
    expect(ag.outputs.map((p) => p.id)).toEqual(["out:r"]);
    expect(DOC.nodes.find((n) => n.id === "ag")!.prompt).toBe("p");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement.** Add the import at the top of `flow-map.ts`:

```ts
import { parsePromptTokens, STRUCTURAL_PORT_IDS } from "@perspecta/core";
```

Then add:

```ts
/** Compute the ports a node's prompt implies. agent: tokens replace (no tokens
 *  & no wires -> default in/out). structural kinds: tokens ADD; structural ports
 *  (by id) are kept. Any current port that is wired but no longer derived (and
 *  not structural) is KEPT as an orphan. Pure over (node, wires). */
export function derivePortsFromPrompt(
  node: { id: string; kind: NodeKind; prompt?: string; inputs: Port[]; outputs: Port[] },
  wires: Wire[],
): { inputs: Port[]; outputs: Port[] } {
  const { inputs: inNames, outputs: outNames } = parsePromptTokens(node.prompt ?? "");
  const structural = STRUCTURAL_PORT_IDS[node.kind];
  const tokenInput = (name: string): Port => ({ id: `in:${name}`, name, schema: { type: "any" }, required: false });
  const tokenOutput = (name: string): Port => ({ id: `out:${name}`, name, schema: { type: "any" } });
  const wiredInIds = new Set(wires.filter((w) => w.to.nodeId === node.id).map((w) => w.to.portId));
  const wiredOutIds = new Set(wires.filter((w) => w.from.nodeId === node.id).map((w) => w.from.portId));

  function build(names: string[], make: (n: string) => Port, current: Port[], structuralIds: string[], wiredIds: Set<string>): Port[] {
    const out: Port[] = [];
    const seen = new Set<string>();
    for (const sid of structuralIds) {
      const cur = current.find((p) => p.id === sid);
      if (cur) { out.push({ ...cur, orphan: false }); seen.add(cur.id); }
    }
    for (const n of names) {
      const p = make(n);
      if (seen.has(p.id)) continue;
      out.push(p); seen.add(p.id);
    }
    for (const cur of current) {
      if (seen.has(cur.id)) continue;
      if (wiredIds.has(cur.id)) { out.push({ ...cur, orphan: true }); seen.add(cur.id); }
    }
    return out;
  }

  let inputs = build(inNames, tokenInput, node.inputs, structural.inputs, wiredInIds);
  let outputs = build(outNames, tokenOutput, node.outputs, structural.outputs, wiredOutIds);
  if (node.kind === "agent" && inputs.length === 0 && outputs.length === 0) {
    const def = defaultPortsForKind("agent");
    inputs = def.inputs;
    outputs = def.outputs;
  }
  return { inputs, outputs };
}

/** Set a node's prompt AND re-derive its ports from the new prompt. Immutable. */
export function applyPromptAndDerivePorts(doc: PflowDocument, nodeId: string, prompt: string): PflowDocument {
  return {
    ...doc,
    nodes: doc.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const withPrompt = { ...n, prompt };
      const { inputs, outputs } = derivePortsFromPrompt(withPrompt, doc.wires);
      return { ...withPrompt, inputs, outputs };
    }),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): derivePortsFromPrompt + applyPromptAndDerivePorts"
```

---

## Phase 4 — Dashed orphan wires (plugin)

### Task 4.1: edge carries an `inactive` flag; PflowEdge renders dashed

**Files:**
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts` (FlowEdge + toFlowEdges)
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/PflowEdge.svelte`
- Test: `packages/obsidian-plugin/test/flow-map.test.ts`

- [ ] **Step 1: Write the failing test** — append to `flow-map.test.ts`:

```ts
describe("toFlowEdges orphan/inactive flag", () => {
  it("marks an edge inactive when its target port is an orphan", () => {
    const doc: PflowDocument = {
      ...DOC,
      nodes: DOC.nodes.map((n) =>
        n.id === "ag"
          ? { ...n, inputs: [{ id: "i", name: "topic", schema: { type: "string" }, orphan: true }] }
          : n,
      ),
    };
    const edge = toFlowEdges(doc).find((e) => e.target === "ag")!;
    expect(edge.data?.inactive).toBe(true);
  });
  it("leaves a normal edge active", () => {
    expect(toFlowEdges(DOC)[0].data?.inactive).toBeFalsy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: FAIL — `data` not on FlowEdge.

- [ ] **Step 3: Add the flag in `flow-map.ts`.** Extend `FlowEdge`:

```ts
export interface FlowEdge {
  id: string;
  type: "pflow";
  source: string;
  target: string;
  sourceHandle: string;
  targetHandle: string;
  markerEnd: { type: MarkerType; width: number; height: number };
  /** Inactive (dashed) when either endpoint port is an orphan. */
  data: { inactive: boolean };
}
```

Rewrite `toFlowEdges` to compute the flag from orphan ports:

```ts
export function toFlowEdges(doc: PflowDocument): FlowEdge[] {
  const orphanPort = (nodeId: string, portId: string, side: "in" | "out"): boolean => {
    const n = doc.nodes.find((x) => x.id === nodeId);
    if (!n) return false;
    const ports = side === "in" ? n.inputs : n.outputs;
    return ports.find((p) => p.id === portId)?.orphan === true;
  };
  return doc.wires.map((w) => ({
    id: `${w.from.nodeId}:${w.from.portId}->${w.to.nodeId}:${w.to.portId}`,
    type: "pflow" as const,
    source: w.from.nodeId,
    target: w.to.nodeId,
    sourceHandle: w.from.portId,
    targetHandle: w.to.portId,
    markerEnd: { type: MarkerType.ArrowClosed, width: 24, height: 24 },
    data: {
      inactive:
        orphanPort(w.from.nodeId, w.from.portId, "out") ||
        orphanPort(w.to.nodeId, w.to.portId, "in"),
    },
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/obsidian-plugin/test/flow-map.test.ts`
Expected: PASS. (The pre-existing edge tests that assert `type`/`markerEnd` still pass — fields unchanged.)

- [ ] **Step 5: Render dashed in `PflowEdge.svelte`.** Add `data` to the destructured props and a class/style on the path:

```svelte
  let {
    id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data,
  }: EdgeProps = $props();
  let inactive = $derived(Boolean((data as { inactive?: boolean } | undefined)?.inactive));
```

Replace the `<BaseEdge .../>` with a conditional style (dashed + muted, no marker when inactive):

```svelte
<BaseEdge
  {id}
  {path}
  markerEnd={inactive ? undefined : markerEnd}
  style={inactive ? "stroke-dasharray: 6 4; stroke: var(--text-faint); opacity: 0.7;" : ""}
/>
```

- [ ] **Step 6: Build + typecheck + full suite**

Run: `cd packages/obsidian-plugin && npm run typecheck && npm run build && cd ../.. && npx vitest run packages/obsidian-plugin/`
Expected: clean; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/flow-map.ts packages/obsidian-plugin/src/views/pflow-editor/PflowEdge.svelte packages/obsidian-plugin/test/flow-map.test.ts
git commit -m "feat(pflow-editor): dashed inactive edges for orphan ports"
```

---

## Phase 5 — Contenteditable coloured prompt field (plugin)

### Task 5.1: `prompt-field.svelte` + wire into the inspector

**Files:**
- Create: `packages/obsidian-plugin/src/views/pflow-editor/prompt-field.svelte`
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte` (Prompt section uses the new field)
- Modify: `packages/obsidian-plugin/src/views/pflow-editor/editor.svelte` (onPrompt now calls `applyPromptAndDerivePorts`)

No unit test (no component harness, consistent with prior inspector work). Verified by build + manual.

- [ ] **Step 1: Create `prompt-field.svelte`.** A contenteditable that highlights complete tokens and emits plain text (debounced). Handle the known hazards: render via innerHTML from the model, restore caret after re-render, paste as plain text, keep Enter as newline.

```svelte
<script lang="ts">
  import { tokenRegExp } from "@perspecta/core";

  let { value, onInput }: { value: string; onInput: (next: string) => void } = $props();

  let el: HTMLDivElement;
  let composing = $state(false);

  // Escape text for safe innerHTML, then wrap complete tokens in coloured spans.
  function escapeHtml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function render(text: string): string {
    const re = tokenRegExp();
    let html = "";
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      html += escapeHtml(text.slice(last, m.index));
      const cls = m[1] === "in" ? "pflow-tok pflow-tok--in" : "pflow-tok pflow-tok--out";
      html += `<span class="${cls}">${escapeHtml(m[0])}</span>`;
      last = m.index + m[0].length;
    }
    html += escapeHtml(text.slice(last));
    return html.replace(/\n/g, "<br>");
  }

  // Caret as a plain-text offset (so we can restore it after re-render).
  function caretOffset(root: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }
  function setCaret(root: HTMLElement, offset: number) {
    const sel = window.getSelection();
    if (!sel) return;
    let remaining = offset;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (remaining <= len) {
        const range = document.createRange();
        range.setStart(node, remaining);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
        return;
      }
      remaining -= len;
      node = walker.nextNode();
    }
    // offset past the end: place at end
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function plainText(root: HTMLElement): string {
    // Convert <br> back to \n; textContent already drops the span wrappers.
    return (root.innerText ?? root.textContent ?? "").replace(/ /g, " ");
  }

  function rehighlight() {
    if (!el) return;
    const offset = caretOffset(el);
    el.innerHTML = render(plainText(el));
    setCaret(el, offset);
  }

  function handleInput() {
    if (composing) return;
    const text = plainText(el);
    onInput(text);
    rehighlight();
  }

  function handlePaste(e: ClipboardEvent) {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    document.execCommand("insertText", false, text);
  }

  // Seed + re-seed when the external value changes (selecting a different node).
  $effect(() => {
    if (!el) return;
    if (plainText(el) !== value) {
      el.innerHTML = render(value ?? "");
    }
  });
</script>

<div
  bind:this={el}
  class="pflow-prompt-field"
  contenteditable="true"
  role="textbox"
  tabindex="0"
  aria-multiline="true"
  oninput={handleInput}
  onpaste={handlePaste}
  oncompositionstart={() => (composing = true)}
  oncompositionend={() => { composing = false; handleInput(); }}
></div>

<style>
  .pflow-prompt-field {
    width: 100%;
    box-sizing: border-box;
    min-height: 6em;
    padding: var(--size-2-2) var(--size-2-3);
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .pflow-prompt-field:focus {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -1px;
  }
  :global(.pflow-tok) {
    border-radius: 3px;
    padding: 0 2px;
    font-family: var(--font-monospace);
    font-size: 0.95em;
  }
  :global(.pflow-tok--in) {
    color: var(--color-green, #4caf50);
    background: color-mix(in srgb, var(--color-green, #4caf50) 14%, transparent);
  }
  :global(.pflow-tok--out) {
    color: var(--interactive-accent);
    background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
  }
</style>
```

- [ ] **Step 2: Use it in `inspector-pane.svelte`.** Import it and replace the Prompt `<textarea>` block:

```svelte
  import PromptField from "./prompt-field.svelte";
```

Replace the textarea in the `{#if showPrompt}` section with:

```svelte
        <PromptField
          value={node.data.prompt ?? ""}
          onInput={(next) => onPrompt(node!.id, next)}
        />
```

- [ ] **Step 3: Re-derive ports on prompt edit in `editor.svelte`.** Change the `onPrompt` handler to use the deriving variant:

```ts
  function onPrompt(nodeId: string, prompt: string) {
    commit(applyPromptAndDerivePorts(doc, nodeId, prompt));
  }
```

And update the import in `editor.svelte` to bring in `applyPromptAndDerivePorts` (replace or alongside `applyPromptEdit`). Keep `applyPromptEdit` exported (still used by the existing flow-map test).

- [ ] **Step 4: Build + typecheck + full suite**

Run: `cd packages/obsidian-plugin && npm run typecheck && npm run build && cd ../.. && npx vitest run packages/obsidian-plugin/`
Expected: clean; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/views/pflow-editor/prompt-field.svelte packages/obsidian-plugin/src/views/pflow-editor/inspector-pane.svelte packages/obsidian-plugin/src/views/pflow-editor/editor.svelte
git commit -m "feat(pflow-editor): contenteditable coloured prompt field; re-derive ports on edit"
```

---

## Phase 6 — Codegen: input-token interpolation + multi-output parse (core)

### Task 6.1: input tokens replaced inline; untokened wired inputs unchanged

**Files:**
- Modify: `packages/core/src/codegen/scriptgen.ts` (`buildAgentCall`)
- Test: `packages/core/test/codegen/` (new `tokens.test.ts`)

The new `buildAgentCall` behaviour:
- Compute the prompt's input token names. For each `{{in:NAME}}` occurrence,
  replace it with `${<sourceExpr for the port named NAME>}` — the wired source,
  or `""` if that port is unwired. (Find the port by NAME → its id `in:NAME` →
  its wire.)
- Inputs that are wired but have NO token in the prompt keep today's behaviour:
  appended as `<context name="...">` blocks.
- If a tokened port has no wire, its `${...}` becomes `""`.

- [ ] **Step 1: Write the failing test** — create `packages/core/test/codegen/tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

const DOC: PflowDocument = {
  pflowFormatVersion: 1,
  workflow: { name: "tok", description: "d" },
  nodes: [
    { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
    { id: "ag", kind: "agent", label: "Write", prompt: "Write about {{in:topic}} now.", inputs: [{ id: "in:topic", name: "topic", schema: { type: "any" }, required: false }], outputs: [{ id: "out", name: "out", schema: { type: "any" } }] },
    { id: "out", kind: "output", label: "Out", inputs: [{ id: "i", name: "result", schema: { type: "any" } }], outputs: [] },
  ],
  wires: [
    { from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "in:topic" } },
    { from: { nodeId: "ag", portId: "out" }, to: { nodeId: "out", portId: "i" } },
  ],
  editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
};

describe("input token interpolation", () => {
  it("replaces {{in:topic}} inline with the wired source expression", () => {
    const code = generateClaudeCodeWorkflow(DOC);
    expect(code).toContain("Write about ${args.topic} now.");
    expect(code).not.toContain("{{in:topic}}");
    // no appended context block for the tokened input
    expect(code).not.toContain('<context name="topic">');
  });
  it("an unwired tokened input interpolates an empty string", () => {
    const doc: PflowDocument = { ...DOC, wires: DOC.wires.filter((w) => w.to.portId !== "in:topic") };
    const code = generateClaudeCodeWorkflow(doc);
    expect(code).toContain("Write about ${``} now.");
  });
});
```

(NOTE: the exact empty-source rendering — `${``}` vs `${""}` — must match the
implementation in Step 3; align the assertion to whatever the helper emits.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/codegen/tokens.test.ts`
Expected: FAIL — current code leaves `{{in:topic}}` literal and appends a context block.

- [ ] **Step 3: Implement inline replacement in `buildAgentCall`.** In `scriptgen.ts`, add a helper that resolves a port NAME to its source expression, and rewrite the prompt before assembling context blocks:

```ts
/** Source expression for the input port of `node` whose NAME matches, or an
 *  empty-string literal when that port is unwired. */
function tokenSourceExpr(doc: PflowDocument, node: PflowNode, name: string): string {
  const port = node.inputs.find((p) => p.name === name && p.id === `in:${name}`);
  if (!port) return "``";
  const wire = inWires(doc, node.id).find((w) => w.to.portId === port.id);
  if (!wire) return "``";
  return sourceExpr(doc, wire);
}
```

Then, at the top of `buildAgentCall`, after computing `base`, replace tokens and
track which port ids were consumed inline (so they are NOT also appended):

```ts
  const tokens = parsePromptTokens(node.prompt ?? "");
  const consumed = new Set<string>(); // port ids interpolated inline
  let rewritten = base;
  for (const name of tokens.inputs) {
    const expr = tokenSourceExpr(doc, node, name);
    consumed.add(`in:${name}`);
    // Replace EVERY occurrence of this token. Escape the literal braces for the
    // RegExp; the replacement is a template interpolation of the source expr.
    const tokenLiteral = `{{in:${name}}}`;
    rewritten = rewritten.split(tokenLiteral).join(" IN:" + name + " ");
  }
```

Because the prompt becomes a template literal via `escapeTemplate`, do the
interpolation by a two-step sentinel: (1) swap each token for a sentinel that
survives `escapeTemplate`, (2) after escaping, replace each sentinel with
`${expr}`. Concretely:

- Build `rewritten` with sentinels (above).
- When assembling `tmpl`, run `escapeTemplate(rewritten)` then replace each
  ` IN:NAME ` with `"${" + tokenSourceExpr(...) + "}"`.
- In the context-block loop, SKIP any port whose id is in `consumed`.
- Force template-literal output (not the plain-string branch) when any token was
  consumed, even if `blocks` is empty.

Import `parsePromptTokens` at the top of `scriptgen.ts`:

```ts
import { parsePromptTokens } from "../pflow/tokens.js";
```

Implement carefully so the sentinel can never collide with user text (` `
is disallowed in normal prompts; if paranoid, assert none present and fall back).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/codegen/tokens.test.ts`
Expected: PASS (align the empty-source assertion to the actual `\`\`` rendering).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/codegen/scriptgen.ts packages/core/test/codegen/tokens.test.ts
git commit -m "feat(pflow-codegen): interpolate {{in:}} tokens inline from wired source"
```

### Task 6.2: multi-output delimiter + parse (2+ outputs)

**Files:**
- Modify: `packages/core/src/codegen/scriptgen.ts` (agent emit path)
- Test: `packages/core/test/codegen/tokens.test.ts` (append)

Behaviour:
- 0 or 1 output token → unchanged (the agent's single result variable IS the
  output; downstream wires from `out:NAME` already read `varName(node)`).
- 2+ output tokens → append a delimiter instruction to the prompt and, after the
  `const <var> = await agent(...)`, emit a deterministic parse producing one
  `const <var>__<NAME>` per output. A downstream wire from port `out:NAME` reads
  `<var>__<NAME>`. Missing section → empty string.

The parse must use only sandbox-legal, deterministic string ops (no banned
tokens — emit-lint will reject otherwise). Use a tiny inline splitter per output:

```ts
// for output NAME, var V:
const Vsec = String(V).split("<<<out:NAME>>>")[1] ?? "";
const V__NAME = Vsec.split("<<<end>>>")[0].trim();
```

- [ ] **Step 1: Write the failing test** — append to `tokens.test.ts`:

```ts
describe("multi-output parse", () => {
  const MULTI: PflowDocument = {
    pflowFormatVersion: 1,
    workflow: { name: "multi", description: "d" },
    nodes: [
      { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "o", name: "topic", schema: { type: "string" } }] },
      { id: "ag", kind: "agent", label: "Make", prompt: "From {{in:topic}} produce {{out:title}} and {{out:body}}.", inputs: [{ id: "in:topic", name: "topic", schema: { type: "any" } }], outputs: [{ id: "out:title", name: "title", schema: { type: "any" } }, { id: "out:body", name: "body", schema: { type: "any" } }] },
      { id: "t", kind: "output", label: "T", inputs: [{ id: "i", name: "r", schema: { type: "any" } }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "o" }, to: { nodeId: "ag", portId: "in:topic" } },
      { from: { nodeId: "ag", portId: "out:title" }, to: { nodeId: "t", portId: "i" } },
    ],
    editor: { viewport: { x: 0, y: 0, zoom: 1 }, nodePositions: [] },
  };
  it("emits a delimiter instruction and per-output parse for 2+ outputs", () => {
    const code = generateClaudeCodeWorkflow(MULTI);
    expect(code).toContain("<<<out:title>>>");
    expect(code).toContain("<<<out:body>>>");
    expect(code).toMatch(/split\("<<<out:title>>>"\)/);
  });
  it("downstream output reads the parsed title variable, not the raw result", () => {
    const code = generateClaudeCodeWorkflow(MULTI);
    // the output node returns the title-parsed var
    expect(code).toMatch(/return \w+__title;/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/test/codegen/tokens.test.ts`
Expected: FAIL — no delimiter/parse emitted; output returns the raw agent var.

- [ ] **Step 3: Implement.** In `scriptgen.ts`:
  - In the agent emit path (`emitNode` `case "agent"`), after building the call,
    detect `tokens.outputs.length >= 2`. If so:
    - Append the delimiter instruction to the prompt via the `extraInstruction`
      param of `buildAgentCall` (so it weaves cleanly): e.g.
      `Return each output wrapped EXACTLY as:\n<<<out:NAME>>>\n…\n<<<end>>>` for
      each NAME.
    - After `const <var> = await agent(...)`, emit one `const <var>__<NAME> = …`
      parse line per output (the splitter above).
  - Add a `sourceExpr` override so a wire FROM `out:NAME` resolves to
    `<var>__<NAME>` instead of bare `<var>`. The cleanest hook: in `sourceExpr`,
    when the source node is an agent AND `wire.from.portId` starts with `out:`
    AND that node has 2+ output tokens, return `${varName(node)}__${NAME}`. Guard
    so the single-output path is unchanged.
  - Keep determinism: parse lines are emitted in output-token order.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/test/codegen/tokens.test.ts`
Expected: PASS.

- [ ] **Step 5: Prove the generated parse runs correctly (run the emitted code).**

Add a test that builds the MULTI doc's code, wraps the agent in a stub returning
`"<<<out:title>>>\nHELLO\n<<<end>>>\n<<<out:body>>>\nWORLD\n<<<end>>>"`, runs the
generated function via `new Function`, and asserts the output node returns
`"HELLO"`; and a second run where the body section is absent asserts the body
parse yields `""`. (This mirrors the established run-the-codegen discipline used
in scriptgen.test.ts.) Append to `tokens.test.ts`.

Run: `npx vitest run packages/core/test/codegen/tokens.test.ts`
Expected: PASS — parsed title is "HELLO"; missing body → "".

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/codegen/scriptgen.ts packages/core/test/codegen/tokens.test.ts
git commit -m "feat(pflow-codegen): multi-output delimiter protocol + parse (missing -> empty)"
```

### Task 6.3: regression — the 3 faithful migrations are byte-identical

**Files:** none (verification); fixtures only if a legitimate diff is reviewed and accepted.

- [ ] **Step 1: Run the full core suite incl. migration tests**

Run: `npx vitest run packages/core/`
Expected: all green. The migrations carry NO `{{ }}` tokens, so `parsePromptTokens`
returns empty → `buildAgentCall` takes the unchanged path → output identical.

- [ ] **Step 2: If any migration test fails on a diff**, inspect it. A diff means
the token path altered untokened output — a bug. Fix the guard so zero-token
prompts are byte-identical; do NOT regenerate the golden fixture to paper over it.
Only update a fixture if the diff is a deliberate, reviewed improvement (it should
not be, for this feature).

- [ ] **Step 3: Commit (only if a guard fix was needed)**

```bash
git add packages/core/src/codegen/scriptgen.ts
git commit -m "fix(pflow-codegen): keep token-free prompts byte-identical"
```

---

## Phase 7 — Integration: deploy + manual verification

**Files:** none (deploy + manual).

- [ ] **Step 1: Build everything + full suites**

Run: `cd packages/core && npm run build && cd ../obsidian-plugin && npm run typecheck && npm run build && cd ../.. && npx vitest run`
Expected: clean build, clean typecheck, ALL tests pass.

- [ ] **Step 2: Deploy to both vaults + verify byte-identical**

Run the deploy (Perspecta-Dev) and the env-override deploy (Intelligence Impact),
then `cmp` the deployed `main.js`/`styles.css` against the freshly built ones.

```bash
cd packages/obsidian-plugin && npm run deploy
PERSPECTA_VAULT_ROOT="/Users/wrede/Documents/Obsidian Vaults/Intelligence Impact" bash scripts/deploy-dev.sh
```

- [ ] **Step 3: Manual check in Obsidian**

Reload, open a `.pflow`, select an agent, and in the inspector Prompt field:
- Type `{{in:topic}}` → it colours green; a `topic` input knob appears on the card.
- Type `{{out:summary}}` and `{{out:actions}}` → both colour (accent); two output
  knobs appear.
- Wire something into `topic`, then rename the token to `{{in:subject}}` → the
  `topic` wire goes dashed (orphan); a `subject` knob appears.
- Confirm the orphan port shows in the inspector Ports list.
- Caret behaviour: typing mid-prompt keeps the caret in place; paste inserts
  plain text; Enter makes a newline.

- [ ] **Step 4: Final commit (only if the manual pass surfaced a fix)**

Commit any fix with a descriptive message.

---

## Self-review notes (author)

- Phase ordering: 1 → 3 → 2 → 4 → 5 → 6 → 7. Phase 3 (schema `orphan?`) precedes
  Phase 2's build because `derivePortsFromPrompt` sets `orphan` on `Port`.
- Type consistency: port id scheme `in:NAME`/`out:NAME` is used identically in
  derivation (2.1), edge-flag lookup (4.1), and codegen token resolution (6.1/6.2).
  `applyPromptAndDerivePorts` (not the old `applyPromptEdit`) is what `editor.svelte`
  calls after Phase 5.
- The multi-output `sourceExpr` override (6.2) is the one cross-cutting subtlety:
  a wire from `out:NAME` must read `<var>__<NAME>` only when the source agent has
  2+ output tokens; the single-output path stays `<var>`. Guard it tightly and
  cover both paths in tests.
- Risk concentrates in 6.2 (parse) and 5.1 (contenteditable caret). Both are
  isolated to one function / one component and covered by run-the-code tests /
  manual caret checks respectively.
