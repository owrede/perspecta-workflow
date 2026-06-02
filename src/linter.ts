import type { WorkflowGraph, NodeType } from "./types.js";
import { buildGraph } from "./graph.js";

export interface LintError { rule: string; message: string; nodeId?: string; }
export interface LintResult { ok: boolean; errors: LintError[]; }

export function lint(graph: WorkflowGraph): LintResult {
  const errors: LintError[] = [];
  const nodes = [...graph.nodes.values()];

  // Rule 1: exactly one start
  const starts = nodes.filter((n) => n.kind === "start");
  if (starts.length !== 1) {
    errors.push({ rule: "one-start", message: `Expected exactly 1 start node, found ${starts.length}` });
  }

  // Rule 2: at least one end, all reachable from start
  const ends = nodes.filter((n) => n.kind === "end");
  if (ends.length === 0) {
    errors.push({ rule: "has-end", message: "Workflow has no end node" });
  }
  if (starts.length === 1) {
    const reachable = reachableFrom(graph, starts[0].canvasNodeId);
    for (const e of ends) {
      if (!reachable.has(e.canvasNodeId)) {
        errors.push({ rule: "end-reachable", message: `End node ${e.canvasNodeId} is unreachable from start`, nodeId: e.canvasNodeId });
      }
    }
  }

  // Rule 4: no dangling edges
  for (const edge of graph.edges) {
    if (!graph.nodes.has(edge.fromId) || !graph.nodes.has(edge.toId)) {
      errors.push({ rule: "no-dangling-edges", message: `Edge ${edge.fromId}->${edge.toId} references a missing node` });
    }
  }

  // Rule 5: every non-end node has >=1 outgoing edge
  for (const n of nodes) {
    if (n.kind === "end") continue;
    const out = graph.edges.filter((e) => e.fromId === n.canvasNodeId);
    if (out.length === 0) {
      errors.push({ rule: "no-dead-ends", message: `Non-end node ${n.canvasNodeId} (${n.kind}) has no outgoing edge`, nodeId: n.canvasNodeId });
    }
  }

  // Rule 6: branch/loop nodes with multiple out-edges need distinct labels
  for (const n of nodes) {
    const out = graph.edges.filter((e) => e.fromId === n.canvasNodeId);
    if (out.length > 1) {
      const labels = out.map((e) => e.label ?? "");
      const distinct = new Set(labels);
      if (distinct.size !== labels.length || labels.includes("")) {
        errors.push({ rule: "distinct-branch-labels", message: `Node ${n.canvasNodeId} has multiple outgoing edges that need distinct, non-empty labels`, nodeId: n.canvasNodeId });
      }
    }
  }

  // Rule 3: every workflow node has a valid node_type (subworkflow exempt)
  const VALID: NodeType[] = ["start","end","prompt","tool","data","contract","loop","config"];
  for (const n of nodes) {
    if (n.kind === "subworkflow") continue;
    if (!VALID.includes(n.kind as NodeType)) {
      errors.push({ rule: "valid-node-type", message: `Node ${n.canvasNodeId} has invalid node_type "${n.kind}"`, nodeId: n.canvasNodeId });
    }
  }

  // Rule 7+8: any embedded child must contain no infinite-loop nodes (recursively).
  for (const n of nodes) {
    if (n.kind !== "subworkflow" || !n.childCanvasPath) continue;
    const childInfinites = findInfiniteLoops(n.childCanvasPath);
    if (childInfinites.length > 0) {
      errors.push({
        rule: "infinite-loop-in-embedded",
        message: `Embedded workflow ${n.childCanvasPath} contains infinite-loop node(s) [${childInfinites.join(", ")}]; embedded workflows must not contain infinite loops.`,
        nodeId: n.canvasNodeId,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

export function isInfiniteLoop(graph: WorkflowGraph, loopNodeId: string): boolean {
  const node = graph.nodes.get(loopNodeId);
  if (!node || node.kind !== "loop") return false;
  const out = graph.edges.filter((e) => e.fromId === loopNodeId);
  const hasCondition = Boolean(node.frontmatter?.condition);
  return out.length === 1 && !out[0].label && !hasCondition;
}

function findInfiniteLoops(canvasPath: string): string[] {
  const child = buildGraph(canvasPath);
  const found: string[] = [];
  for (const n of child.nodes.values()) {
    if (n.kind === "loop" && isInfiniteLoop(child, n.canvasNodeId)) {
      found.push(n.canvasNodeId);
    }
    if (n.kind === "subworkflow" && n.childCanvasPath) {
      found.push(...findInfiniteLoops(n.childCanvasPath));
    }
  }
  return found;
}

function reachableFrom(graph: WorkflowGraph, startId: string): Set<string> {
  const seen = new Set<string>([startId]);
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const e of graph.edges) {
      if (e.fromId === cur && !seen.has(e.toId)) {
        seen.add(e.toId);
        stack.push(e.toId);
      }
    }
  }
  return seen;
}
