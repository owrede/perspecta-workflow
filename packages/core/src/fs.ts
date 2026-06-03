export interface WorkflowFileSystem {
  readText(path: string): string;
  writeText(path: string, data: string): void;
  exists(path: string): boolean;
  /** Resolve a node `file` reference (from a canvas) against the canvas's directory.
   *  The FS owns resolution: Node uses node:path; Obsidian keeps vault-relative keys. */
  resolve(canvasDir: string, file: string): string;
}

/** In-memory implementation for tests. Resolves by simple POSIX-style join. */
export class InMemoryFileSystem implements WorkflowFileSystem {
  private store = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.store.set(k, v);
  }
  readText(path: string): string {
    const v = this.store.get(path);
    if (v === undefined) throw new Error(`ENOENT: ${path}`);
    return v;
  }
  writeText(path: string, data: string): void { this.store.set(path, data); }
  exists(path: string): boolean { return this.store.has(path); }
  resolve(canvasDir: string, file: string): string {
    if (!canvasDir) return file;
    return `${canvasDir.replace(/\/$/, "")}/${file}`;
  }
}
