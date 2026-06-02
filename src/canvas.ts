import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import type { Canvas, WorkflowNodeFrontmatter } from "./types.js";

export function parseCanvas(path: string): Canvas {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  return { nodes: raw.nodes ?? [], edges: raw.edges ?? [] };
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface ParsedNote {
  frontmatter: WorkflowNodeFrontmatter;
  body: string;
}

export function parseNodeNote(path: string): ParsedNote {
  const raw = readFileSync(path, "utf8");
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`No frontmatter in node note: ${path}`);
  const frontmatter = parseYaml(m[1]) as WorkflowNodeFrontmatter;
  return { frontmatter, body: m[2] ?? "" };
}
