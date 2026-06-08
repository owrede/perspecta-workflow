import { describe, it, expect } from "vitest";
import { resolveNodePath, augmentedPath } from "../src/mcp/nodeResolver.js";

describe("resolveNodePath", () => {
  const noReaddir = () => { throw new Error("nvm dir absent"); };

  it("prefers a node found on PATH", () => {
    const env = { PATH: "/custom/bin:/usr/bin", HOME: "/home/u" };
    const exists = (p: string) => p === "/custom/bin/node";
    expect(resolveNodePath(env, exists, noReaddir)).toBe("/custom/bin/node");
  });

  it("falls back to Homebrew when PATH has no node", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/u" };
    const exists = (p: string) => p === "/opt/homebrew/bin/node";
    expect(resolveNodePath(env, exists, noReaddir)).toBe("/opt/homebrew/bin/node");
  });

  it("enumerates nvm installs newest-first", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/u" };
    const readdir = (p: string) => p === "/home/u/.nvm/versions/node" ? ["v18.0.0", "v24.11.1", "v20.1.0"] : [];
    // Only the newest nvm node exists on disk.
    const exists = (p: string) => p === "/home/u/.nvm/versions/node/v24.11.1/bin/node";
    expect(resolveNodePath(env, exists, readdir)).toBe("/home/u/.nvm/versions/node/v24.11.1/bin/node");
  });

  it("returns null when no node exists anywhere", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/u" };
    expect(resolveNodePath(env, () => false, noReaddir)).toBeNull();
  });
});

describe("augmentedPath", () => {
  const noReaddir = () => { throw new Error("no nvm"); };

  it("keeps the existing PATH first, then appends well-known dirs", () => {
    const env = { PATH: "/usr/bin:/bin", HOME: "/home/u" };
    const result = augmentedPath(env, noReaddir).split(":");
    expect(result[0]).toBe("/usr/bin");
    expect(result[1]).toBe("/bin");
    expect(result).toContain("/home/u/.local/bin"); // uv/uvx
    expect(result).toContain("/opt/homebrew/bin");
    expect(result).toContain("/home/u/.cargo/bin");
  });

  it("includes nvm bin dirs when present", () => {
    const env = { PATH: "/usr/bin", HOME: "/home/u" };
    const readdir = (p: string) => p === "/home/u/.nvm/versions/node" ? ["v24.11.1"] : [];
    expect(augmentedPath(env, readdir).split(":")).toContain("/home/u/.nvm/versions/node/v24.11.1/bin");
  });

  it("dedupes directories", () => {
    const env = { PATH: "/opt/homebrew/bin:/usr/bin", HOME: "/home/u" };
    const parts = augmentedPath(env, noReaddir).split(":");
    expect(parts.filter((p) => p === "/opt/homebrew/bin")).toHaveLength(1);
  });
});
