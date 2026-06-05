/** Opaque timer handle — works whether schedule() is browser setTimeout (number)
 *  or Node setTimeout (Timeout). The watcher never inspects it. */
export type TimerId = unknown;

export interface ColorWatcherDeps {
  debounceMs: number;
  /** True if the canvas at this path carries the workflow marker. */
  isMarked: (canvasPath: string) => Promise<boolean>;
  /** Recolor + write the canvas; returns the written content or null if unchanged. */
  recolor: (canvasPath: string) => Promise<string | null>;
  schedule: (fn: () => void, ms: number) => TimerId;
  clearScheduled: (id: TimerId) => void;
}

/**
 * Debounced, marker-gated auto-color trigger with a self-write guard.
 * `onCanvasTouched(path)` is called for canvas opens and for modify events
 * affecting a canvas; `onSelfWrite(path)` records that the plugin itself just
 * wrote `path` so the resulting modify is ignored once.
 */
export class ColorWatcher {
  private timers = new Map<string, TimerId>();
  private suppress = new Set<string>();

  constructor(private deps: ColorWatcherDeps) {}

  onSelfWrite(canvasPath: string): void {
    this.suppress.add(canvasPath);
  }

  onCanvasTouched(canvasPath: string): void {
    if (this.suppress.has(canvasPath)) { this.suppress.delete(canvasPath); return; }
    const existing = this.timers.get(canvasPath);
    if (existing !== undefined) this.deps.clearScheduled(existing);
    const id = this.deps.schedule(() => {
      this.timers.delete(canvasPath);
      void this.run(canvasPath);
    }, this.deps.debounceMs);
    this.timers.set(canvasPath, id);
  }

  /** Cancel every pending debounced recolor. Call from the plugin's
   *  `onunload` so a scheduled write can't fire after the plugin is torn down. */
  dispose(): void {
    for (const id of this.timers.values()) this.deps.clearScheduled(id);
    this.timers.clear();
    this.suppress.clear();
  }

  private async run(canvasPath: string): Promise<void> {
    try {
      if (!(await this.deps.isMarked(canvasPath))) return;
      const wrote = await this.deps.recolor(canvasPath);
      if (wrote !== null) this.suppress.add(canvasPath);
    } catch {
      // best-effort: swallow (no Notice spam on every edit)
    }
  }
}
