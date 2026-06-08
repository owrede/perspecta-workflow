import { describe, expect, it } from "vitest";
import { parsePflow, PflowDocumentZ } from "../../src/pflow/schema.js";

const DOC = {
  pflowFormatVersion: 1,
  workflow: { name: "wf", description: "" },
  nodes: [],
  wires: [],
  perspecta: { uid: "abc", context: { v: 2, ts: 1 } },
};

describe("pflow schema preserves the perspecta block", () => {
  it("parsePflow keeps a top-level perspecta block", () => {
    const parsed = parsePflow(JSON.stringify(DOC));
    expect((parsed as Record<string, unknown>).perspecta).toEqual(DOC.perspecta);
  });

  it("re-serialization round-trips the perspecta block", () => {
    const parsed = PflowDocumentZ.parse(DOC);
    const out = JSON.parse(JSON.stringify(parsed));
    expect(out.perspecta).toEqual(DOC.perspecta);
  });
});
