import { describe, it, expect } from "vitest";
import { setNodeTypeInFrontmatter, noteFilePathForNode, NODE_TYPE_OPTIONS } from "../src/commands/setNodeType.js";

const NOTE = `---
class: WorkflowNode
node_type: prompt
outputs: [draft]
---
Draft something.
`;

describe("setNodeTypeInFrontmatter", () => {
  it("replaces an existing node_type, preserving other frontmatter and body", () => {
    const out = setNodeTypeInFrontmatter(NOTE, "tool");
    expect(out).toContain("node_type: tool");
    expect(out).not.toContain("node_type: prompt");
    expect(out).toContain("class: WorkflowNode");
    expect(out).toContain("outputs: [draft]");
    expect(out).toContain("Draft something.");
  });
  it("inserts node_type when the note has frontmatter but no node_type yet", () => {
    const note = `---\nclass: WorkflowNode\n---\nBody.\n`;
    const out = setNodeTypeInFrontmatter(note, "start");
    expect(out).toContain("class: WorkflowNode");
    expect(out).toContain("node_type: start");
    expect(out).toContain("Body.");
  });
  it("throws when the note has no frontmatter block", () => {
    expect(() => setNodeTypeInFrontmatter("no frontmatter here", "end")).toThrow();
  });
});

describe("noteFilePathForNode", () => {
  const canvas = JSON.stringify({
    nodes: [
      { id: "s", type: "file", file: "flows/start.md", x: 0, y: 0, width: 1, height: 1 },
      { id: "g", type: "group", label: "G", x: 0, y: 0, width: 1, height: 1 },
      { id: "sub", type: "file", file: "flows/child.canvas", x: 0, y: 0, width: 1, height: 1 },
    ],
    edges: [],
  });
  it("returns the .md path for a file-node by id", () => {
    expect(noteFilePathForNode(canvas, "s")).toBe("flows/start.md");
  });
  it("returns null for a non-file node, a .canvas node, or a missing id", () => {
    expect(noteFilePathForNode(canvas, "g")).toBeNull();
    expect(noteFilePathForNode(canvas, "sub")).toBeNull();
    expect(noteFilePathForNode(canvas, "nope")).toBeNull();
  });
  it("returns null on malformed JSON", () => {
    expect(noteFilePathForNode("{bad", "s")).toBeNull();
  });
});

describe("NODE_TYPE_OPTIONS", () => {
  it("lists all 9 node types with descriptions, sourced from core", () => {
    expect(NODE_TYPE_OPTIONS).toHaveLength(9);
    const types = NODE_TYPE_OPTIONS.map((o) => o.type).sort();
    expect(types).toEqual(["config", "contract", "data", "end", "formatter", "loop", "prompt", "start", "tool"]);
    for (const o of NODE_TYPE_OPTIONS) expect(o.description.length).toBeGreaterThan(0);
  });
});
