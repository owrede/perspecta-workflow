import { describe, it, expect } from "vitest";
import { buildNodeNote, addFileNodeToCanvas } from "../src/commands/insertNode.js";

describe("buildNodeNote", () => {
  it("produces valid WorkflowNode frontmatter for a prompt", () => {
    const note = buildNodeNote("prompt");
    expect(note).toContain("class: WorkflowNode");
    expect(note).toContain("node_type: prompt");
    expect(note).toContain("outputs: []");
  });
  it("includes tool-specific fields for a tool node", () => {
    expect(buildNodeNote("tool")).toContain("tool:");
  });
});

describe("addFileNodeToCanvas", () => {
  it("appends a file-node referencing the note", () => {
    const canvas = JSON.stringify({ nodes: [{ id: "a", type: "file", file: "a.md", x: 0, y: 0, width: 100, height: 60 }], edges: [] });
    const out = addFileNodeToCanvas(canvas, "new.md", "n1");
    const parsed = JSON.parse(out);
    expect(parsed.nodes).toHaveLength(2);
    const added = parsed.nodes.find((n: any) => n.id === "n1");
    expect(added.file).toBe("new.md");
    expect(added.x).toBeGreaterThan(100);
  });
});
