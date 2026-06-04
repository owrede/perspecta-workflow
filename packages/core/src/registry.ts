import { buildGraph } from "./graph.js";
import type { WorkflowFileSystem } from "./fs.js";

export interface WorkflowSummary {
  name: string;        // canvas filename without extension
  canvasPath: string;  // vault-relative path to the .canvas
  trigger: string;     // start-note `trigger:`, else purpose, else name
  purpose: string;     // first non-empty start-note body line, else name
  nodeCount: number;   // number of file-nodes resolved in the graph
}

/** Canvas filename without directory or `.canvas` extension. */
function workflowName(canvasPath: string): string {
  const base = canvasPath.slice(canvasPath.lastIndexOf("/") + 1);
  return base.endsWith(".canvas") ? base.slice(0, -".canvas".length) : base;
}

function firstNonEmptyLine(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.length > 0) return t;
  }
  return undefined;
}

/** Build a WorkflowSummary from a marked canvas. Never throws on missing
 *  trigger/purpose/start — falls back to the workflow name. */
export function summarizeWorkflow(canvasPath: string, fs: WorkflowFileSystem): WorkflowSummary {
  const name = workflowName(canvasPath);
  const graph = buildGraph(canvasPath, { fs });
  let start: { frontmatter?: { trigger?: unknown }; body?: string } | undefined;
  for (const node of graph.nodes.values()) {
    if (node.kind === "start") { start = node; break; }
  }
  const triggerRaw = start?.frontmatter?.trigger;
  const purposeLine = start?.body ? firstNonEmptyLine(start.body) : undefined;
  const purpose = purposeLine ?? name;
  const trigger = typeof triggerRaw === "string" && triggerRaw.trim().length > 0
    ? triggerRaw.trim()
    : purpose;
  return { name, canvasPath, trigger, purpose, nodeCount: graph.nodes.size };
}
