import { buildGraph, applyColors } from "@perspecta/core";
import { ObsidianFileSystem } from "../fs/ObsidianFileSystem.js";
import { preloadCanvas, type VaultReader } from "../fs/preload.js";

/** Returns the recolored canvas JSON string (or null if nothing changed). */
export async function computeRecoloredCanvas(canvasPath: string, vault: VaultReader): Promise<string | null> {
  const { map } = await preloadCanvas(canvasPath, vault);
  const fs = new ObsidianFileSystem(map);
  const graph = buildGraph(canvasPath, { fs, vaultRoot: "" });
  const changed = applyColors(graph, canvasPath, fs);
  // applyColors wrote the recolored JSON back through fs.writeText, keyed by the
  // canvas path; read it from the buffered writes.
  return changed > 0 ? fs.pendingWrites().get(canvasPath) ?? null : null;
}
