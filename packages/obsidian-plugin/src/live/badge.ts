import type { WorkspaceLeaf } from "obsidian";

const BADGE_CLASS = "perspecta-badge";

/**
 * Renders a non-interactive "Workflow" pill in the top-left of a canvas leaf's
 * view container, sticky to the view edge over the canvas content.
 *
 * The canvas view is not a public-API typed view; we reach its containerEl and
 * inject an absolutely-positioned overlay. If the container can't be found, we
 * fail silently — a status-bar indicator (managed by main.ts) is the fallback.
 */
export class WorkflowBadge {
  /** Attach the badge to a leaf if not already present. Returns true on success. */
  static attach(leaf: WorkspaceLeaf | null): boolean {
    if (!leaf) return false;
    const container = (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
    if (!container) return false;
    if (container.querySelector(`.${BADGE_CLASS}`)) return true;
    const el = container.createDiv({ cls: BADGE_CLASS, text: "Workflow" });
    // createDiv appends to container; ensure container is a positioning context.
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    el.setAttribute("aria-label", "Perspecta workflow canvas");
    return true;
  }

  /** Remove any badge from a leaf's container. */
  static detach(leaf: WorkspaceLeaf | null): void {
    if (!leaf) return;
    const container = (leaf.view as { containerEl?: HTMLElement } | undefined)?.containerEl;
    container?.querySelectorAll(`.${BADGE_CLASS}`).forEach((n) => n.remove());
  }
}
