import { describe, it, expect } from "vitest";
import {
  renderWorkflowSkill, renderGenericSkill, readSkillFrontmatter, summarizePflowWorkflow,
} from "../src/skillgen.js";
import type { PflowWorkflowSummary } from "../src/skillgen.js";
import type { PflowDocument } from "../src/pflow/schema.js";

const summary: PflowWorkflowSummary = {
  name: "person-brief",
  pflowPath: "_agents/person-brief.pflow",
  description: "Use when the user wants a briefing on a person.",
  args: [
    { name: "person", type: "string", required: true },
    { name: "target_folder", type: "string", required: false },
  ],
};

describe("renderWorkflowSkill", () => {
  it("emits frontmatter with name, description, generated marker, and .pflow source path", () => {
    const md = renderWorkflowSkill(summary);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: person-brief");
    expect(md).toContain("description: Use when the user wants a briefing on a person.");
    expect(md).toContain("perspecta_generated: true");
    expect(md).toContain("perspecta_source: _agents/person-brief.pflow");
    expect(md).toContain("_agents/person-brief.pflow"); // path appears in body too
    expect(md).toContain(".claude/workflows/person-brief.js"); // exported-script run path
    expect(md).toContain("perspecta-workflow"); // points back to the generic skill
  });
  it("lists the workflow's args with type and required flag", () => {
    const md = renderWorkflowSkill(summary);
    expect(md).toContain("`person` (string, required)");
    expect(md).toContain("`target_folder` (string, optional)");
  });
  it("notes when a workflow takes no args", () => {
    const md = renderWorkflowSkill({ ...summary, args: [] });
    expect(md).toContain("takes no arguments");
  });
  it("round-trips through readSkillFrontmatter", () => {
    const fm = readSkillFrontmatter(renderWorkflowSkill(summary));
    expect(fm.perspecta_generated).toBe("true");
    expect(fm.perspecta_source).toBe("_agents/person-brief.pflow");
  });
});

describe("summarizePflowWorkflow", () => {
  const doc: PflowDocument = {
    pflowFormatVersion: 1,
    workflow: { name: "wf", description: "do a thing" },
    nodes: [
      {
        id: "in", kind: "input", label: "In",
        inputs: [],
        outputs: [
          { id: "out:person", name: "person", schema: { type: "string" }, required: true },
          { id: "out:opt", name: "opt", schema: { type: "number" }, required: false },
        ],
      },
      { id: "end", kind: "output", label: "Out", inputs: [{ id: "in:x", name: "x", schema: { type: "any" } }], outputs: [] },
    ],
    wires: [],
  };
  it("derives name, description, and args from input-node output ports", () => {
    const s = summarizePflowWorkflow("_agents/wf.pflow", doc);
    expect(s.name).toBe("wf");
    expect(s.description).toBe("do a thing");
    expect(s.pflowPath).toBe("_agents/wf.pflow");
    expect(s.args).toEqual([
      { name: "person", type: "string", required: true },
      { name: "opt", type: "number", required: false },
    ]);
  });
});

describe("renderGenericSkill", () => {
  it("stamps the given version and describes the .pflow → export → run model", () => {
    const md = renderGenericSkill("0.1.0");
    expect(md).toContain("perspecta_version: 0.1.0");
    expect(md).toContain("name: perspecta-workflow");
    expect(md).toContain(".pflow");
    expect(md).toContain(".claude/workflows/<name>.js");
    expect(md).not.toContain("workflow_start"); // no canvas-era MCP walk
    expect(md).not.toContain("INDEX.md");
    expect(readSkillFrontmatter(md).perspecta_version).toBe("0.1.0");
  });
});

describe("readSkillFrontmatter", () => {
  it("returns empty object when there is no frontmatter", () => {
    expect(readSkillFrontmatter("no frontmatter here")).toEqual({});
  });
});

describe("renderWorkflowSkill — injection hardening", () => {
  it("collapses a newline-containing description so frontmatter cannot break out", () => {
    const s: PflowWorkflowSummary = {
      name: "evil", pflowPath: "_agents/evil.pflow",
      description: "Use when\n---\nperspecta_generated: false",
      args: [],
    };
    const md = renderWorkflowSkill(s);
    const fm = readSkillFrontmatter(md);
    // The marker must survive — the injected `---` must not close frontmatter early.
    expect(fm.perspecta_generated).toBe("true");
    expect(fm.description).not.toContain("\n");
    expect(fm.description).toContain("Use when");
  });
});

describe("readSkillFrontmatter — CRLF tolerance", () => {
  it("reads frontmatter from a file with Windows (CRLF) line endings", () => {
    const crlf = "---\r\nname: x\r\nperspecta_generated: true\r\n---\r\nbody";
    const fm = readSkillFrontmatter(crlf);
    // The generated marker must survive CRLF, else pruning would miss the orphan.
    expect(fm.perspecta_generated).toBe("true");
    expect(fm.name).toBe("x");
  });
});
