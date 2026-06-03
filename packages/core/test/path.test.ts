import { describe, it, expect } from "vitest";
import { dirname } from "../src/path.js";

describe("dirname (pure, POSIX)", () => {
  it("returns the parent directory of a file path", () => {
    expect(dirname("/a/b/c.md")).toBe("/a/b");
    expect(dirname("/a/b")).toBe("/a");
  });
  it("collapses a trailing slash like node:path", () => {
    expect(dirname("/a/b/")).toBe("/a");
  });
  it("returns the root for a top-level entry", () => {
    expect(dirname("/a")).toBe("/");
    expect(dirname("/")).toBe("/");
  });
  it("handles a bare filename (no slash) as '.'", () => {
    expect(dirname("file.md")).toBe(".");
    expect(dirname("")).toBe(".");
  });
  it("handles nested relative paths", () => {
    expect(dirname("flows/start.md")).toBe("flows");
    expect(dirname("flows")).toBe(".");
  });
});
