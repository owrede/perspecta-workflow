<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import type { FlowNodeData } from "./flow-map.js";

  let { data }: { data: FlowNodeData } = $props();

  // Vertical geometry (px) used to line each port's connection Handle up with
  // its label row. Header is ~38px; each port row is 22px tall.
  const HEADER = 40;
  const ROW = 22;
  const inTop = (i: number) => HEADER + i * ROW + ROW / 2;
  const outTop = (i: number) => HEADER + (data.inputs.length + i) * ROW + ROW / 2;
</script>

<div class="pflow-node pflow-node--{data.kind}">
  <div class="pflow-node__header">
    <span class="pflow-node__title">{data.label}</span>
    <span class="pflow-node__kind">{data.kind}</span>
  </div>

  <div class="pflow-node__ports">
    {#each data.inputs as port, i (port.id)}
      <div class="pflow-port pflow-port--in">
        <span class="pflow-port__dot" class:req={port.required !== false}></span>
        <span class="pflow-port__name">{port.name}</span>
      </div>
      <Handle type="target" position={Position.Left} id={port.id} style={`top:${inTop(i)}px`} />
    {/each}

    {#each data.outputs as port, i (port.id)}
      <div class="pflow-port pflow-port--out">
        <span class="pflow-port__name">{port.name}</span>
        <span class="pflow-port__dot"></span>
      </div>
      <Handle type="source" position={Position.Right} id={port.id} style={`top:${outTop(i)}px`} />
    {/each}
  </div>
</div>

<style>
  .pflow-node {
    box-sizing: border-box;
    width: 100%;
    background: var(--background-secondary);
    border: 1px solid var(--background-modifier-border);
    border-left: 4px solid var(--pflow-accent, var(--text-muted));
    border-radius: var(--radius-m, 6px);
    color: var(--text-normal);
    font-family: var(--font-interface);
    font-size: var(--font-ui-small);
    box-shadow: var(--shadow-s, 0 1px 2px rgba(0, 0, 0, 0.08));
    overflow: hidden;
  }

  /* kind accent colours (left border) */
  .pflow-node--input { --pflow-accent: var(--color-green, #4caf50); }
  .pflow-node--output { --pflow-accent: var(--color-red, #e05252); }
  .pflow-node--agent { --pflow-accent: var(--color-purple, #9c6ade); }
  .pflow-node--split,
  .pflow-node--join { --pflow-accent: var(--color-yellow, #d9a334); }
  .pflow-node--loop { --pflow-accent: var(--color-orange, #d9772e); }
  .pflow-node--verify,
  .pflow-node--synthesize,
  .pflow-node--branch { --pflow-accent: var(--color-cyan, #2e9bd9); }
  .pflow-node--script { --pflow-accent: var(--text-faint, #888); }

  .pflow-node__header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: var(--size-4-2, 8px);
    padding: 8px 10px 6px;
    height: 40px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--background-modifier-border);
  }
  .pflow-node__title {
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pflow-node__kind {
    flex: none;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
    text-transform: lowercase;
  }

  .pflow-node__ports { padding: 4px 0; }
  .pflow-port {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 10px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
  .pflow-port--out { justify-content: flex-end; }
  .pflow-port__name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pflow-port__dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--background-modifier-border);
    border: 1px solid var(--text-faint);
  }
  .pflow-port__dot.req { background: var(--text-muted); }
</style>
