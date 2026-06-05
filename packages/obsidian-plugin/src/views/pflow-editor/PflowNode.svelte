<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import type { FlowNodeData } from "./flow-map.js";

  let { data }: { data: FlowNodeData } = $props();
</script>

<div class="pflow-node pflow-node--{data.kind}">
  <div class="pflow-node__title">{data.label}</div>
  <div class="pflow-node__kind">{data.kind}</div>

  {#each data.inputs as port, i (port.id)}
    <Handle
      type="target"
      position={Position.Left}
      id={port.id}
      style={`top: ${36 + i * 20}px`}
    />
    <div class="pflow-port pflow-port--in" style={`top: ${28 + i * 20}px`}>{port.name}</div>
  {/each}

  {#each data.outputs as port, i (port.id)}
    <Handle
      type="source"
      position={Position.Right}
      id={port.id}
      style={`top: ${36 + i * 20}px`}
    />
    <div class="pflow-port pflow-port--out" style={`top: ${28 + i * 20}px`}>{port.name}</div>
  {/each}
</div>

<style>
  .pflow-node {
    position: relative;
    min-width: 180px;
    min-height: 64px;
    padding: 6px 10px;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--radius-m, 6px);
    color: var(--text-normal);
  }
  .pflow-node__title { font-weight: 600; font-size: var(--font-ui-small); }
  .pflow-node__kind { font-size: var(--font-ui-smaller); color: var(--text-muted); }
  .pflow-port {
    position: absolute;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
  .pflow-port--in { left: 12px; }
  .pflow-port--out { right: 12px; }
</style>
