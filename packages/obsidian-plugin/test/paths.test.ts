import { describe, expect, it } from "vitest";
import { ancestorDirs } from "../src/fs/paths.js";

describe("ancestorDirs", () => {
  it("lists ancestor directories shallowest-first", () => {
    expect(ancestorDirs("_agents/workflows/INDEX.md")).toEqual([
      "_agents",
      "_agents/workflows",
    ]);
    expect(ancestorDirs(".claude/skills/perspecta-workflow-run/SKILL.md")).toEqual([
      ".claude",
      ".claude/skills",
      ".claude/skills/perspecta-workflow-run",
    ]);
  });

  it("returns no ancestors for a top-level file", () => {
    expect(ancestorDirs("CLAUDE.md")).toEqual([]);
  });

  it("ignores redundant separators", () => {
    expect(ancestorDirs("a//b/c.md")).toEqual(["a", "a/b"]);
  });

  it("creates each missing ancestor exactly once, in order (recursive mkdir)", () => {
    // Simulate the adapter ensureParentDir() drives: exists()/mkdir() over the
    // ancestor list. Verifies ordering, idempotency, and no duplicate mkdir.
    const made = new Set<string>(["_agents"]); // pretend _agents already exists
    const calls: string[] = [];
    for (const dir of ancestorDirs("_agents/workflows/sub/INDEX.md")) {
      if (!made.has(dir)) {
        calls.push(dir);
        made.add(dir);
      }
    }
    expect(calls).toEqual(["_agents/workflows", "_agents/workflows/sub"]);
  });
});
