export interface VaultReader {
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
}

export interface PreloadResult { map: Map<string, string>; }

/**
 * Reads the canvas and every file-node it references (recursively for embedded
 * .canvas children) into a flat map keyed by the SAME path strings the canvas
 * uses. Vault paths are vault-relative, so we key by vault-relative path and the
 * core's fs receives those keys directly (no node:path resolution needed because
 * the plugin passes vaultRoot="" and the ObsidianFileSystem keys are vault-relative).
 */
export async function preloadCanvas(canvasPath: string, vault: VaultReader): Promise<PreloadResult> {
  const map = new Map<string, string>();
  const seen = new Set<string>();

  async function loadCanvas(path: string): Promise<void> {
    if (seen.has(path)) return;
    seen.add(path);
    const text = await vault.read(path);
    map.set(path, text);
    let raw: any;
    try { raw = JSON.parse(text); } catch { return; }
    for (const cn of raw.nodes ?? []) {
      if (cn.type !== "file" || !cn.file) continue;
      const target: string = cn.file;
      if (target.endsWith(".canvas")) {
        await loadCanvas(target);
      } else if (!map.has(target)) {
        if (await vault.exists(target)) map.set(target, await vault.read(target));
      }
    }
  }

  await loadCanvas(canvasPath);
  return { map };
}
