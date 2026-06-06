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
  // NOTE: @xyflow/svelte's stylesheet is NOT imported here. esbuild would route
  // a .css side-effect import to a separate, never-loaded main.css. It is
  // concatenated into the plugin's styles.css by esbuild.config.mjs instead.
  import PflowNodeRaw from "./PflowNode.svelte";
  import type { FlowNode, FlowEdge } from "./flow-map.js";

  let {
    flowNodes,
    flowEdges,
    onMove,
    onSelect,
    onConnect,
  }: {
    flowNodes: FlowNode[];
    flowEdges: FlowEdge[];
    onMove: (nodeId: string, x: number, y: number) => void;
    onSelect: (nodeId: string | null) => void;
    onConnect: (c: { source: string; sourceHandle: string; target: string; targetHandle: string }) => void;
  } = $props();

  const PflowNode = PflowNodeRaw as unknown as Component<NodeProps>;
  const nodeTypes = { pflow: PflowNode };

  // NOTE: we deliberately do NOT pass `colorMode`. Setting colorMode="dark"
  // makes xyflow apply its OWN hardcoded palette (#141414 etc.) and ignore the
  // theme. Instead we leave the flow root transparent and paint the themed
  // surface via the wrapper's background + <Background bgColor=...> below, so
  // the canvas follows Obsidian's dark/light mode for free. (vault-memory.)

  // Initialize with the mapped data at construction time. SvelteFlow's store
  // reads `nodes`/`edges` while it is being created, so they must already be
  // populated arrays — seeding them later via $effect leaves the store reading
  // uninitialized reactive state and throws ("exclude.includes is not a
  // function") during construction.
  let nodes = $state<Node[]>(flowNodes as unknown as Node[]);
  let edges = $state<Edge[]>(flowEdges as unknown as Edge[]);

  // onnodedragstop payload is { targetNode, nodes, event }; targetNode
  // is the dragged node (or null if the gesture had no single target).
  function handleNodeDragStop({ targetNode }: { targetNode: Node | null }) {
    if (targetNode) onMove(targetNode.id, targetNode.position.x, targetNode.position.y);
  }

  // onconnect fires when the user drags between two handles. Forward the
  // source/target node+port up to the editor, which adds a wire (with full
  // validation) to the document. We do NOT mutate `edges` locally — the new
  // wire flows back down as `flowEdges` once the document updates.
  function handleConnect(c: {
    source: string;
    target: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
  }) {
    if (!c.sourceHandle || !c.targetHandle) return;
    onConnect({
      source: c.source,
      sourceHandle: c.sourceHandle,
      target: c.target,
      targetHandle: c.targetHandle,
    });
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
    onconnect={handleConnect}
    proOptions={{ hideAttribution: true }}
  >
    <Background bgColor="var(--background-primary)" patternColor="var(--background-modifier-border)" />
    <Controls />
  </SvelteFlow>
</div>

<style>
  /* The themed surface sits on THIS wrapper. xyflow's flow root is transparent
     by default, so this Obsidian-coloured background shows through — that's
     what makes the canvas follow dark/light mode. min-height is the safety
     floor: without it, if the percentage-height chain momentarily resolves to
     0 the flow collapses and you get white bands. (vault-memory pattern.) */
  .pflow-canvas-pane {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 400px;
    background: var(--background-primary);
    overflow: hidden;
  }
</style>
