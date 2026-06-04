import { Menu, type WorkspaceLeaf } from "obsidian";
import { NODE_TYPE_OPTIONS } from "../commands/setNodeType.js";
import type { NodeType } from "@perspecta/core";

/**
 * Adds a right-click context menu to canvas NODES offering "Set node type …".
 *
 * Obsidian exposes NO public API for canvas node menus, and routes canvas
 * pointer events through a single `.canvas-wrapper` overlay (so the event target
 * is never a node element — DOM-ancestor walking can't find the node). Instead
 * we attach a capturing `contextmenu` listener to the canvas view container and
 * hit-test the cursor coordinates against each internal node's on-screen
 * rectangle, then show OUR OWN Obsidian Menu (public API). We never patch
 * Obsidian's menu.
 *
 * Guards throughout: if detection fails the handler does nothing and the
 * command-palette "Set node type" remains the reliable path. The listener is
 * only attached to canvases the caller has confirmed are workflows, so the
 * marker is already guaranteed when the menu fires.
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
}

function iterNodes(canvas: InternalCanvas | undefined): InternalCanvasNode[] {
  const n = canvas?.nodes;
  if (!n) return [];
  if (n instanceof Map) return [...n.values()];
  return Object.values(n);
}

export interface NodeMenuDeps {
  /** Resolve a canvas node id to its node-note (.md) vault path, or null.
   *  Reads the canvas FILE's JSON (reliable) rather than internal node props. */
  resolveNotePath: (leaf: WorkspaceLeaf, nodeId: string) => Promise<string | null>;
  /** Apply the chosen node type to the node-note at notePath. */
  applyNodeType: (notePath: string, nodeType: NodeType) => Promise<void>;
}

/**
 * Hit-test the click point against each internal node's on-screen rectangle.
 * If multiple rects contain the point (overlapping / nested nodes), the
 * smallest-area match wins (the most specific node).
 */
function nodeIdAtPoint(view: CanvasLeafView, clientX: number, clientY: number): string | null {
  let best: { id: string; area: number } | null = null;
  for (const n of iterNodes(view.canvas)) {
    const el = n.nodeEl;
    if (!(el instanceof HTMLElement) || typeof n.id !== "string") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom) {
      const area = r.width * r.height;
      if (!best || area < best.area) best = { id: n.id, area };
    }
  }
  return best ? best.id : null;
}

const ATTACHED_FLAG = "__perspectaNodeMenu";

/**
 * Attach a capturing contextmenu listener to a canvas leaf's container.
 * Returns a disposer. No-op disposer if the container is missing or already
 * bound (refresh fires repeatedly; we must not stack listeners).
 */
export function attachNodeMenu(leaf: WorkspaceLeaf, deps: NodeMenuDeps): () => void {
  const view = leaf.view as unknown as CanvasLeafView;
  const container = view?.containerEl as (HTMLElement & { [ATTACHED_FLAG]?: boolean }) | undefined;
  if (!container || container[ATTACHED_FLAG]) return () => {};
  container[ATTACHED_FLAG] = true;
  const handler = (evt: MouseEvent) => { handleContextMenu(evt, leaf, view, deps); };
  container.addEventListener("contextmenu", handler, { capture: true });
  return () => {
    container.removeEventListener("contextmenu", handler, { capture: true });
    delete container[ATTACHED_FLAG];
  };
}

function handleContextMenu(
  evt: MouseEvent,
  leaf: WorkspaceLeaf,
  view: CanvasLeafView,
  deps: NodeMenuDeps,
): void {
  // SYNCHRONOUS phase: must run before any await, or preventDefault is a no-op.
  const nodeId = nodeIdAtPoint(view, evt.clientX, evt.clientY);
  if (!nodeId) return; // not over a node → let Obsidian's own menu show

  // Over a node on a (marker-gated) workflow canvas. Suppress the DEFAULT context
  // menu, but do NOT stop propagation: Obsidian needs to keep receiving the event
  // to run its own pointer-gesture cleanup (otherwise the canvas sticks in pan
  // mode). preventDefault alone stops the native menu; our menu replaces it.
  evt.preventDefault();

  // Snapshot coordinates before async (the event object is pooled after the turn).
  const x = evt.clientX;
  const y = evt.clientY;

  void (async () => {
    try {
      const notePath = await deps.resolveNotePath(leaf, nodeId);
      if (!notePath) return;
      const menu = new Menu();
      menu.addItem((item) => { item.setTitle("Set node type").setIsLabel(true); });
      for (const opt of NODE_TYPE_OPTIONS) {
        menu.addItem((item) => {
          item.setTitle(`${opt.type} — ${opt.description}`).onClick(async () => {
            try { await deps.applyNodeType(notePath, opt.type); } catch { /* caller surfaces */ }
          });
        });
      }
      menu.showAtPosition({ x, y });
    } catch {
      // best-effort: command-palette "Set node type" remains reliable
    }
  })();
}
