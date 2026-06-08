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
  import { NODE_KINDS, type NodeKind, type PflowError } from "@perspecta/core";
  import type { FlowNodeData } from "./flow-map.js";
  import { COMPILABLE_KINDS, grantSummary } from "./flow-map.js";
  import { KIND_INFO, FALLBACK_ICON, PROMPT_KINDS } from "./kind-info.js";
  import PromptField from "./prompt-field.svelte";
  import { isPortTokenLocked } from "./flow-map.js";
  import type { TokenType } from "@perspecta/core";

  // Token type ↔ schema type mapping for the inspector's type picker.
  const TYPE_OPTIONS: { value: TokenType; label: string }[] = [
    { value: "string", label: "string" },
    { value: "json", label: "json" },
    { value: "table", label: "table" },
  ];
  function schemaToTokenType(t: string): TokenType {
    if (t === "object") return "json";
    if (t === "array") return "table";
    return "string";
  }

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
    onAddPort,
    onRemovePort,
    onPortType,
    onPortRename,
    onExport,
    registry,
    mcpWarnings,
    onMcpServer,
    onEvalMode,
    onBlockOnFail,
    resourceSummary,
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
    onAddPort: (nodeId: string, dir: "in" | "out", name: string, type: TokenType) => void;
    onRemovePort: (nodeId: string, dir: "in" | "out", portId: string) => void;
    onPortType: (nodeId: string, dir: "in" | "out", name: string, type: TokenType) => void;
    onPortRename: (nodeId: string, dir: "in" | "out", oldName: string, newName: string) => void;
    // Export the workflow to a Claude Code dynamic workflow file. Resolves to the
    // written vault-relative path, or rejects with the validation/codegen error.
    onExport: () => Promise<string>;
    registry: import("@perspecta/core").McpRegistry;
    mcpWarnings: PflowError[];
    onMcpServer: (nodeId: string, server: string) => void;
    onEvalMode: (nodeId: string, mode: import("./eval-templates.js").EvalMode) => void;
    onBlockOnFail: (nodeId: string, value: boolean) => void;
    resourceSummary: import("@perspecta/core").WorkflowResourceSummary;
  } = $props();

  // Export-button state (Mode B only): idle → busy → ok/err, with the result
  // message shown inline so the user sees WHERE it was written or WHY it failed.
  let exportState = $state<"idle" | "busy" | "ok" | "err">("idle");
  let exportMsg = $state("");
  async function runExport() {
    exportState = "busy";
    exportMsg = "";
    try {
      const path = await onExport();
      exportState = "ok";
      exportMsg = path;
    } catch (e) {
      exportState = "err";
      exportMsg = (e as Error).message;
    }
  }

  // A unique default name for a newly added port (in1, in2, …).
  function nextPortName(existing: { name: string }[], dir: "in" | "out"): string {
    let i = existing.length + 1;
    let name = `${dir}${i}`;
    const taken = new Set(existing.map((p) => p.name));
    while (taken.has(name)) name = `${dir}${++i}`;
    return name;
  }

  const info = $derived(node ? KIND_INFO[node.data.kind as NodeKind] : null);
  const iconPath = $derived(info?.icon ?? FALLBACK_ICON);
  const accent = $derived(info?.color ?? "var(--text-muted)");
  const showPrompt = $derived(node ? PROMPT_KINDS.includes(node.data.kind as NodeKind) : false);

  // Whitelisted + hot servers, for the MCP service picker.
  const hotServerNames = $derived(
    Object.entries(registry)
      .filter(([, r]) => r.whitelisted && r.probe.status === "hot")
      .map(([name]) => name)
      .sort(),
  );

  // MCP lint warnings for the currently selected node (filtered from the editor-computed list).
  const nodeWarnings = $derived(
    node ? mcpWarnings.filter((e) => e.nodeId === node.id) : [],
  );
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

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">External Resources</h3>
      {#if resourceSummary.services.length === 0}
        <p class="pflow-insp__help">This workflow uses no external services.</p>
      {:else}
        {#each resourceSummary.services as s}
          <p class="pflow-insp__help">
            <strong>{s.server}</strong> — used by {s.nodeCount} node{s.nodeCount === 1 ? "" : "s"}
            {#if s.available}
              · {s.allow} always / {s.ask} ask / {s.blocked} blocked
            {:else}
              · <span class="pflow-insp__warn">⚠ not available in this vault</span>
            {/if}
          </p>
        {/each}
        {#if !resourceSummary.allMet && resourceSummary.services.length > 1}
          <p class="pflow-insp__warn">⚠ Some services this workflow needs are not available in this vault.</p>
        {/if}
      {/if}
    </section>

    <section class="pflow-insp__section">
      <h3 class="pflow-insp__section-title">Export</h3>
      <p class="pflow-insp__help">
        Compile this workflow to a Claude Code dynamic workflow at
        <code>.claude/workflows/{workflow.name || "&lt;name&gt;"}.js</code>, callable
        with the workflow command.
      </p>
      <button
        type="button"
        class="pflow-insp__export-btn"
        disabled={exportState === "busy"}
        onclick={runExport}
      >
        {exportState === "busy" ? "Exporting…" : "Export to Claude Code"}
      </button>
      {#if exportState === "ok"}
        <p class="pflow-insp__export-msg pflow-insp__export-msg--ok">Wrote <code>{exportMsg}</code></p>
      {:else if exportState === "err"}
        <p class="pflow-insp__export-msg pflow-insp__export-msg--err">{exportMsg}</p>
      {/if}
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

    {#if node.data.kind === "mcp"}
      <section class="pflow-insp__section">
        <h3 class="pflow-insp__section-title">Service</h3>
        <p class="pflow-insp__help">The external MCP server this step talks to.</p>
        <select
          class="pflow-insp__input"
          value={node.data.mcpServer ?? ""}
          onchange={(e) => onMcpServer(node!.id, (e.currentTarget as HTMLSelectElement).value)}
        >
          <option value="">— select a service —</option>
          {#if node.data.mcpServer && !hotServerNames.includes(node.data.mcpServer)}
            <option value={node.data.mcpServer} disabled>{node.data.mcpServer} (unavailable)</option>
          {/if}
          {#each hotServerNames as name}<option value={name}>{name}</option>{/each}
        </select>
        {#if node.data.mcpServer}
          <p class="pflow-insp__help">{grantSummary(registry, node.data.mcpServer)}</p>
        {/if}
        {#each nodeWarnings as w}
          <p class="pflow-insp__warn">⚠ {w.message}</p>
        {/each}
      </section>
    {/if}

    {#if node.data.kind === "eval"}
      <section class="pflow-insp__section">
        <h3 class="pflow-insp__section-title">Mode</h3>
        <p class="pflow-insp__help">The evaluation strategy. Changing it swaps the prompt for the mode's template (you'll be asked before an existing prompt is replaced).</p>
        <select
          class="pflow-insp__input pflow-insp__select"
          aria-label="Evaluation mode"
          value={node.data.evalMode ?? "criteria"}
          onchange={(e) =>
            onEvalMode(
              node!.id,
              (e.currentTarget as HTMLSelectElement).value as import("./eval-templates.js").EvalMode,
            )}
        >
          <option value="criteria">criteria — vs a rubric</option>
          <option value="comparison">comparison — vs a reference</option>
          <option value="threshold">threshold — score vs a bound</option>
        </select>
        <label class="pflow-insp__checkbox">
          <input
            type="checkbox"
            checked={node.data.blockOnFail === true}
            onchange={(e) => onBlockOnFail(node!.id, (e.currentTarget as HTMLInputElement).checked)}
          />
          Block on fail (halt the run on a failed verdict)
        </label>
      </section>
    {/if}

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
      <p class="pflow-insp__help">Define this node's connection points. A port declared by a prompt token shows a <span class="pflow-insp__lockbadge">from prompt</span> badge and is edited via the prompt; ports added here can be renamed, retyped, or removed.</p>

      {#if node.data.kind !== "input"}
        <div class="pflow-insp__ports-h">Inputs</div>
        {#each node.data.inputs as p (p.id)}
          {@const locked = isPortTokenLocked({ prompt: node.data.prompt }, p, "in")}
          <div class="pflow-insp__portrow">
            <input
              class="pflow-insp__port-name-input"
              type="text"
              value={p.name}
              disabled={locked}
              onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value.trim(); if (v && v !== p.name) onPortRename(node!.id, "in", p.name, v); }}
            />
            <select
              class="pflow-insp__port-type-select"
              value={schemaToTokenType(p.schema.type)}
              onchange={(e) => onPortType(node!.id, "in", p.name, (e.currentTarget as HTMLSelectElement).value as TokenType)}
            >
              {#each TYPE_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
            {#if locked}
              <span class="pflow-insp__lockbadge" title="Declared by a prompt token; edit it in the prompt.">from prompt</span>
            {:else}
              <button class="pflow-insp__port-remove" type="button" title="Remove port" aria-label="Remove input port" onclick={() => onRemovePort(node!.id, "in", p.id)}>×</button>
            {/if}
          </div>
        {/each}
        <button class="pflow-insp__add-port" type="button" onclick={() => onAddPort(node!.id, "in", nextPortName(node!.data.inputs, "in"), "string")}>+ Add input</button>
      {/if}

      {#if node.data.kind !== "output"}
        <div class="pflow-insp__ports-h">Outputs</div>
        {#each node.data.outputs as p (p.id)}
          {@const locked = isPortTokenLocked({ prompt: node.data.prompt }, p, "out")}
          <div class="pflow-insp__portrow">
            <input
              class="pflow-insp__port-name-input"
              type="text"
              value={p.name}
              disabled={locked}
              onchange={(e) => { const v = (e.currentTarget as HTMLInputElement).value.trim(); if (v && v !== p.name) onPortRename(node!.id, "out", p.name, v); }}
            />
            <select
              class="pflow-insp__port-type-select"
              value={schemaToTokenType(p.schema.type)}
              onchange={(e) => onPortType(node!.id, "out", p.name, (e.currentTarget as HTMLSelectElement).value as TokenType)}
            >
              {#each TYPE_OPTIONS as o (o.value)}<option value={o.value}>{o.label}</option>{/each}
            </select>
            {#if locked}
              <span class="pflow-insp__lockbadge" title="Declared by a prompt token; edit it in the prompt.">from prompt</span>
            {:else}
              <button class="pflow-insp__port-remove" type="button" title="Remove port" aria-label="Remove output port" onclick={() => onRemovePort(node!.id, "out", p.id)}>×</button>
            {/if}
          </div>
        {/each}
        <button class="pflow-insp__add-port" type="button" onclick={() => onAddPort(node!.id, "out", nextPortName(node!.data.outputs, "out"), "string")}>+ Add output</button>
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
  /* Export CTA: accent-filled call-to-action button, full width of the section. */
  .pflow-insp__export-btn {
    width: 100%;
    padding: var(--size-2-2) var(--size-2-3);
    font-size: var(--font-ui-small);
    font-weight: 500;
    color: var(--text-on-accent);
    background: var(--interactive-accent);
    border: none;
    border-radius: var(--radius-s);
    cursor: pointer;
  }
  .pflow-insp__export-btn:hover:not(:disabled) {
    background: var(--interactive-accent-hover);
  }
  .pflow-insp__export-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .pflow-insp__export-msg {
    margin: var(--size-2-3) 0 0 0;
    font-size: var(--font-ui-smaller);
    line-height: 1.45;
    word-break: break-all;
  }
  .pflow-insp__export-msg code {
    font-family: var(--font-monospace);
    font-size: 0.95em;
  }
  .pflow-insp__export-msg--ok { color: var(--text-success, var(--text-muted)); }
  .pflow-insp__export-msg--err { color: var(--text-error, var(--text-muted)); }
  .pflow-insp__warn {
    color: var(--text-error, var(--text-muted));
    font-size: var(--font-ui-smaller);
    margin: 2px 0 0;
  }
  .pflow-insp__empty {
    margin: 0;
    color: var(--text-faint);
    font-size: var(--font-ui-smaller);
    font-style: italic;
  }
  .pflow-insp__checkbox {
    display: flex;
    align-items: center;
    gap: var(--size-2-2);
    margin-top: var(--size-2-3);
    font-size: var(--font-ui-smaller);
    color: var(--text-normal);
    cursor: pointer;
  }
  .pflow-insp__checkbox input {
    margin: 0;
    cursor: pointer;
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
  /* ── Editable port rows ── */
  .pflow-insp__portrow {
    display: flex;
    align-items: center;
    gap: var(--size-2-1);
    margin-bottom: var(--size-2-1);
  }
  .pflow-insp__port-name-input {
    flex: 1 1 auto;
    min-width: 0;
    box-sizing: border-box;
    padding: var(--size-2-1) var(--size-2-2);
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    font-family: var(--font-interface);
    font-size: var(--font-ui-smaller);
  }
  .pflow-insp__port-name-input:focus {
    outline: 2px solid var(--interactive-accent);
    outline-offset: -1px;
  }
  .pflow-insp__port-name-input:disabled {
    color: var(--text-muted);
    background: var(--background-secondary);
  }
  .pflow-insp__port-type-select {
    flex: none;
    appearance: auto;
    padding: var(--size-2-1) var(--size-2-2);
    background: var(--background-primary);
    color: var(--text-normal);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    font-family: var(--font-monospace);
    font-size: var(--font-smaller);
  }
  .pflow-insp__lockbadge {
    flex: none;
    padding: 0 var(--size-2-1);
    font-size: var(--font-smaller);
    color: var(--text-accent);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    white-space: nowrap;
  }
  .pflow-insp__port-remove {
    flex: none;
    width: 22px;
    height: 22px;
    line-height: 1;
    padding: 0;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-s);
    cursor: pointer;
  }
  .pflow-insp__port-remove:hover {
    color: var(--text-on-accent, #fff);
    background: var(--color-red, #e05252);
    border-color: var(--color-red, #e05252);
  }
  .pflow-insp__add-port {
    margin-top: var(--size-2-1);
    padding: var(--size-2-1) var(--size-2-3);
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    background: var(--background-primary);
    border: 1px dashed var(--background-modifier-border);
    border-radius: var(--radius-s);
    cursor: pointer;
  }
  .pflow-insp__add-port:hover {
    color: var(--text-normal);
    border-color: var(--interactive-accent);
  }
</style>
