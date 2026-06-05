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
  formatter: "render an output template from context vars",
};

/** The node types with descriptions, sourced from core's NODE_TYPES. */
export const NODE_TYPE_OPTIONS: NodeTypeOption[] = NODE_TYPES.map((type) => ({
  type,
  description: DESCRIPTIONS[type],
}));

/** Resolve a canvas node id to its `.md` node-note path, given the canvas JSON.
 *  Returns null if the node is missing, not a file-node, or not a markdown note. */
export function noteFilePathForNode(canvasJson: string, nodeId: string): string | null {
  let raw: { nodes?: { id?: string; type?: string; file?: string }[] };
  try { raw = JSON.parse(canvasJson); } catch { return null; }
  const node = (raw.nodes ?? []).find((n) => n.id === nodeId);
  if (node && node.type === "file" && typeof node.file === "string" && node.file.endsWith(".md")) {
    return node.file;
  }
  return null;
}

// CRLF-tolerant so a note written with Windows newlines is still edited.
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/**
 * Surgically set `node_type` in a node-note's frontmatter, preserving every
 * other frontmatter line and the body verbatim. Replaces an existing
 * `node_type:` line if present, otherwise inserts one after the opening `---`.
 * Throws if the note has no frontmatter block. The rewritten frontmatter is
 * re-emitted with `\n` line endings.
 */
export function setNodeTypeInFrontmatter(noteText: string, nodeType: NodeType): string {
  const m = noteText.match(FRONTMATTER_RE);
  if (!m) throw new Error("Node note has no frontmatter block");
  const lines = m[1].split(/\r?\n/);
  const idx = lines.findIndex((l) => /^node_type\s*:/.test(l));
  if (idx >= 0) {
    lines[idx] = `node_type: ${nodeType}`;
  } else {
    lines.unshift(`node_type: ${nodeType}`);
  }
  const newFm = lines.join("\n");
  return noteText.replace(FRONTMATTER_RE, `---\n${newFm}\n---`);
}
