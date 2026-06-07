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
    applyPromptAndDerivePorts,
    applyDetectPorts,
    applyAddPort,
    applyRemovePort,
    applyPortType,
    applyPortRename,
    applyAddWire,
    applyAddNode,
    applyDeleteNode,
    applyLabelEdit,
    applyKindChange,
    orphanedWiresForKind,
    applyWorkflowMeta,
    applyArgDefault,
    applyInspectorWidth,
    DEFAULT_INSPECTOR_WIDTH,
    MIN_INSPECTOR_WIDTH,
    MAX_INSPECTOR_WIDTH,
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

  // Inspector width: local state during a drag (smooth, no per-pixel doc write),
  // persisted once on release. Re-sync from the document when it changes
  // (e.g. external reload), mirroring `doc = file`.
  let inspectorWidth = $state<number>(file.editor?.inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH);
  $effect(() => {
    inspectorWidth = doc.editor?.inspectorWidth ?? DEFAULT_INSPECTOR_WIDTH;
  });

  let draggingDivider = $state(false);
  let dragStartX = 0;
  let dragStartWidth = 0;

  function onDividerPointerDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingDivider = true;
    dragStartX = e.clientX;
    dragStartWidth = inspectorWidth;
    e.preventDefault();
  }
  function onDividerPointerMove(e: PointerEvent) {
    if (!draggingDivider) return;
    // Inspector is on the RIGHT: dragging the divider left (clientX decreases)
    // widens it, so subtract the delta. Clamp live to the same bounds the
    // persisted helper uses.
    const next = dragStartWidth - (e.clientX - dragStartX);
    inspectorWidth = Math.max(MIN_INSPECTOR_WIDTH, Math.min(MAX_INSPECTOR_WIDTH, next));
  }
  function endDividerDrag() {
    if (!draggingDivider) return;
    draggingDivider = false;
    commit(applyInspectorWidth(doc, inspectorWidth)); // single persisted write
  }
  function onDividerDblClick() {
    inspectorWidth = DEFAULT_INSPECTOR_WIDTH;
    commit(applyInspectorWidth(doc, DEFAULT_INSPECTOR_WIDTH));
  }

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
    // Re-derive ports from the prompt's {{in:}}/{{out:}} tokens on every edit.
    // Dropped-but-wired ports survive as orphans (dashed wires).
    commit(applyPromptAndDerivePorts(doc, nodeId, prompt));
  }
  function onDetectPorts(nodeId: string) {
    // Deterministic stand-in for a future LLM pass: wrap existing port names
    // found in the prompt as {{in:}}/{{out:}} tokens.
    commit(applyDetectPorts(doc, nodeId));
  }
  function onAddPort(nodeId: string, dir: "in" | "out", name: string, type: import("@perspecta/core").TokenType) {
    commit(applyAddPort(doc, nodeId, dir, name, type));
  }
  function onRemovePort(nodeId: string, dir: "in" | "out", portId: string) {
    commit(applyRemovePort(doc, nodeId, dir, portId));
  }
  function onPortType(nodeId: string, dir: "in" | "out", name: string, type: import("@perspecta/core").TokenType) {
    commit(applyPortType(doc, nodeId, dir, name, type));
  }
  function onPortRename(nodeId: string, dir: "in" | "out", oldName: string, newName: string) {
    commit(applyPortRename(doc, nodeId, dir, oldName, newName));
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

<div class="pflow-editor" class:pflow-editor--dragging={draggingDivider}>
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
  <div
    class="pflow-editor__divider"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize inspector"
    onpointerdown={onDividerPointerDown}
    onpointermove={onDividerPointerMove}
    onpointerup={endDividerDrag}
    onlostpointercapture={endDividerDrag}
    ondblclick={onDividerDblClick}
  ></div>
  <div class="pflow-editor__inspector" style:width={`${inspectorWidth}px`}>
    <InspectorPane
      node={selectedNode}
      {workflow}
      {argDefaults}
      {onPrompt}
      {onRename}
      {onKindChange}
      {onWorkflowMeta}
      {onArgDefault}
      {onDetectPorts}
      {onAddPort}
      {onRemovePort}
      {onPortType}
      {onPortRename}
    />
  </div>
</div>

<style>
  .pflow-editor {
    display: grid;
    grid-template-columns: 1fr auto auto;
    grid-template-rows: 100%;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  /* While dragging the divider, suppress text selection and keep the resize
     cursor across the whole editor so the drag feels anchored. */
  .pflow-editor--dragging {
    user-select: none;
    cursor: col-resize;
  }
  /* min-height:0 lets the grid cell shrink so its child can own the height;
     height:100% makes the canvas fill the row (SvelteFlow needs a sized box). */
  .pflow-editor__canvas {
    min-width: 0;
    min-height: 0;
    height: 100%;
    overflow: hidden;
  }
  /* The divider is a 6px-wide transparent grab zone (easy to hit) with the
     visible line drawn as a centered 1px rule — matching Obsidian's own
     sidebar split: a 1px line that thickens to 3px on hover/drag. The line is a
     pseudo-element so the grab zone can stay wide without a wide visible line. */
  .pflow-editor__divider {
    position: relative;
    width: 6px;
    height: 100%;
    cursor: col-resize;
    background: transparent;
    flex: none;
  }
  .pflow-editor__divider::before {
    content: "";
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 1px;
    background: var(--background-modifier-border);
    transition: width 80ms ease-out, background 80ms ease-out;
  }
  .pflow-editor__divider:hover::before,
  .pflow-editor--dragging .pflow-editor__divider::before {
    width: 3px;
    background: var(--interactive-accent);
  }
  .pflow-editor__inspector {
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    /* width comes from the inline style:width binding */
  }
</style>
