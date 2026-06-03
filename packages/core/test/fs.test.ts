import { describe, it, expect } from "vitest";
import { InMemoryFileSystem } from "../src/fs.js";

describe("InMemoryFileSystem", () => {
  it("reads back what was written and reports existence", () => {
    const fs = new InMemoryFileSystem({ "/a.md": "hello" });
    expect(fs.exists("/a.md")).toBe(true);
    expect(fs.readText("/a.md")).toBe("hello");
    expect(fs.exists("/missing")).toBe(false);
    fs.writeText("/b.md", "world");
    expect(fs.readText("/b.md")).toBe("world");
  });

  it("throws on reading a missing file", () => {
    const fs = new InMemoryFileSystem();
    expect(() => fs.readText("/nope")).toThrow();
  });

  it("resolves a file path against a base dir by simple join", () => {
    const fs = new InMemoryFileSystem();
    expect(fs.resolve("/flows", "start.md")).toBe("/flows/start.md");
  });
});
