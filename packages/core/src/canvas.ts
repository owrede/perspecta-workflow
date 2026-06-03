import { parse as parseYaml } from "yaml";
import type { Canvas, WorkflowNodeFrontmatter } from "./types.js";
import type { WorkflowFileSystem } from "./fs.js";

export function parseCanvas(path: string, fs: WorkflowFileSystem): Canvas {
  const raw = JSON.parse(fs.readText(path));
  return { nodes: raw.nodes ?? [], edges: raw.edges ?? [] };
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface ParsedNote {
  frontmatter: WorkflowNodeFrontmatter;
  body: string;
}

export function parseNodeNote(path: string, fs: WorkflowFileSystem): ParsedNote {
  const raw = fs.readText(path);
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`No frontmatter in node note: ${path}`);
  const frontmatter = parseYaml(m[1]) as WorkflowNodeFrontmatter;
  return { frontmatter, body: m[2] ?? "" };
}
