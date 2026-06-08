import { describe, it, expect } from "vitest";
import { EVAL_MODES, templateForMode } from "../src/views/pflow-editor/eval-templates.js";

describe("eval-templates", () => {
  it("exposes the three v1 modes", () => {
    expect(EVAL_MODES).toEqual(["criteria", "comparison", "threshold"]);
  });

  it("every template declares pass + fail out-tokens and a candidate in-token", () => {
    for (const mode of EVAL_MODES) {
      const t = templateForMode(mode);
      expect(t).toContain("{{in:candidate}}");
      expect(t).toContain("{{out:pass}}");
      expect(t).toContain("{{out:fail}}");
      expect(t).toContain("EVAL: pass");
      expect(t).toContain("EVAL: fail");
    }
  });

  it("comparison template additionally declares a reference in-token", () => {
    expect(templateForMode("comparison")).toContain("{{in:reference}}");
    expect(templateForMode("criteria")).not.toContain("{{in:reference}}");
    expect(templateForMode("threshold")).not.toContain("{{in:reference}}");
  });
});
