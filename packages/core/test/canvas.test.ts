import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { parseCanvas, parseNodeNote } from "../src/canvas.js";
import { diskFs } from "./helpers.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("parseCanvas", () => {
  it("loads nodes and edges from a .canvas file", () => {
    const c = parseCanvas(join(FIX, "mini.canvas"), diskFs);
    expect(c.nodes).toHaveLength(1);
    expect(c.nodes[0].file).toBe("start-note.md");
    expect(c.edges).toEqual([]);
  });
});

describe("parseNodeNote", () => {
  it("extracts frontmatter and body", () => {
    const note = parseNodeNote(join(FIX, "start-note.md"), diskFs);
    expect(note.frontmatter.class).toBe("WorkflowNode");
    expect(note.frontmatter.node_type).toBe("start");
    expect(note.body.trim()).toBe("Begin the workflow.");
  });
});
