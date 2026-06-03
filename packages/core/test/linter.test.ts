import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildGraph } from "../src/graph.js";
import { lint, isInfiniteLoop, applyColors } from "../src/linter.js";
import { parseCanvas } from "../src/canvas.js";
import { diskFs } from "./helpers.js";
import { copyFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const FIX = join(import.meta.dirname, "fixtures");
const lintFile = (f: string) => lint(buildGraph(join(FIX, f), { fs: diskFs }), diskFs);

describe("lint structural rules", () => {
  it("passes a valid linear workflow", () => {
    const r = lintFile("linear.canvas");
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("fails when there is no start node", () => {
    const r = lintFile("no-start.canvas");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "one-start")).toBe(true);
  });

  it("fails on a dangling edge", () => {
    const r = lintFile("dangling.canvas");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "no-dangling-edges")).toBe(true);
  });
});

describe("loop classification", () => {
  it("classifies a single unlabeled back-edge loop as infinite", () => {
    const g = buildGraph(join(FIX, "infinite-child.canvas"), { fs: diskFs });
    expect(isInfiniteLoop(g, "cl")).toBe(true);
  });
});

describe("loop classification — bounded case", () => {
  it("classifies a conditioned loop with a labeled exit as NOT infinite", () => {
    const g = buildGraph(join(FIX, "bounded-loop-child.canvas"), { fs: diskFs });
    expect(isInfiniteLoop(g, "cl")).toBe(false);
  });
});

describe("structural rules — dead ends and branch labels", () => {
  it("flags a non-end node with no outgoing edge (no-dead-ends)", () => {
    const r = lintFile("dead-end.canvas");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "no-dead-ends")).toBe(true);
  });

  it("flags duplicate branch labels (distinct-branch-labels)", () => {
    const r = lintFile("dup-labels.canvas");
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.rule === "distinct-branch-labels")).toBe(true);
  });

  it("passes a branch with two distinct labels (positive control)", () => {
    const r = lintFile("branch.canvas");
    expect(r.ok).toBe(true);
  });
});

describe("embed rule: infinite loop forbidden in embedded workflow", () => {
  it("fails a parent that embeds a child containing an infinite loop", () => {
    const r = lintFile("embeds-infinite.canvas");
    expect(r.ok).toBe(false);
    const err = r.errors.find((e) => e.rule === "infinite-loop-in-embedded");
    expect(err).toBeDefined();
    expect(err!.message).toContain("infinite-child.canvas");
  });
});

describe("applyColors", () => {
  it("rewrites canvas node colors from node_type", () => {
    const dir = mkdtempSync(join(tmpdir(), "pw-"));
    for (const f of ["start-note.md", "prompt-note.md", "end-note.md"]) {
      copyFileSync(join(FIX, f), join(dir, f));
    }
    const canvasPath = join(dir, "linear.canvas");
    copyFileSync(join(FIX, "linear.canvas"), canvasPath);

    const changed = applyColors(buildGraph(canvasPath, { fs: diskFs }), canvasPath, diskFs);
    expect(changed).toBeGreaterThan(0);

    const after = parseCanvas(canvasPath, diskFs);
    const start = after.nodes.find((n) => n.id === "s")!;
    expect(start.color).toBe("4"); // green per NODE_COLORS.start
  });
});
