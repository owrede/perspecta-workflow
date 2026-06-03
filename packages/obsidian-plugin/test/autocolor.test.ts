import { describe, it, expect } from "vitest";
import { computeRecoloredCanvas } from "../src/commands/autocolor.js";

function fakeVault(files: Record<string, string>) {
  return { async read(p: string) { if (!(p in files)) throw new Error(`missing ${p}`); return files[p]; }, exists: (p: string) => p in files };
}

describe("computeRecoloredCanvas", () => {
  it("recolors a start node to green (preset 4)", async () => {
    const files = {
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
    const out = await computeRecoloredCanvas("wf.canvas", fakeVault(files));
    expect(out).not.toBeNull();
    const parsed = JSON.parse(out!);
    expect(parsed.nodes.find((n: any) => n.id === "s").color).toBe("4");
    expect(parsed.nodes.find((n: any) => n.id === "e").color).toBe("1");
  });
});
