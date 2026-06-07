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
    type EdgeProps,
  } from "@xyflow/svelte";
  import type { Component } from "svelte";
  import type { NodeKind } from "@perspecta/core";
  // NOTE: @xyflow/svelte's stylesheet is NOT imported here. esbuild would route
  // a .css side-effect import to a separate, never-loaded main.css. It is
  // concatenated into the plugin's styles.css by esbuild.config.mjs instead.
  import PflowNodeRaw from "./PflowNode.svelte";
  import PflowEdgeRaw from "./PflowEdge.svelte";
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
  const PflowEdge = PflowEdgeRaw as unknown as Component<EdgeProps>;
  const edgeTypes = { pflow: PflowEdge };

  let nodes = $state<Node[]>(flowNodes as unknown as Node[]);
  let edges = $state<Edge[]>(flowEdges as unknown as Edge[]);

  // Selection is owned ENTIRELY by xyflow (its per-node `selected` flag, toggled
  // on click / pane-click). We do NOT maintain a parallel selection in node
  // `data` — doing so fought xyflow's own selection and corrupted node state
  // ("all nodes selected"). The ring is styled from xyflow's `.svelte-flow__node
  // .selected` class. Here we only mirror xyflow's structure/content from the
  // upstream document, carrying each node's live `selected` flag forward.
  //
  // Re-seed when the node id-set changes (add/delete) OR when node CONTENT
  // changed (label / kind / prompt from an inspector edit). Position is
  // deliberately NOT part of the trigger: xyflow owns the live position during
  // a drag, and committed positions only re-enter via doc→flowNodes at
  // drag-stop (where xyflow's position already equals the committed one). If we
  // included position here, every live drag tick would re-seed `nodes` from the
  // stale committed position and snap the dragged node back — i.e. no visible
  // drag until release. So: trigger on content only, and when we DO re-seed,
  // carry each node's live position/selected/measured forward so an unrelated
  // edit never moves or deselects a node.
  function idKey(list: { id: string }[]): string {
    return list.map((n) => n.id).join(",");
  }
  // A compact signature of a node's PORTS (id, name, type, orphan), so adding,
  // removing, renaming, or retyping a port re-seeds the card. Without this, a
  // port edit that does NOT change the prompt (e.g. adding/removing a token-less
  // inspector port) would leave the canvas node stale.
  function portsKey(data: { inputs: { id: string; name: string; schema: { type: string }; orphan?: boolean; wired?: boolean }[]; outputs: { id: string; name: string; schema: { type: string }; orphan?: boolean; wired?: boolean }[] }): string {
    const sig = (p: { id: string; name: string; schema: { type: string }; orphan?: boolean; wired?: boolean }) =>
      `${p.id}~${p.name}~${p.schema.type}~${p.orphan ? 1 : 0}~${p.wired ? 1 : 0}`;
    return `${data.inputs.map(sig).join(",")}/${data.outputs.map(sig).join(",")}`;
  }
  function contentKey(list: Node[]): string {
    return list
      .map((n) => `${n.id}:${n.data.label}:${n.data.kind}:${n.data.prompt ?? ""}:${portsKey(n.data as never)}`)
      .join("|");
  }
  $effect(() => {
    const next = flowNodes as unknown as Node[];
    const structureChanged = idKey(next) !== idKey(nodes);
    const contentChanged = contentKey(next) !== contentKey(nodes);
    if (!structureChanged && !contentChanged) return;
    const live = new Map(nodes.map((n) => [n.id, n] as const));
    nodes = next.map((n) => {
      const prev = live.get(n.id);
      // Keep xyflow's live position (drag), selection, and measured size; only
      // adopt the new content fields from `next`.
      return prev
        ? { ...n, position: prev.position, selected: prev.selected, measured: prev.measured }
        : n;
    });
  });
  $effect(() => {
    const next = flowEdges as unknown as Edge[];
    if (idKey(next) !== idKey(edges)) edges = next;
  });

  function handleNodeDragStop({ targetNode }: { targetNode: Node | null }) {
    if (targetNode) onMove(targetNode.id, targetNode.position.x, targetNode.position.y);
  }

  // xyflow drives selection; we just mirror its current selection to the
  // inspector. Single-select: report the one selected node, or null when the
  // selection is empty (background click) or multi (inspector edits one node).
  function handleSelectionChange({ nodes: selNodes }: { nodes: Node[]; edges: Edge[] }) {
    onSelect(selNodes.length === 1 ? selNodes[0].id : null);
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
    {edgeTypes}
    fitView
    onnodedragstop={handleNodeDragStop}
    onselectionchange={handleSelectionChange}
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
