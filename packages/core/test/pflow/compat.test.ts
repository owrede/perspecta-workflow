import { describe, it, expect } from "vitest";
import { schemaCompatible } from "../../src/pflow/validate.js";

describe("schemaCompatible", () => {
  it("any joins anything", () => {
    expect(schemaCompatible({ type: "any" }, { type: "string" })).toBe(true);
    expect(schemaCompatible({ type: "number" }, { type: "any" })).toBe(true);
  });
  it("same scalar type joins", () => {
    expect(schemaCompatible({ type: "string" }, { type: "string" })).toBe(true);
  });
  it("different scalar types do not join", () => {
    expect(schemaCompatible({ type: "string" }, { type: "number" })).toBe(false);
  });
  it("arrays must share item type", () => {
    expect(schemaCompatible({ type: "array", items: { type: "string" } }, { type: "array", items: { type: "string" } })).toBe(true);
    expect(schemaCompatible({ type: "array", items: { type: "string" } }, { type: "array", items: { type: "number" } })).toBe(false);
  });
  it("array items default to any when omitted", () => {
    expect(schemaCompatible({ type: "array" }, { type: "array", items: { type: "string" } })).toBe(true);
  });
  it("object joins object (shallow)", () => {
    expect(schemaCompatible({ type: "object" }, { type: "object", properties: {} })).toBe(true);
  });
});
