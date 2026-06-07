<!--
  inspector-pane — right pane of the pflow editor, styled to Obsidian's settings
  idiom (section groups, theme tokens, accent focus rings). Two modes:

    Mode A (node selected): kind-accented header (icon + label + kind badge +
      one-line kind description), then Name / Type / Prompt (prompt-bearing
      kinds only) / Ports sections.
    Mode B (nothing selected): Workflow config — Name, Description, Save defaults.

  Presentation only: the props/callbacks are unchanged from the prior version.
  Layout + tokens follow the vault-memory contract-editor inspector.
-->

<script lang="ts">
  import { NODE_KINDS, type NodeKind } from "@perspecta/core";
  import type { FlowNodeData } from "./flow-map.js";
  import { COMPILABLE_KINDS } from "./flow-map.js";
  import { KIND_INFO, FALLBACK_ICON, PROMPT_KINDS } from "./kind-info.js";
  import PromptField from "./prompt-field.svelte";

  let {
    node,
    workflow,
    argDefaults,
    onPrompt,
    onRename,
    onKindChange,
    onWorkflowMeta,
    onArgDefault,
    onDetectPorts,
  }: {
    node: { id: string; data: FlowNodeData } | null;
    workflow: { name: string; description: string };
    argDefaults: { target_folder: string; filename_template: string; on_exists: string };
    onPrompt: (nodeId: string, prompt: string) => void;
    onRename: (nodeId: string, label: string) => void;
    onKindChange: (nodeId: string, kind: NodeKind) => Promise<boolean> | boolean;
    onWorkflowMeta: (patch: { name?: string; description?: string }) => void;
    onArgDefault: (key: string, value: string) => void;
    onDetectPorts: (nodeId: string) => void;
  } = $props();

  const info = $derived(node ? KIND_INFO[node.data.kind as NodeKind] : null);
  const iconPath = $derived(info?.icon ?? FALLBACK_ICON);
  const accent = $derived(info?.color ?? "var(--text-muted)");
  const showPrompt = $derived(node ? PROMPT_KINDS.includes(node.data.kind as NodeKind) : false);
</script>

<div class="pflow-inspector">
  {#if !node}
    <!-- ── Mode B: workflow config (this is where Config lives) ── -->
    <header class="pflow-insp__header">
      <div class="pflow-insp__header-row">
        <svg class="pflow-insp__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z" />
        </svg>
        <div class="pflow-insp__titles">
          <h2 class="pflow-insp__title">Workflow</h2>
        </div>
      </div>
      <p class="pflow-insp__desc">
        The workflow's identity and save defaults. These compile into the generated workflow's args.
      </p>
    </header>

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">Name</h3>
      <p class="pflow-insp__help">The workflow's name — how it's invoked. Letters, digits, <code>-</code> and <code>_</code>.</p>
      <input
        class="pflow-insp__input"
        type="text"
        value={workflow.name}
        oninput={(e) => onWorkflowMeta({ name: (e.currentTarget as HTMLInputElement).value })}
      />
    </section>

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">Description</h3>
      <p class="pflow-insp__help">One line. States what the workflow does; it appears in the generated workflow's meta.</p>
      <textarea
        class="pflow-insp__input pflow-insp__textarea"
        rows="3"
        value={workflow.description}
        oninput={(e) => onWorkflowMeta({ description: (e.currentTarget as HTMLTextAreaElement).value })}
      ></textarea>
    </section>

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">Save defaults</h3>
      <p class="pflow-insp__help">Default values for the save step, overridable at run time.</p>
      <label class="pflow-insp__field">
        <span class="pflow-insp__field-label">target_folder</span>
        <input class="pflow-insp__input" type="text" value={argDefaults.target_folder}
          oninput={(e) => onArgDefault("target_folder", (e.currentTarget as HTMLInputElement).value)} />
      </label>
      <label class="pflow-insp__field">
        <span class="pflow-insp__field-label">filename_template</span>
        <input class="pflow-insp__input" type="text" value={argDefaults.filename_template}
          oninput={(e) => onArgDefault("filename_template", (e.currentTarget as HTMLInputElement).value)} />
      </label>
      <label class="pflow-insp__field">
        <span class="pflow-insp__field-label">on_exists</span>
        <input class="pflow-insp__input" type="text" value={argDefaults.on_exists}
          oninput={(e) => onArgDefault("on_exists", (e.currentTarget as HTMLInputElement).value)} />
      </label>
    </section>
  {:else}
    <!-- ── Mode A: node selected ── -->
    <header class="pflow-insp__header" style:--pflow-accent={accent}>
      <div class="pflow-insp__header-row">
        <svg class="pflow-insp__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label={node.data.kind} role="img">
          <title>{node.data.kind}</title>
          <path d={iconPath} />
        </svg>
        <div class="pflow-insp__titles">
          <h2 class="pflow-insp__title">{node.data.label}</h2>
          <span class="pflow-insp__kind">{info?.title ?? node.data.kind}</span>
        </div>
      </div>
      {#if info}
        <p class="pflow-insp__desc">{info.description}</p>
      {/if}
    </header>

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">Name</h3>
      <p class="pflow-insp__help">How this node reads on the canvas.</p>
      <input
        class="pflow-insp__input"
        type="text"
        value={node.data.label}
        oninput={(e) => onRename(node!.id, (e.currentTarget as HTMLInputElement).value)}
      />
    </section>

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">Type</h3>
      <p class="pflow-insp__help">Changing the type resets this node's ports; wires that no longer fit are removed after confirmation.</p>
      <select
        class="pflow-insp__input pflow-insp__select"
        value={node.data.kind}
        onchange={async (e) => {
          const select = e.currentTarget as HTMLSelectElement;
          const prev = node!.data.kind;
          const applied = await onKindChange(node!.id, select.value as NodeKind);
          if (!applied) select.value = prev;
        }}
      >
        {#each NODE_KINDS as k (k)}
          <option value={k} disabled={!COMPILABLE_KINDS.includes(k)}>
            {KIND_INFO[k].title}{COMPILABLE_KINDS.includes(k) ? "" : " (not yet exportable)"}
          </option>
        {/each}
      </select>
    </section>

    {#if showPrompt}
      <section class="pflow-insp__section">
        <div class="pflow-insp__section-head">
          <h3 class="pflow-insp__section-title">Prompt</h3>
          <button
            class="pflow-insp__detect"
            type="button"
            title={"Scan the prompt and wrap existing port names as {{in:}}/{{out:}} tokens"}
            onclick={() => onDetectPorts(node!.id)}
          >Detect ports</button>
        </div>
        <p class="pflow-insp__help">The instruction this step runs. Write <code>{`{{in:name}}`}</code> or <code>{`{{out:name}}`}</code> (add <code>:json</code> or <code>:table</code> for structured data) to declare ports; they appear as knobs on the card and colour here.</p>
        <PromptField
          value={node.data.prompt ?? ""}
          onInput={(next) => onPrompt(node!.id, next)}
        />
      </section>
    {/if}

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">Ports</h3>
      {#if node.data.inputs.length === 0 && node.data.outputs.length === 0}
        <p class="pflow-insp__empty">This node has no ports.</p>
      {/if}
      {#if node.data.inputs.length > 0}
        <div class="pflow-insp__ports-h">Inputs</div>
        {#each node.data.inputs as p (p.id)}
          <div class="pflow-insp__port">
            <span class="pflow-insp__port-name">{p.name}{p.required === false ? "" : " *"}</span>
            <span class="pflow-insp__port-type">{p.schema.type}</span>
          </div>
        {/each}
      {/if}
      {#if node.data.outputs.length > 0}
        <div class="pflow-insp__ports-h">Outputs</div>
        {#each node.data.outputs as p (p.id)}
          <div class="pflow-insp__port">
            <span class="pflow-insp__port-name">{p.name}</span>
            <span class="pflow-insp__port-type">{p.schema.type}</span>
          </div>
        {/each}
      {/if}
    </section>
  {/if}
</div>

<style>
  .pflow-inspector {
    height: 100%;
    overflow-y: auto;
    background: var(--background-secondary);
    color: var(--text-normal);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
  }

  /* ── Header ── */
  .pflow-insp__header {
    padding: var(--size-4-3) var(--size-4-3) var(--size-4-2);
    border-bottom: 1px solid var(--background-modifier-border);
    border-left: 4px solid var(--pflow-accent, transparent);
    background: var(--background-secondary-alt, var(--background-secondary));
  }
  .pflow-insp__header-row {
    display: flex;
    align-items: center;
    gap: var(--size-2-3);
    margin-bottom: var(--size-2-2);
  }
  .pflow-insp__icon {
    flex: none;
    width: 20px;
    height: 20px;
    color: var(--pflow-accent, var(--text-muted));
  }
  .pflow-insp__titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .pflow-insp__title {
    margin: 0;
    font-size: var(--font-ui-medium);
    font-weight: var(--font-semibold);
    color: var(--text-normal);
    line-height: 1.2;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pflow-insp__kind {
    font-size: var(--font-ui-smaller);
    color: var(--pflow-accent, var(--text-accent));
    font-weight: var(--font-medium);
  }
  .pflow-insp__desc {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.5;
  }

  /* ── Section ── */
  .pflow-insp__section {
    padding: var(--size-4-3);
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .pflow-insp__section:last-child {
    border-bottom: none;
  }
  .pflow-insp__section-title {
    margin: 0 0 var(--size-2-2) 0;
    font-size: var(--font-ui-smaller);
    font-weight: var(--font-semibold);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }
  /* A section title with a trailing action button (e.g. Prompt + Detect ports). */
  .pflow-insp__section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--size-2-2);
    margin-bottom: var(--size-2-2);
  }
  .pflow-insp__section-head .pflow-insp__section-title {
    margin: 0;
  }
  .pflow-insp__detect {
    flex: none;
    padding: var(--size-2-1) var(--size-2-3);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    cursor: pointer;
  }
  .pflow-insp__detect:hover {
    color: var(--text-normal);
    border-color: var(--interactive-accent);
  }
  .pflow-insp__help {
    margin: 0 0 var(--size-2-3) 0;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller);
    line-height: 1.45;
  }
  .pflow-insp__help code {
    font-family: var(--font-monospace);
    color: var(--text-accent);
    font-size: 0.95em;
  }
  .pflow-insp__empty {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    font-style: italic;
  }

  /* ── Form controls ── */
  .pflow-insp__input {
    width: 100%;
    box-sizing: border-box;
    padding: var(--size-2-2) var(--size-2-3);
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
  }
  .pflow-insp__input:focus {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -1px;
  }
  .pflow-insp__textarea {
    resize: vertical;
    min-height: 4em;
    line-height: 1.5;
  }
  .pflow-insp__select {
    appearance: auto;
  }

  /* ── Save-defaults fields ── */
  .pflow-insp__field {
    display: block;
    margin-bottom: var(--size-2-3);
  }
  .pflow-insp__field:last-child {
    margin-bottom: 0;
  }
  .pflow-insp__field-label {
    display: block;
    margin-bottom: var(--size-2-1);
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-muted);
  }

  /* ── Ports ── */
  .pflow-insp__ports-h {
    margin: var(--size-2-3) 0 var(--size-2-1);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    font-weight: var(--font-medium);
  }
  .pflow-insp__ports-h:first-child {
    margin-top: 0;
  }
  .pflow-insp__port {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--size-2-2);
    padding: var(--size-2-1) var(--size-2-3);
    background: var(--background-primary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    margin-bottom: var(--size-2-1);
  }
  .pflow-insp__port-name {
    color: var(--text-normal);
  }
  .pflow-insp__port-type {
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
    color: var(--text-faint);
  }
</style>
