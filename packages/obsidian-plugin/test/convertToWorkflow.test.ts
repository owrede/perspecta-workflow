import { describe, it, expect } from "vitest";
import { stampCanvasJson } from "../src/commands/convertToWorkflow.js";
import { isWorkflowCanvas } from "@perspecta/core";

describe("stampCanvasJson", () => {
  it("stamps the marker into a canvas JSON string and pretty-prints", () => {
    const input = JSON.stringify({ nodes: [{ id: "a" }], edges: [] });
    const out = stampCanvasJson(input);
    const parsed = JSON.parse(out!);
    expect(isWorkflowCanvas(parsed)).toBe(true);
    expect(parsed.nodes).toEqual([{ id: "a" }]);
    expect(out!.endsWith("\n")).toBe(true);
  });
  it("returns null when the canvas is already a workflow (no rewrite needed)", () => {
    const already = JSON.stringify({ perspecta: { workflow: true, version: 1 }, nodes: [], edges: [] });
    expect(stampCanvasJson(already)).toBeNull();
  });
  it("throws on malformed JSON", () => {
    expect(() => stampCanvasJson("{not json")).toThrow();
  });
});
