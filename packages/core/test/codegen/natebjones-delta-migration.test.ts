import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parsePflow } from "../../src/pflow/schema.js";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import { validatePflow } from "../../src/pflow/validate.js";

// Faithful re-migration of natebjones-delta: the most complex workflow — 17
// visible nodes with TWO loops (a self-loop precondition retry + the propagate
// loop) and two parallel source pipelines (Substack + YouTube) converging at the
// delta analysis. No script escape-hatch.
const FIX = join(import.meta.dirname, "..", "fixtures", "pflow");
const doc = parsePflow(readFileSync(join(FIX, "natebjones-delta-faithful.pflow"), "utf8"));

describe("natebjones-delta faithful migration", () => {
  it("validates clean", () => {
    expect(validatePflow(doc).ok).toBe(true);
  });

  it("has the faithful vocabulary (2 loops, no script)", () => {
    expect(doc.nodes).toHaveLength(17);
    expect(doc.nodes.filter((n) => n.kind === "loop")).toHaveLength(2);
    expect(doc.nodes.filter((n) => n.kind === "script")).toHaveLength(0);
    expect(doc.nodes.filter((n) => n.kind === "synthesize")).toHaveLength(1); // delta
    expect(doc.nodes.filter((n) => n.kind === "output")).toHaveLength(1);
  });

  it("compiles to two bounded loops and saves via write_note", () => {
    const code = generateClaudeCodeWorkflow(doc);
    expect(code).toMatch(/for \(let pass = 0; pass < 5; pass\+\+\)/); // precond self-loop
    expect(code).toMatch(/for \(let pass = 0; pass < 12; pass\+\+\)/); // propagate loop
    expect(code).toContain("SESSION:");
    expect(code).toContain("ALL_ROWS_DONE:");
    expect(code).toContain("write_note");
    expect(code).toMatch(/return Cleanup_\d+;/);
  });

  it("compiles deterministically", () => {
    expect(generateClaudeCodeWorkflow(doc)).toBe(generateClaudeCodeWorkflow(doc));
  });

  it("both loops execute without a ReferenceError", async () => {
    const code = generateClaudeCodeWorkflow(doc);
    const body = code.slice(code.indexOf("  const Read_corpus"));
    const agent = async () => "SESSION: ready\nALL_ROWS_DONE: yes";
    const args = { requested_period: "" };
    const runEmitted = new Function("agent", "args", `return (async () => { ${body} })();`);
    await expect(runEmitted(agent, args)).resolves.toBeDefined();
  });
});
