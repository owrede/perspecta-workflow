import { describe, it, expect } from "vitest";
import { PortSchemaZ } from "../../src/pflow/schema.js";

describe("PortSchema", () => {
  it("accepts a scalar type", () => {
    expect(PortSchemaZ.parse({ type: "string" })).toEqual({ type: "string" });
  });
  it("accepts an array with item type", () => {
    const s = { type: "array", items: { type: "string" } };
    expect(PortSchemaZ.parse(s)).toEqual(s);
  });
  it("accepts a nested object schema", () => {
    const s = { type: "object", properties: { title: { type: "string" }, n: { type: "number" } }, required: ["title"] };
    expect(PortSchemaZ.parse(s)).toEqual(s);
  });
  it("rejects an unknown type", () => {
    expect(() => PortSchemaZ.parse({ type: "blob" })).toThrow();
  });
});
