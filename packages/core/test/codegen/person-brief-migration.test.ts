import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePflow } from "../../src/pflow/schema.js";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import { validatePflow } from "../../src/pflow/validate.js";

// Faithful re-migration of person-brief: 8 visible nodes with a real BRANCH
// (condense-if-too-long) that reconverges at Format. No script escape-hatch.
const FIX = join(import.meta.dirname, "..", "fixtures", "pflow");
const doc = parsePflow(readFileSync(join(FIX, "person-brief-faithful.pflow"), "utf8"));

describe("person-brief faithful migration", () => {
  it("validates clean", () => {
    expect(validatePflow(doc).ok).toBe(true);
  });

  it("has the faithful vocabulary (branch, no script)", () => {
    expect(doc.nodes).toHaveLength(8);
    expect(doc.nodes.filter((n) => n.kind === "branch")).toHaveLength(1);
    expect(doc.nodes.filter((n) => n.kind === "script")).toHaveLength(0);
    expect(doc.nodes.filter((n) => n.kind === "output")).toHaveLength(1);
  });

  it("compiles to a BRANCH dispatch reconverging at format, then write_note", () => {
    const code = generateClaudeCodeWorkflow(doc);
    expect(code).toContain("BRANCH:");
    expect(code).toContain("} else if (");
    expect(code).toMatch(/let Length_check_\d+_result;/);
    expect(code).toMatch(/\$\{Length_check_\d+_result\}/);
    expect(code).toContain("${args.person}");
    expect(code).toContain("write_note");
    expect(code).toMatch(/return Save_brief_\d+;/);
  });

  it("compiles deterministically", () => {
    expect(generateClaudeCodeWorkflow(doc)).toBe(generateClaudeCodeWorkflow(doc));
  });

  it("both branch paths execute without a ReferenceError", async () => {
    const code = generateClaudeCodeWorkflow(doc);
    const body = code.slice(code.indexOf("  const Read_"));
    for (const verdict of ["BRANCH: long", "BRANCH: ok"]) {
      const agent = async (p: string) =>
        /Choose exactly ONE path/i.test(p) ? verdict : "stub-result";
      const args = { person: "X" };
      const runEmitted = new Function("agent", "args", `return (async () => { ${body} })();`);
      await expect(runEmitted(agent, args)).resolves.toBeDefined();
    }
  });
});
