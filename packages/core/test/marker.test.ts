import { describe, it, expect } from "vitest";
import {
  isWorkflowCanvas,
  stampWorkflowMarker,
  WORKFLOW_MARKER_KEY,
  WORKFLOW_SUBKEY,
  WORKFLOW_MARKER_VERSION,
} from "../src/marker.js";

describe("isWorkflowCanvas", () => {
  it("is true for the canonical nested marker (perspecta.workflow.marker)", () => {
    expect(
      isWorkflowCanvas({ perspecta: { workflow: { marker: true, version: 1 } }, nodes: [], edges: [] }),
    ).toBe(true);
  });
  it("is true for the legacy flat marker (perspecta.workflow === true)", () => {
    expect(isWorkflowCanvas({ perspecta: { workflow: true, version: 1 }, nodes: [], edges: [] })).toBe(true);
  });
  it("is false when the marker is absent", () => {
    expect(isWorkflowCanvas({ nodes: [], edges: [] })).toBe(false);
  });
  it("is false when the legacy flag is not true", () => {
    expect(isWorkflowCanvas({ perspecta: { workflow: false, version: 1 } })).toBe(false);
  });
  it("is false when the nested marker is not true", () => {
    expect(isWorkflowCanvas({ perspecta: { workflow: { marker: false, version: 1 } } })).toBe(false);
  });
  it("is false on non-objects / malformed input", () => {
    expect(isWorkflowCanvas(null)).toBe(false);
    expect(isWorkflowCanvas("nope")).toBe(false);
    expect(isWorkflowCanvas({ perspecta: "x" })).toBe(false);
  });
});

describe("stampWorkflowMarker", () => {
  it("writes the canonical nested marker", () => {
    const out = stampWorkflowMarker({ nodes: [], edges: [] });
    expect(out[WORKFLOW_MARKER_KEY]).toEqual({
      [WORKFLOW_SUBKEY]: { marker: true, version: WORKFLOW_MARKER_VERSION },
    });
    expect(isWorkflowCanvas(out)).toBe(true);
  });

  it("is idempotent and preserves nodes/edges and unknown canvas keys", () => {
    const input = { nodes: [{ id: "a" }], edges: [{ id: "e" }], someTool: { x: 1 } } as Record<string, unknown>;
    const once = stampWorkflowMarker(input);
    const twice = stampWorkflowMarker(once);
    expect(twice.nodes).toEqual([{ id: "a" }]);
    expect(twice.edges).toEqual([{ id: "e" }]);
    expect(twice.someTool).toEqual({ x: 1 });
    expect(twice[WORKFLOW_MARKER_KEY]).toEqual({
      [WORKFLOW_SUBKEY]: { marker: true, version: WORKFLOW_MARKER_VERSION },
    });
  });

  it("upgrades a legacy flat marker to the nested shape", () => {
    const legacy = { perspecta: { workflow: true, version: 1 }, nodes: [] } as Record<string, unknown>;
    const out = stampWorkflowMarker(legacy);
    expect(out[WORKFLOW_MARKER_KEY]).toEqual({
      [WORKFLOW_SUBKEY]: { marker: true, version: WORKFLOW_MARKER_VERSION },
    });
    expect(isWorkflowCanvas(out)).toBe(true);
  });

  it("merges into an existing perspecta object, preserving sibling sub-keys", () => {
    const input = {
      perspecta: { slides: { version: 2 }, workflow: true },
      nodes: [],
    } as Record<string, unknown>;
    const out = stampWorkflowMarker(input);
    expect(out[WORKFLOW_MARKER_KEY]).toEqual({
      slides: { version: 2 },
      workflow: { marker: true, version: WORKFLOW_MARKER_VERSION },
    });
  });
});
