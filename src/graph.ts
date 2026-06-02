import { dirname, resolve } from "node:path";
import { parseCanvas, parseNodeNote } from "./canvas.js";
import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from "./types.js";

export function buildGraph(canvasPath: string): WorkflowGraph {
  const canvas = parseCanvas(canvasPath);
  const baseDir = dirname(canvasPath);
  const nodes = new Map<string, WorkflowNode>();

  for (const cn of canvas.nodes) {
    if (cn.type !== "file" || !cn.file) continue; // ignore text/group nodes in v1
    const target = resolve(baseDir, cn.file);

    if (cn.file.endsWith(".canvas")) {
      nodes.set(cn.id, {
        canvasNodeId: cn.id,
        kind: "subworkflow",
        filePath: target,
        childCanvasPath: target,
      });
      continue;
    }

    const note = parseNodeNote(target);
    nodes.set(cn.id, {
      canvasNodeId: cn.id,
      kind: note.frontmatter.node_type,
      filePath: target,
      frontmatter: note.frontmatter,
      body: note.body,
    });
  }

  const edges: WorkflowEdge[] = canvas.edges.map((e) => ({
    fromId: e.fromNode,
    toId: e.toNode,
    label: e.label,
  }));

  return { canvasPath, nodes, edges };
}
