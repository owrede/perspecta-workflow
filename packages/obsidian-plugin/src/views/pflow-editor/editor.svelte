<script lang="ts">
  import type { App } from "obsidian";
  import type { PflowDocument, NodeKind } from "@perspecta/core";
  import CanvasPane from "./canvas-pane.svelte";
  import InspectorPane from "./inspector-pane.svelte";
  import { confirmModal } from "./confirm-modal.js";
  import {
    toFlowNodes,
    toFlowEdges,
    applyNodePosition,
    applyPromptEdit,
    applyAddWire,
    applyAddNode,
    applyDeleteNode,
    applyLabelEdit,
    applyKindChange,
    orphanedWiresForKind,
    applyWorkflowMeta,
    applyArgDefault,
  } from "./flow-map.js";

  let {
    file,
    app,
    onChange,
  }: { file: PflowDocument; app: App; onChange: (next: PflowDocument) => void } = $props();

  let doc = $state<PflowDocument>(file);
  let selectedId = $state<string | null>(null);

  $effect(() => {
    doc = file;
  });

  // Selection is owned by xyflow (it styles the ring from its own `.selected`
  // class); `selectedId` here only mirrors xyflow's current selection to drive
  // the inspector and the Delete key. So toFlowNodes does NOT take selectedId.
  let flowNodes = $derived(toFlowNodes(doc));
  let flowEdges = $derived(toFlowEdges(doc));
  let selectedNode = $derived(
    selectedId === null ? null : (flowNodes.find((n) => n.id === selectedId) ?? null),
  );

  // Workflow-level config surfaced in the inspector when nothing is selected.
  let workflow = $derived({ name: doc.workflow.name, description: doc.workflow.description });
  let argDefaults = $derived.by(() => {
    const args = doc.workflow.args;
    const props = args && args.type === "object" ? (args.properties ?? {}) : {};
    const read = (k: string) => (props[k] as { default?: string } | undefined)?.default ?? "";
    return {
      target_folder: read("target_folder"),
      filename_template: read("filename_template"),
      on_exists: read("on_exists"),
    };
  });

  function commit(next: PflowDocument) {
    doc = next;
    onChange(next);
  }

  function onMove(nodeId: string, x: number, y: number) {
    commit(applyNodePosition(doc, nodeId, x, y));
  }
  function onPrompt(nodeId: string, prompt: string) {
    commit(applyPromptEdit(doc, nodeId, prompt));
  }
  function onConnect(c: { source: string; sourceHandle: string; target: string; targetHandle: string }) {
    commit(
      applyAddWire(
        doc,
        { nodeId: c.source, portId: c.sourceHandle },
        { nodeId: c.target, portId: c.targetHandle },
      ),
    );
  }

  function onAddNode(kind: NodeKind, x: number, y: number) {
    const next = applyAddNode(doc, kind, `New ${kind}`, x, y);
    commit(next);
    selectedId = next.nodes[next.nodes.length - 1].id;
  }

  async function onDeleteRequest(nodeId: string) {
    const node = doc.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const body = (node.config?.body as string | undefined) ?? "";
    const nonEmpty = Boolean(node.prompt?.trim()) || Boolean(body.trim());
    if (nonEmpty) {
      const ok = await confirmModal(
        app,
        "Delete node?",
        `"${node.label}" has instructions that will be lost.\nDelete it anyway?`,
        "Delete",
      );
      if (!ok) return;
    }
    commit(applyDeleteNode(doc, nodeId));
    if (selectedId === nodeId) selectedId = null;
  }

  function onRename(nodeId: string, label: string) {
    commit(applyLabelEdit(doc, nodeId, label));
  }

  async function onKindChange(nodeId: string, kind: NodeKind): Promise<boolean> {
    const orphans = orphanedWiresForKind(doc, nodeId, kind);
    if (orphans.length > 0) {
      const lines = orphans
        .map((w) => `• ${w.from.nodeId}.${w.from.portId} → ${w.to.nodeId}.${w.to.portId}`)
        .join("\n");
      const ok = await confirmModal(
        app,
        "Change node type?",
        `This removes ${orphans.length} wire(s):\n${lines}`,
        "Change",
      );
      if (!ok) return false;
    }
    commit(applyKindChange(doc, nodeId, kind));
    return true;
  }

  function onWorkflowMeta(patch: { name?: string; description?: string }) {
    commit(applyWorkflowMeta(doc, patch));
  }
  function onArgDefault(key: string, value: string) {
    commit(applyArgDefault(doc, key, value));
  }
</script>

<div class="pflow-editor">
  <div class="pflow-editor__canvas">
    <CanvasPane
      {flowNodes}
      {flowEdges}
      {onMove}
      {onConnect}
      {onAddNode}
      {onDeleteRequest}
      selectedId={selectedId}
      onSelect={(id) => (selectedId = id)}
    />
  </div>
  <div class="pflow-editor__inspector">
    <InspectorPane
      node={selectedNode}
      {workflow}
      {argDefaults}
      {onPrompt}
      {onRename}
      {onKindChange}
      {onWorkflowMeta}
      {onArgDefault}
    />
  </div>
</div>

<style>
  .pflow-editor {
    display: grid;
    grid-template-columns: 1fr 320px;
    grid-template-rows: 100%;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  /* min-height:0 lets the grid cell shrink so its child can own the height;
     height:100% makes the canvas fill the row (SvelteFlow needs a sized box). */
  .pflow-editor__canvas {
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }
  .pflow-editor__inspector {
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    border-left: 1px solid var(--background-modifier-border);
  }
</style>
