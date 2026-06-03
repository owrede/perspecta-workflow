import { describe, it, expect } from "vitest";
import { ObsidianFileSystem } from "../src/fs/ObsidianFileSystem.js";

describe("ObsidianFileSystem", () => {
  it("reads from the preloaded map and records writes", () => {
    const fs = new ObsidianFileSystem(new Map([["a.md", "hi"]]));
    expect(fs.exists("a.md")).toBe(true);
    expect(fs.readText("a.md")).toBe("hi");
    expect(fs.exists("b.md")).toBe(false);
    fs.writeText("b.md", "yo");
    expect(fs.readText("b.md")).toBe("yo");
    expect(fs.pendingWrites().get("b.md")).toBe("yo");
  });

  it("throws on missing read", () => {
    const fs = new ObsidianFileSystem(new Map());
    expect(() => fs.readText("x")).toThrow();
  });

  it("resolves to vault-relative keys (matching preload), not absolute paths", () => {
    const fs = new ObsidianFileSystem(new Map());
    expect(fs.resolve("flows", "flows/start.md")).toBe("flows/start.md");
    expect(fs.resolve("", "flows/start.md")).toBe("flows/start.md");
  });
});
