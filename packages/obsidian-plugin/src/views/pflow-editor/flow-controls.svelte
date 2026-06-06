<!--
  flow-controls — invisible helper mounted INSIDE <SvelteFlow>.

  Lives inside the flow so it can call useSvelteFlow() for screenToFlowPosition
  (converting a right-click's screen coords to canvas coords for node
  placement). Owns three interactions:

    1. Background right-click → Obsidian Menu of node kinds (compilable kinds
       active, the rest ghosted) → onAddNode(kind, flowX, flowY).
    2. Node right-click → "Delete node" menu item → onDeleteRequest(nodeId).
       Exposed to the parent via the bindable `requestNodeMenu` callback.
    3. Delete / Backspace while a node is selected (and focus is not in a text
       field) → onDeleteRequest(selectedId).

  It renders nothing visible.
-->

<script lang="ts">
  import { Menu } from "obsidian";
  import { useSvelteFlow, type Node } from "@xyflow/svelte";
  import { NODE_KINDS, type NodeKind } from "@perspecta/core";
  import { COMPILABLE_KINDS } from "./flow-map.js";

  let {
    selectedId,
    onAddNode,
    onDeleteRequest,
    requestNodeMenu = $bindable(),
  }: {
    selectedId: string | null;
    onAddNode: (kind: NodeKind, x: number, y: number) => void;
    onDeleteRequest: (nodeId: string) => void;
    requestNodeMenu?: ((node: Node, event: MouseEvent) => void) | null;
  } = $props();

  const { screenToFlowPosition } = useSvelteFlow();

  // Background right-click → add-node menu. Bound on the flow pane element,
  // which we find by walking up from this component's anchor.
  function onPaneContextMenu(event: MouseEvent) {
    // Only handle right-clicks on empty pane, not on a node (nodes get their
    // own menu via onnodecontextmenu in the parent). The flow renders nodes
    // above the pane; if the target sits inside a node element, bail.
    const target = event.target as HTMLElement;
    if (target.closest(".svelte-flow__node")) return;
    event.preventDefault();
    const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const menu = new Menu();
    for (const kind of NODE_KINDS) {
      const ok = COMPILABLE_KINDS.includes(kind);
      menu.addItem((item) => {
        item.setTitle(ok ? `Add ${kind}` : `Add ${kind} (not yet exportable)`);
        item.setDisabled(!ok);
        if (ok) item.onClick(() => onAddNode(kind, pos.x, pos.y));
      });
    }
    menu.showAtMouseEvent(event);
  }

  // Node right-click menu, invoked by the parent (which receives the xyflow
  // onnodecontextmenu event). Set the bindable callback so the parent can call
  // back into this component's menu logic.
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

  // Attach the pane contextmenu + keydown listeners once mounted. We bind the
  // contextmenu to the flow root (.svelte-flow) so it fires for empty-pane
  // right-clicks; keydown is on window, gated by selection + focus checks.
  $effect(() => {
    const root = document.querySelector<HTMLElement>(".pflow-canvas-pane .svelte-flow");
    root?.addEventListener("contextmenu", onPaneContextMenu);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      root?.removeEventListener("contextmenu", onPaneContextMenu);
      window.removeEventListener("keydown", onKeyDown);
    };
  });
</script>
