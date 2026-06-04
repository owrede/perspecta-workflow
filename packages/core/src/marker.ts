export const WORKFLOW_MARKER_KEY = "perspecta";
export const WORKFLOW_MARKER_VERSION = 1;

export interface WorkflowMarker {
  workflow: boolean;
  version: number;
}

/** True iff the parsed canvas object carries a `perspecta` marker with workflow:true. */
export function isWorkflowCanvas(canvas: unknown): boolean {
  if (typeof canvas !== "object" || canvas === null) return false;
  const marker = (canvas as Record<string, unknown>)[WORKFLOW_MARKER_KEY];
  if (typeof marker !== "object" || marker === null) return false;
  return (marker as Record<string, unknown>).workflow === true;
}

/** Return the canvas object with the marker stamped (idempotent). Mutates a shallow copy. */
export function stampWorkflowMarker(canvas: Record<string, unknown>): Record<string, unknown> {
  return {
    ...canvas,
    [WORKFLOW_MARKER_KEY]: { workflow: true, version: WORKFLOW_MARKER_VERSION },
  };
}
