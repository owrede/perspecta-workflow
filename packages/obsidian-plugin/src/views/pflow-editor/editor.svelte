<script lang="ts">
  import type { PflowDocument } from "@perspecta/core";
  import CanvasPane from "./canvas-pane.svelte";
  import InspectorPane from "./inspector-pane.svelte";
  import {
    toFlowNodes,
    toFlowEdges,
    applyNodePosition,
    applyPromptEdit,
    applyAddWire,
  } from "./flow-map.js";

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
  function onConnect(c: { source: string; sourceHandle: string; target: string; targetHandle: string }) {
    commit(
      applyAddWire(
        doc,
        { nodeId: c.source, portId: c.sourceHandle },
        { nodeId: c.target, portId: c.targetHandle },
      ),
    );
  }
</script>

<div class="pflow-editor">
  <div class="pflow-editor__canvas">
    <CanvasPane {flowNodes} {flowEdges} {onMove} {onConnect} onSelect={(id) => (selectedId = id)} />
  </div>
  <div class="pflow-editor__inspector">
    <InspectorPane node={selectedNode} {onPrompt} />
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
