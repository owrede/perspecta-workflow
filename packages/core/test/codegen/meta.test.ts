import { describe, it, expect } from "vitest";
import { renderMeta, jsString } from "../../src/codegen/scriptgen.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

describe("jsString", () => {
  it("escapes quotes, backslashes, and newlines", () => {
    expect(jsString(`a"b\\c\nd`)).toBe(`"a\\"b\\\\c\\nd"`);
  });
});

describe("renderMeta", () => {
  it("emits a pure-literal meta with phases", () => {
    const doc = {
      pflowFormatVersion: 1,
      workflow: { name: "audit", description: "Audit endpoints" },
      nodes: [
        { id: "a", kind: "agent", label: "a", phase: "Scan", inputs: [], outputs: [] },
        { id: "b", kind: "agent", label: "b", phase: "Verify", inputs: [], outputs: [] },
      ],
      wires: [],
    } as unknown as PflowDocument;
    const out = renderMeta(doc);
    expect(out).toContain("export const meta = {");
    expect(out).toContain('name: "audit"');
    expect(out).toContain('description: "Audit endpoints"');
    expect(out).toContain('{ title: "Scan" }');
    expect(out).toContain('{ title: "Verify" }');
    expect(out).not.toContain("${");
  });
});
