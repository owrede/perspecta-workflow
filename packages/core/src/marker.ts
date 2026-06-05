export const WORKFLOW_MARKER_KEY = "perspecta";
export const WORKFLOW_SUBKEY = "workflow";
export const WORKFLOW_MARKER_VERSION = 1;

/** Canonical nested marker: `perspecta.workflow = { marker: true, version }`. */
export interface WorkflowMarker {
  marker: boolean;
  version: number;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * True iff the parsed canvas carries a Perspecta Workflow marker.
 *
 * Reads BOTH shapes for compatibility (Suite Convention Catalog §2.5):
 *   - canonical: `perspecta.workflow.marker === true`
 *   - legacy:    `perspecta.workflow === true` (flat boolean + sibling version)
 */
export function isWorkflowCanvas(canvas: unknown): boolean {
  const root = asRecord(canvas);
  if (!root) return false;
  const perspecta = asRecord(root[WORKFLOW_MARKER_KEY]);
  if (!perspecta) return false;
  const workflow = perspecta[WORKFLOW_SUBKEY];
  if (workflow === true) return true; // legacy flat shape
  const nested = asRecord(workflow);
  return nested !== null && nested.marker === true; // canonical nested shape
}

/**
 * Return the canvas object with the canonical nested marker stamped
 * (idempotent). MERGES into any existing `perspecta` object and preserves
 * unknown sibling keys (§2.5) — never replaces the whole `perspecta` object.
 * Mutating a shallow copy.
 */
export function stampWorkflowMarker(canvas: Record<string, unknown>): Record<string, unknown> {
  const existingPerspecta = { ...(asRecord(canvas[WORKFLOW_MARKER_KEY]) ?? {}) };
  // The legacy flat shape was `perspecta: { workflow: true, version: N }`, where
  // `version` was the MARKER's version, not a real sibling sub-key. When we see
  // that shape, drop the stray sibling `version` so it does not leak alongside
  // the nested marker. Genuine sibling sub-keys (e.g. perspecta.slides) are kept.
  if (existingPerspecta[WORKFLOW_SUBKEY] === true) {
    delete existingPerspecta.version;
  }
  const marker: WorkflowMarker = { marker: true, version: WORKFLOW_MARKER_VERSION };
  return {
    ...canvas,
    [WORKFLOW_MARKER_KEY]: {
      // preserve unknown sibling sub-keys (e.g. perspecta.slides) and overwrite
      // the legacy flat `workflow: true` with the canonical nested object.
      ...existingPerspecta,
      [WORKFLOW_SUBKEY]: marker,
    },
  };
}
