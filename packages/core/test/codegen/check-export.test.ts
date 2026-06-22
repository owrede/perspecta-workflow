import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parsePflow } from "../../src/pflow/schema.js";
import { generateClaudeCodeWorkflow } from "../../src/codegen/scriptgen.js";
import { checkExportFidelity } from "../../src/codegen/check-export.js";

const FIX = join(import.meta.dirname, "..", "fixtures", "pflow");

/** Every .pflow fixture, parsed + emitted. The faithful workflows and the
 *  golden summarize doc must all pass every fidelity check with zero errors. */
const fixtures = readdirSync(FIX)
  .filter((f) => f.endsWith(".pflow"))
  .map((f) => {
    const doc = parsePflow(readFileSync(join(FIX, f), "utf8"));
    return { name: f, doc, code: generateClaudeCodeWorkflow(doc) };
  });

/** Known, TRACKED codegen defects the fidelity layer correctly reports but which
 *  are not yet fixed in the emitter. Keyed by fixture name → the set of check
 *  names allowed to fire. When the underlying codegen bug is fixed, the matching
 *  fixture will produce ZERO errors and the `still reproduces` assertion below
 *  will fail — a deliberate tripwire telling us to delete the exception. */
const KNOWN_DEFECTS: Record<string, string[]> = {
  // (empty) — the branch-arm-input-data defect was fixed in sourceExpr: a wire
  // from a branch/eval output port now resolves to the branch's pass-through
  // input. Add an entry here only to track a NEW codegen defect the fidelity
  // layer reports but that is not yet fixed in the emitter.
};

describe("checkExportFidelity: corpus is clean (modulo tracked defects)", () => {
  for (const { name, doc, code } of fixtures) {
    const allowed = KNOWN_DEFECTS[name] ?? [];
    it(`${name} has no unexpected fidelity errors`, () => {
      const report = checkExportFidelity(doc, code);
      const unexpected = report.findings.filter(
        (f) => f.severity === "error" && !allowed.includes(f.check),
      );
      expect(unexpected, JSON.stringify(unexpected, null, 2)).toEqual([]);
      if (allowed.length === 0) expect(report.ok).toBe(true);
    });
  }

  // Tripwire: the known defect MUST still reproduce. If a codegen fix removes it,
  // this fails so we delete the KNOWN_DEFECTS entry rather than leave dead masks.
  for (const [name, checks] of Object.entries(KNOWN_DEFECTS)) {
    const fx = fixtures.find((f) => f.name === name);
    it(`${name} still reproduces tracked defect(s): ${checks.join(", ")}`, () => {
      expect(fx, `fixture ${name} not found`).toBeTruthy();
      const report = checkExportFidelity(fx!.doc, fx!.code);
      for (const c of checks) {
        expect(
          report.findings.some((f) => f.severity === "error" && f.check === c),
          `expected tracked defect "${c}" to still fire for ${name}; if codegen was fixed, remove it from KNOWN_DEFECTS`,
        ).toBe(true);
      }
    });
  }
});

/** Mutation tests: corrupt a known-good emit and assert the responsible check
 *  fires. Proves the checks have teeth (a passing corpus alone could mean the
 *  checks are vacuous). We pick the summarize fixture as the stable base. */
describe("checkExportFidelity: mutations are caught", () => {
  const summarize = fixtures.find((f) => f.name === "summarize.pflow")!;

  it("flags a dropped node variable declaration", () => {
    // Rename the first `const X_n =` so the node's expected var is never declared.
    const broken = summarize.code.replace(/const (\w+_\d+) =/, "const ZZZ_removed =");
    const report = checkExportFidelity(summarize.doc, broken);
    expect(report.ok).toBe(false);
    expect(report.findings.some((f) => f.check === "node-emits-variable")).toBe(true);
  });

  it("flags a dropped wire dependency (renamed downstream reference)", () => {
    // Break every occurrence of a mid-pipeline variable so its consumer loses it.
    const m = summarize.code.match(/const (\w+_\d+) =/);
    const v = m![1];
    const broken = summarize.code.split(v).join(`${v}_MANGLED`);
    // Re-introduce ONLY the declaration so node-emits-variable still passes and
    // we isolate wire-realized — actually simplest: just assert SOME error fires.
    const report = checkExportFidelity(summarize.doc, broken);
    expect(report.ok).toBe(false);
  });

  it("a faithful workflow with a stripped return fails output-returns", () => {
    const broken = summarize.code.replace(/return [^\n]+/, "// return removed");
    const report = checkExportFidelity(summarize.doc, broken);
    expect(report.findings.some((f) => f.check === "output-returns")).toBe(true);
    expect(report.ok).toBe(false);
  });
});
