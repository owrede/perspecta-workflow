import { describe, it, expect } from "vitest";
import { lintEmittedScript } from "../../src/codegen/emit-lint.js";

describe("lintEmittedScript", () => {
  it("passes clean deterministic code", () => {
    const r = lintEmittedScript("const x = await agent('hi');\nreturn x;\n");
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });
  it.each([
    ["Date.now()", "Date.now"],
    ["Math.random()", "Math.random"],
    ["new Date()", "new Date"],
    ["require('fs')", "require"],
    ["await fetch('http://x')", "fetch"],
    ["fs.readFileSync('x')", "fs."],
    ["await import('node:fs')", "import("],
  ])("rejects %s", (snippet, token) => {
    const r = lintEmittedScript(`const v = ${snippet};\n`);
    expect(r.ok).toBe(false);
    expect(r.violations.some((v) => v.token === token)).toBe(true);
  });
  it("allows new Date(arg) with an argument", () => {
    expect(lintEmittedScript("const d = new Date(args.iso);\n").ok).toBe(true);
  });
});
