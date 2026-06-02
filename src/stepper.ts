import { buildGraph } from "./graph.js";
import { ContextBag, resolveTemplate } from "./context.js";
import type { WorkflowGraph, WorkflowEdge } from "./types.js";

interface Frame { graph: WorkflowGraph; currentId: string; }

export interface CurrentNode {
  canvasNodeId: string;
  kind: string;
  instruction: string;                 // resolved body text
  frontmatter?: Record<string, unknown>;
  outgoing: { toId: string; label?: string }[];
}

export interface AdvanceArgs {
  edge?: string;                       // edge label to follow (required at branch points)
  outputs?: Record<string, unknown>;   // values this node produced
}

export class Stepper {
  private stack: Frame[];
  private ctx = new ContextBag();

  constructor(canvasPath: string) {
    const graph = buildGraph(canvasPath);
    const start = [...graph.nodes.values()].find((n) => n.kind === "start");
    if (!start) throw new Error(`No start node in ${canvasPath}`);
    this.stack = [{ graph, currentId: start.canvasNodeId }];
  }

  private frame(): Frame { return this.stack[this.stack.length - 1]; }

  current(): CurrentNode {
    const { graph, currentId } = this.frame();
    const node = graph.nodes.get(currentId)!;
    const outgoing = graph.edges
      .filter((e: WorkflowEdge) => e.fromId === currentId)
      .map((e) => ({ toId: e.toId, label: e.label }));
    return {
      canvasNodeId: currentId,
      kind: node.kind,
      instruction: resolveTemplate((node.body ?? "").trim(), this.ctx),
      frontmatter: node.frontmatter as unknown as Record<string, unknown>,
      outgoing,
    };
  }

  advance(args: AdvanceArgs = {}): void {
    // If we are at a child's end node, advancing pops back to the parent and
    // continues from the subworkflow node's outgoing edge.
    {
      const f = this.frame();
      const node = f.graph.nodes.get(f.currentId)!;
      if (node.kind === "end" && this.stack.length > 1) {
        this.stack.pop();
        // now in parent, cursor sits on the subworkflow node; fall through to
        // normal edge-following from there using this same advance call.
      }
    }

    // record outputs into the shared context bag
    if (args.outputs) {
      for (const [k, v] of Object.entries(args.outputs)) this.ctx.set(k, v);
    }
    const { graph, currentId } = this.frame();
    const out = graph.edges.filter((e) => e.fromId === currentId);
    if (out.length === 0) throw new Error(`Node ${currentId} has no outgoing edge`);

    let chosen: WorkflowEdge;
    if (out.length === 1) {
      chosen = out[0];
    } else {
      if (!args.edge) throw new Error(`Node ${currentId} is a branch; an edge label is required`);
      const match = out.find((e) => e.label === args.edge);
      if (!match) throw new Error(`No outgoing edge labeled "${args.edge}" from ${currentId}`);
      chosen = match;
    }
    const target = graph.nodes.get(chosen.toId)!;

    if (target.kind === "subworkflow" && target.childCanvasPath) {
      // move cursor onto the subworkflow node first (so a later pop returns to its out-edge)
      this.frame().currentId = chosen.toId;
      // then descend: push a frame for the child at its start node
      const childGraph = buildGraph(target.childCanvasPath);
      const childStart = [...childGraph.nodes.values()].find((n) => n.kind === "start");
      if (!childStart) throw new Error(`Embedded workflow ${target.childCanvasPath} has no start node`);
      this.stack.push({ graph: childGraph, currentId: childStart.canvasNodeId });
      return;
    }

    this.frame().currentId = chosen.toId;
  }

  status(): { atEnd: boolean; depth: number; currentId: string } {
    const { graph, currentId } = this.frame();
    return { atEnd: graph.nodes.get(currentId)!.kind === "end", depth: this.stack.length, currentId };
  }

  context(): Record<string, unknown> { return this.ctx.all(); }
}
