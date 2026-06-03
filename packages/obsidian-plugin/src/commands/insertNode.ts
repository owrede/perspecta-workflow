import type { NodeType } from "@perspecta/core";

/** Build the frontmatter+body for a new WorkflowNode note of the given type. */
export function buildNodeNote(nodeType: NodeType): string {
  const lines = ["---", "class: WorkflowNode", `node_type: ${nodeType}`];
  if (nodeType === "tool") lines.push("tool: ", "params: {}");
  if (nodeType === "contract") lines.push("contract: ");
  if (nodeType === "data") lines.push('source: ""');
  if (nodeType === "loop") lines.push('condition: ""');
  lines.push("outputs: []", "---", "", `Describe this ${nodeType} step.`, "");
  return lines.join("\n");
}

/** Insert a file-node referencing notePath into a canvas JSON string; returns the new JSON. */
export function addFileNodeToCanvas(canvasJson: string, nodePath: string, id: string): string {
  const raw = JSON.parse(canvasJson);
  raw.nodes = raw.nodes ?? [];
  const maxX = raw.nodes.reduce((m: number, n: any) => Math.max(m, (n.x ?? 0) + (n.width ?? 0)), 0);
  raw.nodes.push({ id, type: "file", file: nodePath, x: maxX + 60, y: 0, width: 260, height: 100 });
  return JSON.stringify(raw, null, 2) + "\n";
}
