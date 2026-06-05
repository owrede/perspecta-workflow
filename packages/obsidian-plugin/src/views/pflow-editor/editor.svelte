<script lang="ts">
  import type { PflowDocument } from "@perspecta/core";
  import CanvasPane from "./canvas-pane.svelte";
  import InspectorPane from "./inspector-pane.svelte";
  import { toFlowNodes, toFlowEdges, applyNodePosition, applyPromptEdit } from "./flow-map.js";

  let { file, onChange }: { file: PflowDocument; onChange: (next: PflowDocument) => void } = $props();

  let doc = $state<PflowDocument>(file);
  let selectedId = $state<string | null>(null);

  $effect(() => { doc = file; });

  let flowNodes = $derived(toFlowNodes(doc));
  let flowEdges = $derived(toFlowEdges(doc));
  let selectedNode = $derived(
    selectedId === null ? null : (flowNodes.find((n) => n.id === selectedId) ?? null),
  );

  function commit(next: PflowDocument) {
    doc = next;
    onChange(next);
  }
  function onMove(nodeId: string, x: number, y: number) { commit(applyNodePosition(doc, nodeId, x, y)); }
  function onPrompt(nodeId: string, prompt: string) { commit(applyPromptEdit(doc, nodeId, prompt)); }
</script>

<div class="pflow-editor">
  <div class="pflow-editor__canvas">
    <CanvasPane {flowNodes} {flowEdges} {onMove} onSelect={(id) => (selectedId = id)} />
  </div>
  <div class="pflow-editor__inspector">
    <InspectorPane node={selectedNode} {onPrompt} />
  </div>
</div>

<style>
  .pflow-editor {
    display: grid;
    grid-template-columns: 1fr 320px;
    width: 100%;
    height: 100%;
  }
  .pflow-editor__canvas { min-width: 0; min-height: 0; }
  .pflow-editor__inspector { border-left: 1px solid var(--background-modifier-border); }
</style>
