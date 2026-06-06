<script lang="ts">
  import { NODE_KINDS, type NodeKind } from "@perspecta/core";
  import type { FlowNodeData } from "./flow-map.js";
  import { COMPILABLE_KINDS } from "./flow-map.js";

  let {
    node,
    workflow,
    argDefaults,
    onPrompt,
    onRename,
    onKindChange,
    onWorkflowMeta,
    onArgDefault,
  }: {
    node: { id: string; data: FlowNodeData } | null;
    workflow: { name: string; description: string };
    argDefaults: { target_folder: string; filename_template: string; on_exists: string };
    onPrompt: (nodeId: string, prompt: string) => void;
    onRename: (nodeId: string, label: string) => void;
    onKindChange: (nodeId: string, kind: NodeKind) => void;
    onWorkflowMeta: (patch: { name?: string; description?: string }) => void;
    onArgDefault: (key: string, value: string) => void;
  } = $props();
</script>

<div class="pflow-inspector">
  {#if !node}
    <!-- Nothing selected → workflow-level config (this is where Config lives,
         instead of a Config node on the canvas). -->
    <div class="pflow-inspector__title">Workflow</div>
    <label class="pflow-inspector__field">
      <span>Name</span>
      <input
        value={workflow.name}
        oninput={(e) => onWorkflowMeta({ name: (e.currentTarget as HTMLInputElement).value })}
      />
    </label>
    <label class="pflow-inspector__field">
      <span>Description</span>
      <textarea
        rows="3"
        value={workflow.description}
        oninput={(e) => onWorkflowMeta({ description: (e.currentTarget as HTMLTextAreaElement).value })}
      ></textarea>
    </label>

    <div class="pflow-inspector__ports-h">Save defaults</div>
    <label class="pflow-inspector__field">
      <span>target_folder</span>
      <input
        value={argDefaults.target_folder}
        oninput={(e) => onArgDefault("target_folder", (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <label class="pflow-inspector__field">
      <span>filename_template</span>
      <input
        value={argDefaults.filename_template}
        oninput={(e) => onArgDefault("filename_template", (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <label class="pflow-inspector__field">
      <span>on_exists</span>
      <input
        value={argDefaults.on_exists}
        oninput={(e) => onArgDefault("on_exists", (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
  {:else}
    <label class="pflow-inspector__field">
      <span>Name</span>
      <input
        class="pflow-inspector__name"
        value={node.data.label}
        oninput={(e) => onRename(node!.id, (e.currentTarget as HTMLInputElement).value)}
      />
    </label>
    <label class="pflow-inspector__field">
      <span>Type</span>
      <select
        class="pflow-inspector__type"
        value={node.data.kind}
        onchange={(e) => onKindChange(node!.id, (e.currentTarget as HTMLSelectElement).value as NodeKind)}
      >
        {#each NODE_KINDS as k (k)}
          <option value={k} disabled={!COMPILABLE_KINDS.includes(k)}>
            {k}{COMPILABLE_KINDS.includes(k) ? "" : " (not yet exportable)"}
          </option>
        {/each}
      </select>
    </label>

    <label class="pflow-inspector__field">
      <span>Prompt</span>
      <textarea
        rows="6"
        value={node.data.prompt ?? ""}
        oninput={(e) => onPrompt(node!.id, (e.currentTarget as HTMLTextAreaElement).value)}
      ></textarea>
    </label>

    <div class="pflow-inspector__ports">
      <div class="pflow-inspector__ports-h">Inputs</div>
      {#each node.data.inputs as p (p.id)}
        <div class="pflow-inspector__port">{p.name}: {p.schema.type}{p.required === false ? "" : " *"}</div>
      {/each}
      <div class="pflow-inspector__ports-h">Outputs</div>
      {#each node.data.outputs as p (p.id)}
        <div class="pflow-inspector__port">{p.name}: {p.schema.type}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .pflow-inspector { padding: 10px; height: 100%; overflow-y: auto; color: var(--text-normal); }
  .pflow-inspector__title { font-weight: 600; margin-bottom: 8px; }
  .pflow-inspector__field { display: block; margin: 8px 0; }
  .pflow-inspector__field span { display: block; font-size: var(--font-ui-smaller); color: var(--text-muted); }
  .pflow-inspector__field input,
  .pflow-inspector__field textarea,
  .pflow-inspector__field select { width: 100%; }
  .pflow-inspector__field textarea { resize: vertical; }
  .pflow-inspector__ports-h { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: 8px; }
  .pflow-inspector__port { font-size: var(--font-ui-small); }
</style>
