// Obsidian JSON Canvas raw shapes (subset we use)
export interface CanvasNode {
  id: string;
  type: "text" | "file" | "link" | "group";
  x: number; y: number; width: number; height: number;
  text?: string;
  file?: string;   // present when type === "file"
  color?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  fromSide?: string;
  toSide?: string;
  label?: string;
}

export interface Canvas {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const NODE_TYPES = [
  "start", "end", "prompt", "tool", "data", "contract", "loop", "config",
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// Canvas colors are "1".."6" preset strings; map per spec.
export const NODE_COLORS: Record<NodeType, string> = {
  start: "4",     // green
  end: "1",       // red
  prompt: "6",    // purple
  tool: "2",      // orange
  data: "5",      // cyan
  contract: "5",  // (blue not a preset → reuse cyan family; hex override applied in linter)
  loop: "3",      // yellow
  config: "0",    // gray (no color key → linter omits/uses default)
};

// Hex overrides where a preset doesn't exist (contract = blue, config = gray)
export const NODE_COLOR_HEX: Partial<Record<NodeType, string>> = {
  contract: "#4363d8",
  config: "#a9a9a9",
};

// A node-note's parsed frontmatter
export interface WorkflowNodeFrontmatter {
  class: "WorkflowNode";
  node_type: NodeType;
  outputs?: string[];
  tool?: string;
  params?: Record<string, unknown>;
  contract?: string;
  source?: string;
  condition?: string;
}

// A resolved workflow node in the graph
export interface WorkflowNode {
  canvasNodeId: string;
  kind: NodeType | "subworkflow";
  filePath?: string;                 // node-note path or child .canvas path
  frontmatter?: WorkflowNodeFrontmatter;
  body?: string;                     // node-note body (instruction text)
  childCanvasPath?: string;          // when kind === "subworkflow"
}

export interface WorkflowEdge {
  fromId: string;
  toId: string;
  label?: string;
}

export interface WorkflowGraph {
  canvasPath: string;
  nodes: Map<string, WorkflowNode>; // keyed by canvasNodeId
  edges: WorkflowEdge[];
}
