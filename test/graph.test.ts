import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildGraph } from "../src/graph.js";

const FIX = join(import.meta.dirname, "fixtures");

describe("buildGraph", () => {
  it("resolves node-note file-nodes into typed workflow nodes", () => {
    const g = buildGraph(join(FIX, "linear.canvas"));
    expect(g.nodes.get("s")!.kind).toBe("start");
    expect(g.nodes.get("p")!.kind).toBe("prompt");
    expect(g.nodes.get("p")!.frontmatter!.outputs).toEqual(["summary"]);
    expect(g.nodes.get("e")!.kind).toBe("end");
    expect(g.edges).toHaveLength(2);
  });

  it("marks a file-node pointing at a .canvas as a subworkflow", () => {
    const g = buildGraph(join(FIX, "parent.canvas"));
    const sub = g.nodes.get("sub")!;
    expect(sub.kind).toBe("subworkflow");
    expect(sub.childCanvasPath!.endsWith("child.canvas")).toBe(true);
  });
});
