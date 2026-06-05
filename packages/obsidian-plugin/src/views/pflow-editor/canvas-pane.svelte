<!--
  canvas-pane — Svelte Flow wrapper for the .pflow node graph.

  Renders the workflow as a Svelte Flow canvas using the custom `pflow`
  node type (PflowNode.svelte). Owns no document state: it receives
  `flowNodes` / `flowEdges` (already mapped from the PflowDocument by
  flow-map.ts) and emits two upward signals:

    - onMove(nodeId, x, y)      — a node finished dragging to a new spot
    - onSelect(nodeId | null)   — a node was clicked, or the pane cleared

  Event wiring (verified against @xyflow/svelte 1.6.0):
    - onnodedragstop — payload { targetNode, nodes, event }; targetNode
      may be null, so we guard before emitting onMove.
    - onnodeclick    — payload { node, event }; node.id drives onSelect.
    - onpaneclick    — payload { event } (no node); clears selection.
-->

<script lang="ts">
  import {
    SvelteFlow,
    Background,
    Controls,
    type Node,
    type Edge,
    type NodeProps,
  } from "@xyflow/svelte";
  import type { Component } from "svelte";
  import "@xyflow/svelte/dist/style.css";
  import PflowNodeRaw from "./PflowNode.svelte";
  import type { FlowNode, FlowEdge } from "./flow-map.js";

  let {
    flowNodes,
    flowEdges,
    onMove,
    onSelect,
  }: {
    flowNodes: FlowNode[];
    flowEdges: FlowEdge[];
    onMove: (nodeId: string, x: number, y: number) => void;
    onSelect: (nodeId: string | null) => void;
  } = $props();

  const PflowNode = PflowNodeRaw as unknown as Component<NodeProps>;
  const nodeTypes = { pflow: PflowNode };

  let nodes = $state<Node[]>([]);
  let edges = $state<Edge[]>([]);

  $effect(() => {
    nodes = flowNodes as unknown as Node[];
    edges = flowEdges as unknown as Edge[];
  });

  // onnodedragstop payload is { targetNode, nodes, event }; targetNode
  // is the dragged node (or null if the gesture had no single target).
  function handleNodeDragStop({ targetNode }: { targetNode: Node | null }) {
    if (targetNode) onMove(targetNode.id, targetNode.position.x, targetNode.position.y);
  }
</script>

<div class="pflow-canvas-pane">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    fitView
    onnodedragstop={handleNodeDragStop}
    onnodeclick={({ node }) => onSelect(node.id)}
    onpaneclick={() => onSelect(null)}
    proOptions={{ hideAttribution: true }}
  >
    <Background />
    <Controls />
  </SvelteFlow>
</div>

<style>
  .pflow-canvas-pane {
    width: 100%;
    height: 100%;
  }
</style>
