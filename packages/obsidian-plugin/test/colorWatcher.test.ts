import { describe, it, expect } from "vitest";
import { ColorWatcher } from "../src/live/colorWatcher.js";

function makeHarness(marked: Set<string>) {
  const recolored: string[] = [];
  let now = 0;
  const timers: { at: number; fn: () => void }[] = [];
  const watcher = new ColorWatcher({
    debounceMs: 400,
    isMarked: async (p: string) => marked.has(p),
    recolor: async (p: string) => { recolored.push(p); return p.endsWith(".canvas") ? "wrote" : null; },
    schedule: (fn, ms) => { const id = timers.length; timers.push({ at: now + ms, fn }); return id as unknown as ReturnType<typeof setTimeout>; },
    clearScheduled: (id) => { const i = id as unknown as number; if (timers[i]) timers[i] = { at: Infinity, fn: () => {} }; },
  });
  const tick = (ms: number) => { now += ms; for (const t of timers) if (t.at <= now) { t.at = Infinity; t.fn(); } };
  return { watcher, recolored, tick };
}

describe("ColorWatcher", () => {
  it("recolors a marked canvas after the debounce", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set(["wf.canvas"]));
    watcher.onCanvasTouched("wf.canvas");
    expect(recolored).toEqual([]);    // not yet — debounced
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]);
  });

  it("does nothing for an unmarked canvas", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set());
    watcher.onCanvasTouched("plain.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual([]);
  });

  it("coalesces rapid touches into one recolor", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set(["wf.canvas"]));
    watcher.onCanvasTouched("wf.canvas");
    tick(100); watcher.onCanvasTouched("wf.canvas");
    tick(100); watcher.onCanvasTouched("wf.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]);
  });

  it("dispose() cancels a pending debounced recolor", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set(["wf.canvas"]));
    watcher.onCanvasTouched("wf.canvas");
    watcher.dispose();
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual([]); // the scheduled recolor was cancelled
  });

  it("suppresses the self-write modify that follows a recolor", async () => {
    const { watcher, recolored, tick } = makeHarness(new Set(["wf.canvas"]));
    watcher.onCanvasTouched("wf.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]);
    // the recolor wrote the file; simulate the resulting modify event
    watcher.onSelfWrite("wf.canvas");
    watcher.onCanvasTouched("wf.canvas");
    tick(400);
    await Promise.resolve();
    expect(recolored).toEqual(["wf.canvas"]); // NOT recolored again
  });
});
