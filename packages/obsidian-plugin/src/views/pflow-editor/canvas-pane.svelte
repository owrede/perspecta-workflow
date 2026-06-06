<!--
  canvas-pane — Svelte Flow wrapper for the .pflow node graph.

  Renders the workflow as a Svelte Flow canvas using the custom `pflow`
  node type (PflowNode.svelte). Owns no document state: it receives
  `flowNodes` / `flowEdges` (already mapped from the PflowDocument by
  flow-map.ts) and emits upward signals:

    - onMove(nodeId, x, y)      — a node finished dragging to a new spot
    - onSelect(nodeId | null)   — a node was clicked, or the pane cleared
    - onConnect(c)              — two handles were wired by a mouse drag
    - onAddNode(kind, x, y)     — background right-click → add a node
    - onDeleteRequest(nodeId)   — node right-click "Delete" or Delete/Backspace

  Event wiring (verified against @xyflow/svelte 1.6.0):
    - onnodedragstop  — payload { targetNode, nodes, event }
    - onnodeclick     — payload { node, event }
    - onpaneclick     — payload { event }
    - onnodecontextmenu — payload { node, event }
    - onconnect       — payload { source, target, sourceHandle, targetHandle }

  screenToFlowPosition (for placing a new node at the cursor) comes from
  useSvelteFlow(), which MUST be called from a component rendered INSIDE
  <SvelteFlow>. So the background contextmenu + Delete-key handling live in a
  small inner component (FlowControls) mounted as a child of <SvelteFlow>.
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
  import type { NodeKind } from "@perspecta/core";
  // NOTE: @xyflow/svelte's stylesheet is NOT imported here. esbuild would route
  // a .css side-effect import to a separate, never-loaded main.css. It is
  // concatenated into the plugin's styles.css by esbuild.config.mjs instead.
  import PflowNodeRaw from "./PflowNode.svelte";
  import FlowControls from "./flow-controls.svelte";
  import type { FlowNode, FlowEdge } from "./flow-map.js";

  let {
    flowNodes,
    flowEdges,
    selectedId,
    onMove,
    onSelect,
    onConnect,
    onAddNode,
    onDeleteRequest,
  }: {
    flowNodes: FlowNode[];
    flowEdges: FlowEdge[];
    selectedId: string | null;
    onMove: (nodeId: string, x: number, y: number) => void;
    onSelect: (nodeId: string | null) => void;
    onConnect: (c: { source: string; sourceHandle: string; target: string; targetHandle: string }) => void;
    onAddNode: (kind: NodeKind, x: number, y: number) => void;
    onDeleteRequest: (nodeId: string) => void;
  } = $props();

  const PflowNode = PflowNodeRaw as unknown as Component<NodeProps>;
  const nodeTypes = { pflow: PflowNode };

  let nodes = $state<Node[]>(flowNodes as unknown as Node[]);
  let edges = $state<Edge[]>(flowEdges as unknown as Edge[]);

  // Re-seed the local stores when the mapped data changes upstream (e.g. a node
  // was added/deleted, or selection changed the `selected` flag). Without this
  // the canvas would not reflect document edits made via the inspector/menu.
  $effect(() => {
    nodes = flowNodes as unknown as Node[];
  });
  $effect(() => {
    edges = flowEdges as unknown as Edge[];
  });

  function handleNodeDragStop({ targetNode }: { targetNode: Node | null }) {
    if (targetNode) onMove(targetNode.id, targetNode.position.x, targetNode.position.y);
  }

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

  // Obsidian Menu import is dynamic in flow-controls; the node-context menu is
  // built there too. Here we just forward the request via a callback prop so
  // the menu code lives in one place.
  let requestNodeMenu = $state<((node: Node, event: MouseEvent) => void) | null>(null);
  function handleNodeContextMenu({ node, event }: { node: Node; event: MouseEvent }) {
    event.preventDefault();
    requestNodeMenu?.(node, event);
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
    onnodecontextmenu={handleNodeContextMenu}
    onconnect={handleConnect}
    proOptions={{ hideAttribution: true }}
  >
    <Background bgColor="var(--background-primary)" patternColor="var(--background-modifier-border)" />
    <Controls />
    <FlowControls
      {selectedId}
      {onAddNode}
      {onDeleteRequest}
      bind:requestNodeMenu
    />
  </SvelteFlow>
</div>

<style>
  .pflow-canvas-pane {
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 400px;
    background: var(--background-primary);
    overflow: hidden;
  }
</style>
