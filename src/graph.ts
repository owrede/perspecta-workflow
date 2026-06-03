import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseCanvas, parseNodeNote } from "./canvas.js";
import type { WorkflowGraph, WorkflowNode, WorkflowEdge } from "./types.js";

export interface BuildGraphOptions {
  vaultRoot?: string;
}

/**
 * Walk up from `startDir` looking for a directory that contains a `.obsidian`
 * folder. The directory CONTAINING `.obsidian` is the vault root. Returns
 * undefined if none is found before reaching the filesystem root.
 */
export function findVaultRoot(startDir: string): string | undefined {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(dir, ".obsidian"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined; // reached filesystem root
    dir = parent;
  }
}

/**
 * Resolve a canvas node's `file` reference, trying in order:
 *   1. Canvas-relative — resolve against the canvas directory; use if it exists.
 *   2. Vault-root-relative fallback — if a vaultRoot is known and the
 *      canvas-relative target does NOT exist, resolve against the vault root;
 *      use if THAT exists.
 *   3. Otherwise fall back to the canvas-relative path (preserves existing
 *      missing-file error semantics downstream).
 */
export function resolveNodeFile(
  canvasDir: string,
  file: string,
  vaultRoot?: string,
): string {
  const canvasRelative = resolve(canvasDir, file);
  if (existsSync(canvasRelative)) return canvasRelative;
  if (vaultRoot) {
    const vaultRelative = resolve(vaultRoot, file);
    if (existsSync(vaultRelative)) return vaultRelative;
  }
  return canvasRelative;
}

export function buildGraph(
  canvasPath: string,
  opts: BuildGraphOptions = {},
): WorkflowGraph {
  const canvas = parseCanvas(canvasPath);
  const baseDir = dirname(canvasPath);
  const vaultRoot = opts.vaultRoot ?? findVaultRoot(baseDir);
  const nodes = new Map<string, WorkflowNode>();

  for (const cn of canvas.nodes) {
    if (cn.type !== "file" || !cn.file) continue; // ignore text/group nodes in v1
    const target = resolveNodeFile(baseDir, cn.file, vaultRoot);

    if (cn.file.endsWith(".canvas")) {
      nodes.set(cn.id, {
        canvasNodeId: cn.id,
        kind: "subworkflow",
        filePath: target,
        childCanvasPath: target,
      });
      continue;
    }

    const note = parseNodeNote(target);
    nodes.set(cn.id, {
      canvasNodeId: cn.id,
      kind: note.frontmatter.node_type,
      filePath: target,
      frontmatter: note.frontmatter,
      body: note.body,
    });
  }

  const edges: WorkflowEdge[] = canvas.edges.map((e) => ({
    fromId: e.fromNode,
    toId: e.toNode,
    label: e.label,
  }));

  return { canvasPath, nodes, edges };
}
