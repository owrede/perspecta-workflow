import { describe, it, expect } from "vitest";
import { parsePromptTokens } from "../../src/pflow/tokens.js";

describe("parsePromptTokens", () => {
  it("extracts in and out token names in first-occurrence order", () => {
    const r = parsePromptTokens("Use {{in:topic}} and {{in:notes}}, produce {{out:draft}}.");
    expect(r.inputs).toEqual(["topic", "notes"]);
    expect(r.outputs).toEqual(["draft"]);
  });
  it("de-duplicates repeated tokens", () => {
    const r = parsePromptTokens("{{in:x}} ... {{in:x}} ... {{out:y}} {{out:y}}");
    expect(r.inputs).toEqual(["x"]);
    expect(r.outputs).toEqual(["y"]);
  });
  it("allows the same name as both in and out (distinct)", () => {
    const r = parsePromptTokens("{{in:x}} -> {{out:x}}");
    expect(r.inputs).toEqual(["x"]);
    expect(r.outputs).toEqual(["x"]);
  });
  it("accepts digits/underscore/hyphen; rejects leading digit", () => {
    const r = parsePromptTokens("{{in:a_1}} {{in:b-2}} {{in:9bad}}");
    expect(r.inputs).toEqual(["a_1", "b-2"]);
  });
  it("ignores whitespace-bearing or malformed braces", () => {
    const r = parsePromptTokens("{{in: x}} {{ in:y}} {{in:z }} {{out:}}");
    expect(r.inputs).toEqual([]);
    expect(r.outputs).toEqual([]);
  });
  it("returns empty arrays for empty/undefined prompt", () => {
    expect(parsePromptTokens("")).toEqual({ inputs: [], outputs: [] });
    expect(parsePromptTokens(undefined as unknown as string)).toEqual({ inputs: [], outputs: [] });
  });
});
