import type { WorkflowFileSystem } from "@perspecta/core";

/**
 * Synchronous WorkflowFileSystem backed by a preloaded map of file contents,
 * keyed by VAULT-RELATIVE paths (exactly as the canvas references them and as
 * preload stored them). Writes are buffered in-memory; the caller flushes them
 * to the Vault via pendingWrites().
 */
export class ObsidianFileSystem implements WorkflowFileSystem {
  private writes = new Map<string, string>();
  constructor(private files: Map<string, string>) {}

  readText(path: string): string {
    if (this.writes.has(path)) return this.writes.get(path)!;
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`Not preloaded: ${path}`);
    return v;
  }
  writeText(path: string, data: string): void {
    this.writes.set(path, data);
    this.files.set(path, data);
  }
  exists(path: string): boolean { return this.files.has(path) || this.writes.has(path); }
  /** Obsidian canvas `file` values are already vault-relative; identity on `file`. */
  resolve(_canvasDir: string, file: string): string { return file; }
  pendingWrites(): Map<string, string> { return this.writes; }
}
