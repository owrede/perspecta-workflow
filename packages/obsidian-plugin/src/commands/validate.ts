import { buildGraph, lint, type LintResult } from "@perspecta/core";
import { ObsidianFileSystem } from "../fs/ObsidianFileSystem.js";
import { preloadCanvas, type VaultReader } from "../fs/preload.js";

export async function runValidation(canvasPath: string, vault: VaultReader): Promise<LintResult> {
  const { map } = await preloadCanvas(canvasPath, vault);
  const fs = new ObsidianFileSystem(map);
  const graph = buildGraph(canvasPath, { fs, vaultRoot: "" });
  return lint(graph, fs);
}
