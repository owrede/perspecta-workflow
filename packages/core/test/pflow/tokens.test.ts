import { describe, it, expect } from "vitest";
import { parsePromptTokens } from "../../src/pflow/tokens.js";

describe("parsePromptTokens", () => {
  it("extracts in and out token names in first-occurrence order (default type string)", () => {
    const r = parsePromptTokens("Use {{in:topic}} and {{in:notes}}, produce {{out:draft}}.");
    expect(r.inputs).toEqual([
      { name: "topic", type: "string" },
      { name: "notes", type: "string" },
    ]);
    expect(r.outputs).toEqual([{ name: "draft", type: "string" }]);
  });
  it("parses an explicit :json / :table type suffix", () => {
    const r = parsePromptTokens("{{in:data:json}} -> {{out:rows:table}} and {{in:plain:string}}");
    expect(r.inputs).toEqual([
      { name: "data", type: "json" },
      { name: "plain", type: "string" },
    ]);
    expect(r.outputs).toEqual([{ name: "rows", type: "table" }]);
  });
  it("de-duplicates by name; first occurrence's type wins", () => {
    const r = parsePromptTokens("{{in:x:json}} ... {{in:x}} ... {{out:y}} {{out:y:table}}");
    expect(r.inputs).toEqual([{ name: "x", type: "json" }]);
    expect(r.outputs).toEqual([{ name: "y", type: "string" }]);
  });
  it("allows the same name as both in and out (distinct), each with its own type", () => {
    const r = parsePromptTokens("{{in:x}} -> {{out:x:json}}");
    expect(r.inputs).toEqual([{ name: "x", type: "string" }]);
    expect(r.outputs).toEqual([{ name: "x", type: "json" }]);
  });
  it("accepts digits/underscore/hyphen; rejects leading digit", () => {
    const r = parsePromptTokens("{{in:a_1}} {{in:b-2}} {{in:9bad}}");
    expect(r.inputs.map((t) => t.name)).toEqual(["a_1", "b-2"]);
  });
  it("ignores whitespace-bearing, malformed, or unknown-type tokens", () => {
    const r = parsePromptTokens("{{in: x}} {{ in:y}} {{in:z }} {{out:}} {{in:w:xml}}");
    expect(r.inputs).toEqual([]);
    expect(r.outputs).toEqual([]);
  });
  it("returns empty arrays for empty/undefined prompt", () => {
    expect(parsePromptTokens("")).toEqual({ inputs: [], outputs: [] });
    expect(parsePromptTokens(undefined as unknown as string)).toEqual({ inputs: [], outputs: [] });
  });
});
