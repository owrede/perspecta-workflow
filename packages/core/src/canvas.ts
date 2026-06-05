import { parseNoteFrontmatter } from "./frontmatter.js";
import type { Canvas, WorkflowNodeFrontmatter } from "./types.js";
import type { WorkflowFileSystem } from "./fs.js";

export function parseCanvas(path: string, fs: WorkflowFileSystem): Canvas {
  const raw = JSON.parse(fs.readText(path));
  return { nodes: raw.nodes ?? [], edges: raw.edges ?? [] };
}

export interface ParsedNote {
  frontmatter: WorkflowNodeFrontmatter;
  body: string;
}

export function parseNodeNote(path: string, fs: WorkflowFileSystem): ParsedNote {
  const parsed = parseNoteFrontmatter<WorkflowNodeFrontmatter>(fs.readText(path));
  if (!parsed) throw new Error(`No frontmatter in node note: ${path}`);
  return parsed;
}
