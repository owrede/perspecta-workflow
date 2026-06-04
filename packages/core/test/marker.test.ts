import { describe, it, expect } from "vitest";
import { isWorkflowCanvas, stampWorkflowMarker, WORKFLOW_MARKER_KEY, WORKFLOW_MARKER_VERSION } from "../src/marker.js";

describe("isWorkflowCanvas", () => {
  it("is true when the marker is present and workflow:true", () => {
    expect(isWorkflowCanvas({ perspecta: { workflow: true, version: 1 }, nodes: [], edges: [] })).toBe(true);
  });
  it("is false when the marker is absent", () => {
    expect(isWorkflowCanvas({ nodes: [], edges: [] })).toBe(false);
  });
  it("is false when workflow is not true", () => {
    expect(isWorkflowCanvas({ perspecta: { workflow: false, version: 1 } })).toBe(false);
  });
  it("is false on non-objects / malformed input", () => {
    expect(isWorkflowCanvas(null)).toBe(false);
    expect(isWorkflowCanvas("nope")).toBe(false);
    expect(isWorkflowCanvas({ perspecta: "x" })).toBe(false);
  });
});

describe("stampWorkflowMarker", () => {
  it("adds the marker with the current version", () => {
    const out = stampWorkflowMarker({ nodes: [], edges: [] });
    expect(out[WORKFLOW_MARKER_KEY]).toEqual({ workflow: true, version: WORKFLOW_MARKER_VERSION });
    expect(isWorkflowCanvas(out)).toBe(true);
  });
  it("is idempotent and preserves nodes/edges and unknown keys", () => {
    const input = { nodes: [{ id: "a" }], edges: [{ id: "e" }], someTool: { x: 1 } } as Record<string, unknown>;
    const once = stampWorkflowMarker(input);
    const twice = stampWorkflowMarker(once);
    expect(twice.nodes).toEqual([{ id: "a" }]);
    expect(twice.edges).toEqual([{ id: "e" }]);
    expect(twice.someTool).toEqual({ x: 1 });
    expect(twice[WORKFLOW_MARKER_KEY]).toEqual({ workflow: true, version: WORKFLOW_MARKER_VERSION });
  });
});
