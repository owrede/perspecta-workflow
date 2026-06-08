import { describe, it, expect } from "vitest";
import { KIND_INFO, PROMPT_KINDS } from "../src/views/pflow-editor/kind-info.js";

describe("kind-info — eval", () => {
  it("has a KIND_INFO entry for eval", () => {
    expect(KIND_INFO.eval).toBeDefined();
    expect(KIND_INFO.eval.title).toBe("Eval");
    expect(KIND_INFO.eval.color).toContain("--color-cyan");
  });
  it("includes eval in PROMPT_KINDS", () => {
    expect(PROMPT_KINDS).toContain("eval");
  });
});
