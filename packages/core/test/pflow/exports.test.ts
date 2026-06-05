import { describe, it, expect } from "vitest";
import * as core from "../../src/index.js";

describe("public API surface", () => {
  it("re-exports the pflow IR and codegen", () => {
    expect(typeof core.parsePflow).toBe("function");
    expect(typeof core.validatePflow).toBe("function");
    expect(typeof core.topoOrder).toBe("function");
    expect(typeof core.generateClaudeCodeWorkflow).toBe("function");
    expect(typeof core.lintEmittedScript).toBe("function");
    expect(core.NODE_KINDS).toContain("split");
  });
});
