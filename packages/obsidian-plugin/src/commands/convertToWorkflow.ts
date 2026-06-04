import { stampWorkflowMarker, isWorkflowCanvas } from "@perspecta/core";

/**
 * Stamp the workflow marker into a canvas JSON string.
 * Returns the new pretty-printed JSON (trailing newline), or null if the canvas
 * already carries the marker (so the caller can skip the write).
 * Throws if the input is not valid JSON.
 */
export function stampCanvasJson(canvasJson: string): string | null {
  const raw = JSON.parse(canvasJson) as Record<string, unknown>;
  if (isWorkflowCanvas(raw)) return null;
  const stamped = stampWorkflowMarker(raw);
  return JSON.stringify(stamped, null, 2) + "\n";
}
