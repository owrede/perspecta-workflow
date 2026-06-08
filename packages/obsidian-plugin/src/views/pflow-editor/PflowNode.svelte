<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
  import type { FlowNodeData } from "./flow-map.js";
  import { iconForKind } from "./kind-info.js";

  let { data }: { data: FlowNodeData } = $props();

  // Vertical geometry (px). The header is fixed-height; each port is one row.
  // A Handle is pinned to the card edge at each port row's vertical center.
  const HEADER = 40;
  const ROW = 24;
  const inTop = (i: number) => HEADER + i * ROW + ROW / 2;
  const outTop = (i: number) => HEADER + (data.inputs.length + i) * ROW + ROW / 2;

  // Per-kind icon (Lucide path, viewBox 0 0 24 24), shared with the inspector
  // via kind-info so node + inspector never drift.
  let iconPath = $derived(iconForKind(data.kind));

  // A loop is a "backwards" movement (do this, then RETURN there), so we mirror
  // the node: inputs on the RIGHT edge, outputs on the LEFT edge, accent border
  // on the right. This stops the draft⇄review wires from criss-crossing.
  let flipped = $derived(data.kind === "loop");
  let inSide = $derived(flipped ? Position.Right : Position.Left);
  let outSide = $derived(flipped ? Position.Left : Position.Right);
</script>

<div class="pflow-node pflow-node--{data.kind}" class:pflow-node--flipped={flipped}>
  <div class="pflow-node__header">
    <span class="pflow-node__title">{data.label}</span>
    <svg
      class="pflow-node__icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-label={data.kind}
      role="img"
    >
      <title>{data.kind}</title>
      <path d={iconPath} />
    </svg>
  </div>

  {#if data.kind === "mcp"}
    <div class="pflow-node__service" class:pflow-node__service--unset={!data.mcpServer}>
      {data.mcpServer ? `↗ ${data.mcpServer}` : "no service"}
    </div>
  {/if}

  <div class="pflow-node__ports">
    {#each data.inputs as port, i (port.id)}
      <div class="pflow-port pflow-port--in">
        <span class="pflow-port__name">{port.name}</span>
      </div>
      <!-- The Handle IS the connection dot, pinned to the node edge at this row.
           For a flipped (loop) node, inputs sit on the RIGHT edge. -->
      <Handle
        type="target"
        position={inSide}
        id={port.id}
        class="pflow-handle pflow-handle--in {port.wired ? 'pflow-handle--wired' : ''}"
        style={`top:${inTop(i)}px`}
      />
    {/each}

    {#each data.outputs as port, i (port.id)}
      <div class="pflow-port pflow-port--out">
        <span class="pflow-port__name">{port.name}</span>
      </div>
      <Handle
        type="source"
        position={outSide}
        id={port.id}
        class="pflow-handle pflow-handle--out {port.wired ? 'pflow-handle--wired' : ''}"
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
    /* the 4px accent stripe is on the inflow side; flipped nodes move it right */
  }
  /* Flipped (loop) node: inflow is on the right, so move the accent stripe and
     mirror the port-row text alignment to match the swapped handles. */
  .pflow-node--flipped {
    border-left: 1px solid var(--background-modifier-border);
    border-right: 4px solid var(--pflow-accent, var(--text-muted));
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

  /* Selected state: xyflow adds `.selected` to the node wrapper it renders
     around this component. Style the ring from that, so selection is owned by
     xyflow alone (no parallel selection state to corrupt). :global because the
     wrapper is outside this component's scoped-style reach. */
  :global(.svelte-flow__node.selected) .pflow-node {
    border-color: var(--interactive-accent);
    box-shadow: 0 0 0 2px var(--interactive-accent);
  }

  .pflow-node__header {
    display: flex;
    align-items: center;
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
  /* The kind icon sits where the kind text used to. Coloured with the node's
     accent so the icon reinforces the kind at a glance. */
  .pflow-node__icon {
    flex: none;
    width: 16px;
    height: 16px;
    color: var(--pflow-accent, var(--text-muted));
  }

  .pflow-node__service {
    padding: 2px 10px 4px;
    font-size: var(--font-ui-smaller);
    font-weight: 500;
    color: var(--text-accent);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pflow-node__service--unset {
    color: var(--text-error, var(--text-muted));
    font-style: italic;
    font-weight: 400;
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
  /* Flipped node mirrors the alignment: inputs (right edge) align right,
     outputs (left edge) align left. */
  .pflow-node--flipped .pflow-port--in { justify-content: flex-end; }
  .pflow-node--flipped .pflow-port--out { justify-content: flex-start; }
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
  /* A wired (connected) handle is FILLED; an unconnected one stays hollow.
     Outputs fill with the accent colour (they drive a wire); inputs fill with
     the muted dot. Independent of `required`. */
  :global(.pflow-handle--wired.pflow-handle--in.svelte-flow__handle) {
    background: var(--text-muted);
  }
  :global(.pflow-handle--wired.pflow-handle--out.svelte-flow__handle) {
    border-color: var(--interactive-accent, var(--text-accent));
    background: var(--interactive-accent, var(--text-accent));
  }
  :global(.pflow-handle.svelte-flow__handle:hover) {
    border-color: var(--interactive-accent, var(--text-accent));
    background: var(--interactive-accent, var(--text-accent));
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--interactive-accent) 30%, transparent);
  }
</style>
