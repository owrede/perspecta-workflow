import { describe, it, expect } from "vitest";
import { summarizeWorkflow } from "../src/registry.js";
import { InMemoryFileSystem } from "../src/fs.js";

function fs(files: Record<string, string>) { return new InMemoryFileSystem(files); }

const canvasWith = (nodes: unknown[]) =>
  JSON.stringify({ perspecta: { workflow: true, version: 1 }, nodes, edges: [] });

describe("summarizeWorkflow", () => {
  it("uses the start-note trigger as the trigger and first body line as purpose", () => {
    const files = {
      "flows/person-brief.canvas": canvasWith([
        { id: "s", type: "file", file: "start.md", x: 0, y: 0, width: 1, height: 1 },
        { id: "e", type: "file", file: "end.md", x: 1, y: 0, width: 1, height: 1 },
      ]),
      "flows/start.md": "---\nclass: WorkflowNode\nnode_type: start\ntrigger: Use when the user wants a briefing on a person.\n---\nProduce a concise person brief.\n",
      "flows/end.md": "---\nclass: WorkflowNode\nnode_type: end\n---\nDone.",
    };
    const s = summarizeWorkflow("flows/person-brief.canvas", fs(files));
    expect(s.name).toBe("person-brief");
    expect(s.trigger).toBe("Use when the user wants a briefing on a person.");
    expect(s.purpose).toBe("Produce a concise person brief.");
    expect(s.canvasPath).toBe("flows/person-brief.canvas");
    expect(s.nodeCount).toBe(2);
  });

  it("falls back to purpose when no trigger, and to name when no start body", () => {
    const files = {
      "x/quick.canvas": canvasWith([
        { id: "s", type: "file", file: "s.md", x: 0, y: 0, width: 1, height: 1 },
      ]),
      "x/s.md": "---\nclass: WorkflowNode\nnode_type: start\n---\n",
    };
    const s = summarizeWorkflow("x/quick.canvas", fs(files));
    expect(s.trigger).toBe("quick");
    expect(s.purpose).toBe("quick");
  });

  it("falls back to name when there is no start node at all", () => {
    const files = {
      "x/noStart.canvas": canvasWith([
        { id: "p", type: "file", file: "p.md", x: 0, y: 0, width: 1, height: 1 },
      ]),
      "x/p.md": "---\nclass: WorkflowNode\nnode_type: prompt\n---\nDo a thing.",
    };
    const s = summarizeWorkflow("x/noStart.canvas", fs(files));
    expect(s.name).toBe("noStart");
    expect(s.trigger).toBe("noStart");
    expect(s.purpose).toBe("noStart");
    expect(s.nodeCount).toBe(1);
  });
});
