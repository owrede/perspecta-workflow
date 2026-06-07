<!--
  prompt-field — a contenteditable prompt editor that colours {{in:…}}/{{out:…}}
  tokens inline and emits the plain-text prompt on input.

  Why contenteditable (not a textarea): a textarea cannot colour substrings. We
  render the text with complete tokens wrapped in coloured spans, and keep native
  editing by:
    - converting the live DOM back to plain text on every input (innerText),
    - re-highlighting after each input while RESTORING the caret (tracked as a
      plain-text offset, so it survives the DOM rebuild),
    - forcing paste to insert plain text (no foreign markup enters the field),
    - skipping work mid-IME-composition so highlighting never interrupts it.

  Safety: the highlighted view is built with safe DOM methods only
  (createElement + textContent + createTextNode). We never assign innerHTML, so
  user text can never inject markup — there is no XSS sink.

  The token grammar comes from @perspecta/core (single source of truth), so the
  field and the port-derivation agree on what a token is.
-->

<script lang="ts">
  import { tokenRegExp } from "@perspecta/core";

  let { value, onInput }: { value: string; onInput: (next: string) => void } = $props();

  let el = $state<HTMLDivElement | null>(null);
  let composing = $state(false);

  /** Replace the field's children with a highlighted view of `text`, built from
   *  safe DOM nodes only: plain runs are text nodes (with \n → <br>), complete
   *  tokens are coloured <span>s whose text is set via textContent. No innerHTML,
   *  so nothing user-typed can be interpreted as markup. */
  function paint(root: HTMLElement, text: string): void {
    root.replaceChildren();
    let last = 0;
    const appendText = (s: string) => {
      // Preserve newlines as <br> so the contenteditable shows line breaks.
      const parts = s.split("\n");
      parts.forEach((part, i) => {
        if (part) root.appendChild(document.createTextNode(part));
        if (i < parts.length - 1) root.appendChild(document.createElement("br"));
      });
    };
    for (const m of text.matchAll(tokenRegExp())) {
      const idx = m.index ?? 0;
      appendText(text.slice(last, idx));
      const span = document.createElement("span");
      // Direction picks the base colour (in = green, out = accent); an explicit
      // :json / :table type adds a modifier class for a subtle type cue.
      const dir = m[1] === "in" ? "pflow-tok--in" : "pflow-tok--out";
      const type = m[3]; // undefined for a plain string token
      span.className = `pflow-tok ${dir}${type ? ` pflow-tok--${type}` : ""}`;
      span.textContent = m[0];
      root.appendChild(span);
      last = idx + m[0].length;
    }
    appendText(text.slice(last));
  }

  /** Caret position as a plain-text character offset from the field start. */
  function caretOffset(root: HTMLElement): number {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return 0;
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(root);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  }

  /** Place the caret at a plain-text offset (walking text nodes). */
  function setCaret(root: HTMLElement, offset: number): void {
    const sel = window.getSelection();
    if (!sel) return;
    let remaining = offset;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
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
    // Offset past the end (or empty field): collapse to the end.
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /** The field's current plain text (innerText drops span wrappers and turns
   *  <br>/block boundaries into newlines). */
  function plainText(root: HTMLElement): string {
    return root.innerText ?? root.textContent ?? "";
  }

  function rehighlight(): void {
    if (!el) return;
    const offset = caretOffset(el);
    paint(el, plainText(el));
    setCaret(el, offset);
  }

  function handleInput(): void {
    if (composing || !el) return;
    onInput(plainText(el));
    rehighlight();
  }

  function handlePaste(e: ClipboardEvent): void {
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    // insertText keeps the field plain-text-only and leaves the caret after the
    // paste; the subsequent input event re-highlights.
    document.execCommand("insertText", false, text);
  }

  // Seed and re-seed when the external value changes (e.g. selecting a different
  // node). Guard against clobbering live edits: only repaint when the model and
  // the DOM text actually differ.
  $effect(() => {
    if (!el) return;
    if (plainText(el) !== (value ?? "")) {
      paint(el, value ?? "");
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
  oncompositionend={() => {
    composing = false;
    handleInput();
  }}
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
  /* Token chips. :global because they live inside contenteditable content,
     outside this component's scoped-style reach. in = green, out = accent. */
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
  /* Typed tokens get a dotted underline as a subtle "structured" cue, so the
     :json / :table suffix reads as more than plain text without fighting the
     in/out colour. */
  :global(.pflow-tok--json),
  :global(.pflow-tok--table) {
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }
</style>
