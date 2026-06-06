import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePflow } from "../../src/pflow/schema.js";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import { validatePflow } from "../../src/pflow/validate.js";

// The faithful re-migration of the meeting-followup workflow: 7 visible nodes
// (input, read, draft, review-LOOP, format, save, output) with a real refine
// loop and NO script escape-hatch node. This guards that the migrated .pflow
// stays valid and keeps compiling to a working, faithful CC workflow.
const FIX = join(import.meta.dirname, "..", "fixtures", "pflow");
const doc = parsePflow(readFileSync(join(FIX, "meeting-followup-faithful.pflow"), "utf8"));

describe("meeting-followup faithful migration", () => {
  it("validates clean", () => {
    expect(validatePflow(doc).ok).toBe(true);
  });

  it("has the faithful node vocabulary (loop, no script)", () => {
    expect(doc.nodes).toHaveLength(7);
    expect(doc.nodes.filter((n) => n.kind === "loop")).toHaveLength(1);
    expect(doc.nodes.filter((n) => n.kind === "script")).toHaveLength(0);
    expect(doc.nodes.filter((n) => n.kind === "output")).toHaveLength(1);
  });

  it("compiles to a bounded review loop that saves via write_note", () => {
    const code = generateClaudeCodeWorkflow(doc);
    // a visible bounded refine loop
    expect(code).toMatch(/for \(let pass = 0; pass < 3; pass\+\+\)/);
    expect(code).toContain("ALL_OWNED");
    // the draft re-runs inside the loop weaving the prior fix back in
    expect(code).toMatch(/Draft_follow_up_\d+ = await agent/);
    // the specific meeting arg is woven, not the whole args object
    expect(code).toContain("${args.meeting}");
    // saved via the write_note tool, then returned
    expect(code).toContain("write_note");
    expect(code).toMatch(/return Save_follow_up_\d+;/);
  });

  it("compiles deterministically (byte-identical across emissions)", () => {
    expect(generateClaudeCodeWorkflow(doc)).toBe(generateClaudeCodeWorkflow(doc));
  });
});
