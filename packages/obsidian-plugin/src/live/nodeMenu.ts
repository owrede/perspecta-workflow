import { Menu, type WorkspaceLeaf } from "obsidian";
import { NODE_TYPE_OPTIONS } from "../commands/setNodeType.js";
import type { NodeType } from "@perspecta/core";

/**
 * Adds a right-click context menu to canvas NODES offering "Set node type ▸ …".
 *
 * Obsidian exposes NO public API for canvas node menus, so this reaches the
 * canvas view's internal `canvas` object (untyped) to find which node was
 * clicked, then shows OUR OWN Obsidian Menu (public API) at the cursor — we
 * never patch Obsidian's internal menu. Everything is guarded: if the internal
 * shape changes, the handler does nothing and the command-palette "Set node
 * type" still works.
 *
 * The menu only appears on canvases the caller has confirmed are workflows
 * (via the `isWorkflow` predicate) and only when a single file-node is the
 * right-click target.
 */

interface InternalCanvasNode {
  id?: string;
  nodeEl?: HTMLElement;
}

interface InternalCanvas {
  nodes?: Map<string, InternalCanvasNode> | Record<string, InternalCanvasNode>;
}

interface CanvasLeafView {
  containerEl?: HTMLElement;
  canvas?: InternalCanvas;
  getViewType?: () => string;
}

function iterNodes(canvas: InternalCanvas): InternalCanvasNode[] {
  const n = canvas.nodes;
  if (!n) return [];
  if (n instanceof Map) return [...n.values()];
  return Object.values(n);
}

export interface NodeMenuDeps {
  /** True if the given canvas leaf is a workflow canvas (marker present). */
  isWorkflow: (leaf: WorkspaceLeaf) => Promise<boolean>;
  /** Resolve a canvas node id to its node-note (.md) vault path, or null.
   *  Reads the canvas FILE's JSON (reliable) rather than internal node props. */
  resolveNotePath: (leaf: WorkspaceLeaf, nodeId: string) => Promise<string | null>;
  /** Apply the chosen node type to the node-note at notePath. */
  applyNodeType: (notePath: string, nodeType: NodeType) => Promise<void>;
}

/**
 * Attach a capturing contextmenu listener to a canvas leaf's container.
 * Returns a disposer that removes the listener. Returns a no-op disposer if the
 * container can't be found.
 */
export function attachNodeMenu(leaf: WorkspaceLeaf, deps: NodeMenuDeps): () => void {
  const view = leaf.view as unknown as CanvasLeafView;
  const container = view?.containerEl;
  const canvas = view?.canvas;
  if (!container || !canvas) return () => {};

  const handler = (evt: MouseEvent) => {
    void handleContextMenu(evt, leaf, view, deps);
  };
  // Capture phase so we can run before Obsidian's own handler and add our items.
  container.addEventListener("contextmenu", handler, { capture: true });
  return () => container.removeEventListener("contextmenu", handler, { capture: true });
}

async function handleContextMenu(
  evt: MouseEvent,
  leaf: WorkspaceLeaf,
  view: CanvasLeafView,
  deps: NodeMenuDeps,
): Promise<void> {
  try {
    if (!view.canvas) return;
    if (!(await deps.isWorkflow(leaf))) return;

    const target = evt.target as HTMLElement | null;
    if (!target) return;

    // Find the canvas node whose DOM element contains the click target.
    const node = iterNodes(view.canvas).find(
      (n) => n.nodeEl instanceof HTMLElement && n.nodeEl.contains(target),
    );
    if (!node || typeof node.id !== "string") return;
    // Resolve via the canvas FILE's JSON (reliable), not internal node props.
    const notePath = await deps.resolveNotePath(leaf, node.id);
    if (!notePath) return;

    // We have a workflow file-node: present our own menu.
    evt.preventDefault();
    evt.stopPropagation();

    const menu = new Menu();
    menu.addItem((item) => {
      item.setTitle("Perspecta: set node type").setIsLabel(true);
    });
    for (const opt of NODE_TYPE_OPTIONS) {
      menu.addItem((item) => {
        item
          .setTitle(`${opt.type} — ${opt.description}`)
          .onClick(async () => {
            try { await deps.applyNodeType(notePath, opt.type); }
            catch { /* surfaced by caller's Notice path if needed */ }
          });
      });
    }
    menu.showAtMouseEvent(evt);
  } catch {
    // Internal shape changed or anything unexpected: do nothing.
    // Command-palette "Set node type" remains the reliable path.
  }
}
