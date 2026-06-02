import { describe, it, expect } from "vitest";
import { ContextBag, resolveTemplate, resolveTemplateDetailed } from "../src/context.js";

describe("ContextBag", () => {
  it("stores and retrieves named values", () => {
    const ctx = new ContextBag();
    ctx.set("summary", "hello");
    expect(ctx.get("summary")).toBe("hello");
    expect(ctx.all()).toEqual({ summary: "hello" });
  });
});

describe("resolveTemplate", () => {
  it("replaces {{name}} placeholders from the context", () => {
    const ctx = new ContextBag();
    ctx.set("topic", "the meeting");
    expect(resolveTemplate("Summarize {{topic}}.", ctx)).toBe("Summarize the meeting.");
  });

  it("leaves unknown placeholders untouched and records them", () => {
    const ctx = new ContextBag();
    const { text, missing } = resolveTemplateDetailed("Use {{a}} and {{b}}.", ctx);
    expect(missing).toEqual(["a", "b"]);
    expect(text).toBe("Use {{a}} and {{b}}.");
  });
});
