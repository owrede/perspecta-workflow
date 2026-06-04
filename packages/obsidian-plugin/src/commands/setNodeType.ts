import { NODE_TYPES, type NodeType } from "@perspecta/core";

export interface NodeTypeOption { type: NodeType; description: string; }

const DESCRIPTIONS: Record<NodeType, string> = {
  start: "entry point of the workflow",
  end: "terminal node",
  prompt: "an instruction for the agent",
  tool: "a tool call (e.g. write_note)",
  data: "read a note / data source",
  contract: "a vault-memory contract",
  loop: "conditional loop / branch-back",
  config: "workflow parameters (e.g. maxloops)",
};

/** The 8 node types with descriptions, sourced from core's NODE_TYPES. */
export const NODE_TYPE_OPTIONS: NodeTypeOption[] = NODE_TYPES.map((type) => ({
  type,
  description: DESCRIPTIONS[type],
}));

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/**
 * Surgically set `node_type` in a node-note's frontmatter, preserving every
 * other frontmatter line and the body verbatim. Replaces an existing
 * `node_type:` line if present, otherwise inserts one after the opening `---`.
 * Throws if the note has no frontmatter block.
 */
export function setNodeTypeInFrontmatter(noteText: string, nodeType: NodeType): string {
  const m = noteText.match(FRONTMATTER_RE);
  if (!m) throw new Error("Node note has no frontmatter block");
  const fmBody = m[1];
  const lines = fmBody.split("\n");
  const idx = lines.findIndex((l) => /^node_type\s*:/.test(l));
  if (idx >= 0) {
    lines[idx] = `node_type: ${nodeType}`;
  } else {
    lines.unshift(`node_type: ${nodeType}`);
  }
  const newFm = lines.join("\n");
  return noteText.replace(FRONTMATTER_RE, `---\n${newFm}\n---`);
}
