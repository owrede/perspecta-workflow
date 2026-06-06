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

  // Keep the local xyflow stores in sync with the upstream derived data WITHOUT
  // clobbering xyflow's own per-node state (measured size, drag position).
  //
  // - When the set of node ids changes (add/delete), replace the array — xyflow
  //   must adopt the new node set.
  // - Otherwise (a selection toggle, a label/prompt edit, a position commit),
  //   patch each existing node's `data` and `position` IN PLACE so xyflow keeps
  //   its internals and there's no re-layout flicker on every doc edit.
  function idKey(list: { id: string }[]): string {
    return list.map((n) => n.id).join(",");
  }
  $effect(() => {
    const next = flowNodes as unknown as Node[];
    if (idKey(next) !== idKey(nodes)) {
      nodes = next;
      return;
    }
    const byId = new Map(next.map((n) => [n.id, n] as const));
    for (const n of nodes) {
      const src = byId.get(n.id);
      if (!src) continue;
      n.data = src.data;
      // Adopt committed positions (e.g. from an undo or programmatic move) but
      // leave a node where xyflow has it during an in-progress drag: positions
      // already agree at drag-stop, so this is a no-op in the common case.
      n.position = src.position;
    }
  });
  $effect(() => {
    const next = flowEdges as unknown as Edge[];
    if (idKey(next) !== idKey(edges)) edges = next;
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

  // The add-node menu (pane right-click) and node-delete menu (node right-click)
  // are built in flow-controls, which lives inside <SvelteFlow> so it can use
  // useSvelteFlow().screenToFlowPosition. We forward both xyflow context-menu
  // events to it via bindable callbacks. Using xyflow's own onpanecontextmenu /
  // onnodecontextmenu props (not a document query) keeps everything scoped to
  // THIS flow instance — correct even with multiple editor panes open.
  let requestPaneMenu = $state<((event: MouseEvent) => void) | null>(null);
  let requestNodeMenu = $state<((node: Node, event: MouseEvent) => void) | null>(null);

  function handlePaneContextMenu(event: MouseEvent) {
    event.preventDefault();
    requestPaneMenu?.(event);
  }
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
    onpanecontextmenu={({ event }) => handlePaneContextMenu(event as MouseEvent)}
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
      bind:requestPaneMenu
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
