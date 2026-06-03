import { describe, it, expect } from "vitest";
import { runValidation } from "../src/commands/validate.js";

function fakeVault(files: Record<string, string>) {
  return {
    async read(path: string): Promise<string> {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    },
    exists(path: string): boolean { return path in files; },
  };
}

const validCanvas = {
  "wf.canvas": JSON.stringify({
    nodes: [
      { id: "s", type: "file", file: "start.md", x: 0, y: 0, width: 1, height: 1 },
      { id: "e", type: "file", file: "end.md",   x: 1, y: 0, width: 1, height: 1 },
    ],
    edges: [{ id: "x", fromNode: "s", toNode: "e" }],
  }),
  "start.md": "---\nclass: WorkflowNode\nnode_type: start\n---\nGo.",
  "end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
};

describe("runValidation", () => {
  it("returns ok for a valid workflow canvas", async () => {
    const r = await runValidation("wf.canvas", fakeVault(validCanvas));
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("returns findings for a canvas with no start node", async () => {
    const noStart = {
      "wf.canvas": JSON.stringify({
        nodes: [{ id: "e", type: "file", file: "end.md", x: 0, y: 0, width: 1, height: 1 }],
        edges: [],
      }),
      "end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
    };
    const r = await runValidation("wf.canvas", fakeVault(noStart));
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "one-start")).toBe(true);
  });
});
