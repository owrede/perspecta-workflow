<!--
  flow-controls — invisible helper mounted INSIDE <SvelteFlow>.

  Lives inside the flow so it can call useSvelteFlow() for screenToFlowPosition
  (converting a right-click's screen coords to canvas coords for node
  placement). Owns three interactions:

    1. Background right-click → Obsidian Menu of node kinds (compilable kinds
       active, the rest ghosted) → onAddNode(kind, flowX, flowY). Driven by the
       parent's xyflow `onpanecontextmenu` via the bindable `requestPaneMenu`.
    2. Node right-click → "Delete node" menu item → onDeleteRequest(nodeId).
       Driven by the parent's `onnodecontextmenu` via `requestNodeMenu`.
    3. Delete / Backspace while a node is selected (and focus is not in a text
       field) → onDeleteRequest(selectedId).

  Using the parent's xyflow context-menu props (rather than a global document
  query) keeps every listener scoped to THIS flow instance — correct even with
  multiple editor panes open. This component renders nothing visible.
-->

<script lang="ts">
  import { Menu } from "obsidian";
  import { useSvelteFlow, type Node } from "@xyflow/svelte";
  import { NODE_KINDS, type NodeKind } from "@perspecta/core";
  import { COMPILABLE_KINDS } from "./flow-map.js";

  let {
    selectedId,
    onAddNode,
    onAddMemory,
    onDeleteRequest,
    requestPaneMenu = $bindable(),
    requestNodeMenu = $bindable(),
  }: {
    selectedId: string | null;
    onAddNode: (kind: NodeKind, x: number, y: number) => void;
    // Add an mcp node pre-bound to vault-memory (the Memory node preset).
    onAddMemory: (x: number, y: number) => void;
    onDeleteRequest: (nodeId: string) => void;
    requestPaneMenu?: ((event: MouseEvent) => void) | null;
    requestNodeMenu?: ((node: Node, event: MouseEvent) => void) | null;
  } = $props();

  const { screenToFlowPosition } = useSvelteFlow();

  // Background right-click → add-node menu, placed at the cursor's flow coords.
  requestPaneMenu = (event: MouseEvent) => {
    const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const menu = new Menu();
    for (const kind of NODE_KINDS) {
      const ok = COMPILABLE_KINDS.includes(kind);
      menu.addItem((item) => {
        item.setTitle(ok ? `Add ${kind}` : `Add ${kind} (not yet exportable)`);
        item.setDisabled(!ok);
        if (ok) item.onClick(() => onAddNode(kind, pos.x, pos.y));
      });
      // The Memory node preset rides directly under "Add mcp": the same node
      // kind, pre-bound to vault-memory so the inspector opens straight on the
      // contract picker.
      if (kind === "mcp") {
        menu.addItem((item) => {
          item.setTitle("Add memory (vault-memory contract)");
          item.onClick(() => onAddMemory(pos.x, pos.y));
        });
      }
    }
    menu.showAtMouseEvent(event);
  };

  // Node right-click → delete menu.
  requestNodeMenu = (node: Node, event: MouseEvent) => {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Delete node").onClick(() => onDeleteRequest(node.id)));
    menu.showAtMouseEvent(event);
  };

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Delete" && event.key !== "Backspace") return;
    if (!selectedId) return;
    const el = document.activeElement;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement)?.isContentEditable) return;
    event.preventDefault();
    onDeleteRequest(selectedId);
  }

  $effect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });
</script>
