import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { buildGraph } from "../src/graph.js";
import { lint, isInfiniteLoop } from "../src/linter.js";

const FIX = join(import.meta.dirname, "fixtures");
const lintFile = (f: string) => lint(buildGraph(join(FIX, f)));

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
    const g = buildGraph(join(FIX, "infinite-child.canvas"));
    expect(isInfiniteLoop(g, "cl")).toBe(true);
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
