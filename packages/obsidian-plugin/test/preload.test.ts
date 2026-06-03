import { describe, it, expect } from "vitest";
import { preloadCanvas } from "../src/fs/preload.js";

// Minimal vault: a map of vault-relative path -> content, plus a vaultRoot.
function fakeVault(files: Record<string, string>) {
  return {
    async read(path: string): Promise<string> {
      if (!(path in files)) throw new Error(`missing ${path}`);
      return files[path];
    },
    exists(path: string): boolean { return path in files; },
  };
}

describe("preloadCanvas", () => {
  it("preloads the canvas and its node-note files (vault-relative)", async () => {
    const files = {
      "flows/wf.canvas": JSON.stringify({
        nodes: [
          { id: "s", type: "file", file: "flows/start.md", x: 0, y: 0, width: 1, height: 1 },
          { id: "e", type: "file", file: "flows/end.md",   x: 1, y: 0, width: 1, height: 1 },
        ],
        edges: [{ id: "x", fromNode: "s", toNode: "e" }],
      }),
      "flows/start.md": "---\nclass: WorkflowNode\nnode_type: start\n---\nGo.",
      "flows/end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
    };
    const { map } = await preloadCanvas("flows/wf.canvas", fakeVault(files));
    expect(map.get("flows/wf.canvas")).toContain("nodes");
    expect(map.get("flows/start.md")).toContain("node_type: start");
    expect(map.get("flows/end.md")).toContain("node_type: end");
  });

  it("recurses into embedded .canvas children and pulls their node-notes", async () => {
    const files = {
      "flows/parent.canvas": JSON.stringify({
        nodes: [
          { id: "c", type: "file", file: "flows/child.canvas", x: 0, y: 0, width: 1, height: 1 },
        ],
        edges: [],
      }),
      "flows/child.canvas": JSON.stringify({
        nodes: [
          { id: "n", type: "file", file: "flows/child-note.md", x: 0, y: 0, width: 1, height: 1 },
          // self-reference exercises the seen-guard (no infinite loop)
          { id: "self", type: "file", file: "flows/child.canvas", x: 1, y: 0, width: 1, height: 1 },
        ],
        edges: [],
      }),
      "flows/child-note.md": "---\nclass: WorkflowNode\nnode_type: task\n---\nChild work.",
    };
    const { map } = await preloadCanvas("flows/parent.canvas", fakeVault(files));
    expect(map.get("flows/parent.canvas")).toContain("child.canvas");
    expect(map.get("flows/child.canvas")).toContain("child-note.md");
    expect(map.get("flows/child-note.md")).toContain("node_type: task");
  });
});
