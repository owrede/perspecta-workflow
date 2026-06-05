<script lang="ts">
  import type { FlowNodeData } from "./flow-map.js";

  let {
    node,
    onPrompt,
  }: {
    node: { id: string; data: FlowNodeData } | null;
    onPrompt: (nodeId: string, prompt: string) => void;
  } = $props();
</script>

<div class="pflow-inspector">
  {#if !node}
    <div class="pflow-inspector__empty">Select a node to edit it.</div>
  {:else}
    <div class="pflow-inspector__title">{node.data.label}</div>
    <div class="pflow-inspector__kind">{node.data.kind}</div>

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
  .pflow-inspector__empty { color: var(--text-muted); }
  .pflow-inspector__title { font-weight: 600; }
  .pflow-inspector__kind { color: var(--text-muted); font-size: var(--font-ui-smaller); margin-bottom: 8px; }
  .pflow-inspector__field { display: block; margin: 8px 0; }
  .pflow-inspector__field span { display: block; font-size: var(--font-ui-smaller); color: var(--text-muted); }
  .pflow-inspector__field textarea { width: 100%; resize: vertical; }
  .pflow-inspector__ports-h { font-size: var(--font-ui-smaller); color: var(--text-muted); margin-top: 8px; }
  .pflow-inspector__port { font-size: var(--font-ui-small); }
</style>
