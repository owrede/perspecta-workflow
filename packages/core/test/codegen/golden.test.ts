import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePflow } from "../../src/pflow/schema.js";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "pflow");

describe("golden: summarize", () => {
  it("emits byte-identical expected output", () => {
    const doc = parsePflow(readFileSync(join(FIX, "summarize.pflow"), "utf8"));
    const expected = readFileSync(join(FIX, "summarize.expected.js"), "utf8");
    expect(generateClaudeCodeWorkflow(doc)).toBe(expected);
  });
});
