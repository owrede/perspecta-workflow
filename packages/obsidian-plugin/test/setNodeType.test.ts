import { describe, it, expect } from "vitest";
import { setNodeTypeInFrontmatter, NODE_TYPE_OPTIONS } from "../src/commands/setNodeType.js";

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

describe("NODE_TYPE_OPTIONS", () => {
  it("lists all 8 node types with descriptions, sourced from core", () => {
    expect(NODE_TYPE_OPTIONS).toHaveLength(8);
    const types = NODE_TYPE_OPTIONS.map((o) => o.type).sort();
    expect(types).toEqual(["config", "contract", "data", "end", "loop", "prompt", "start", "tool"]);
    for (const o of NODE_TYPE_OPTIONS) expect(o.description.length).toBeGreaterThan(0);
  });
});
