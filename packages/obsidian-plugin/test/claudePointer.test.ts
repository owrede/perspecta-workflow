import { describe, it, expect } from "vitest";
import { upsertPointerBlock, POINTER_BEGIN, POINTER_END } from "../src/skills/claudePointer.js";

describe("upsertPointerBlock", () => {
  it("appends a marked block when none exists", () => {
    const out = upsertPointerBlock("# My Vault\n\nSome notes.\n");
    expect(out).toContain(POINTER_BEGIN);
    expect(out).toContain(POINTER_END);
    expect(out).toContain("_agents/workflows/INDEX.md");
    expect(out.startsWith("# My Vault")).toBe(true); // existing content preserved
  });
  it("replaces an existing block in place without duplicating", () => {
    const first = upsertPointerBlock("# V\n");
    const second = upsertPointerBlock(first);
    expect(second).toBe(first); // idempotent
    expect((second.match(new RegExp(POINTER_BEGIN, "g")) ?? []).length).toBe(1);
  });
  it("creates content from empty input", () => {
    const out = upsertPointerBlock("");
    expect(out).toContain(POINTER_BEGIN);
  });
});
