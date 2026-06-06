<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import type { FlowNodeData } from "./flow-map.js";

  let { data }: { data: FlowNodeData } = $props();

  // Vertical geometry (px). The header is fixed-height; each port is one row.
  // A Handle is pinned to the card edge at each port row's vertical center.
  const HEADER = 40;
  const ROW = 24;
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
        <span class="pflow-port__name">{port.name}</span>
      </div>
      <!-- The Handle IS the connection dot, pinned to the left edge at this row. -->
      <Handle
        type="target"
        position={Position.Left}
        id={port.id}
        class="pflow-handle pflow-handle--in {port.required === false ? '' : 'pflow-handle--req'}"
        style={`top:${inTop(i)}px`}
      />
    {/each}

    {#each data.outputs as port, i (port.id)}
      <div class="pflow-port pflow-port--out">
        <span class="pflow-port__name">{port.name}</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id={port.id}
        class="pflow-handle pflow-handle--out"
        style={`top:${outTop(i)}px`}
      />
    {/each}
  </div>
</div>

<style>
  .pflow-node {
    position: relative;
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
    height: 40px;
    box-sizing: border-box;
    padding: 8px 12px 6px;
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
    height: 24px;
    padding: 0 14px;
    font-size: var(--font-ui-smaller);
    color: var(--text-muted);
  }
  .pflow-port--out { justify-content: flex-end; }
  .pflow-port__name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* The connection handles: real, grabbable dots sitting ON the card edges.
     :global is required because xyflow renders the Handle outside this
     component's scoped-style reach. We keep xyflow's left/right edge transform
     (it pins to the edge) and only override size, colour, and — critically —
     pointer-events, so the dot can be dragged to create a wire. The inline
     `top` style on each Handle places it at its port row. */
  :global(.pflow-handle.svelte-flow__handle) {
    width: 12px;
    height: 12px;
    min-width: 12px;
    min-height: 12px;
    border-radius: 50%;
    background: var(--background-secondary);
    border: 2px solid var(--text-muted);
    pointer-events: all;
    cursor: crosshair;
    transition: border-color 80ms ease-out, background 80ms ease-out;
  }
  :global(.pflow-handle--req.svelte-flow__handle) {
    background: var(--text-muted);
  }
  :global(.pflow-handle--out.svelte-flow__handle) {
    border-color: var(--interactive-accent, var(--text-accent));
    background: var(--interactive-accent, var(--text-accent));
  }
  :global(.pflow-handle.svelte-flow__handle:hover) {
    border-color: var(--interactive-accent, var(--text-accent));
    background: var(--interactive-accent, var(--text-accent));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive-accent) 30%, transparent);
  }
</style>
