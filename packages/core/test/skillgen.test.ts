import { describe, it, expect } from "vitest";
import {
  renderWorkflowSkill, renderRegistry, renderGenericSkill, readSkillFrontmatter,
} from "../src/skillgen.js";
import type { WorkflowSummary } from "../src/registry.js";

const summary: WorkflowSummary = {
  name: "person-brief",
  canvasPath: "flows/person-brief.canvas",
  trigger: "Use when the user wants a briefing on a person.",
  purpose: "Produce a concise person brief.",
  nodeCount: 6,
};

describe("renderWorkflowSkill", () => {
  it("emits frontmatter with name, description=trigger, generated marker, and source path", () => {
    const md = renderWorkflowSkill(summary);
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: person-brief");
    expect(md).toContain("description: Use when the user wants a briefing on a person.");
    expect(md).toContain("perspecta_generated: true");
    expect(md).toContain("perspecta_source: flows/person-brief.canvas");
    expect(md).toContain("flows/person-brief.canvas"); // canvas path appears in body too
    expect(md).toContain("perspecta-workflow"); // points back to the generic skill
  });
  it("round-trips through readSkillFrontmatter", () => {
    const fm = readSkillFrontmatter(renderWorkflowSkill(summary));
    expect(fm.perspecta_generated).toBe("true");
    expect(fm.perspecta_source).toBe("flows/person-brief.canvas");
  });
});

describe("renderRegistry", () => {
  it("renders a table row per workflow with name, purpose, trigger, nodeCount", () => {
    const md = renderRegistry([summary]);
    expect(md).toContain("person-brief");
    expect(md).toContain("Produce a concise person brief.");
    expect(md).toContain("Use when the user wants a briefing on a person.");
    expect(md).toContain("6");
    expect(md).toContain("generated_by: perspecta-workflow");
  });
  it("renders an empty-state line when there are no workflows", () => {
    expect(renderRegistry([])).toContain("No workflows");
  });
});

describe("renderGenericSkill", () => {
  it("stamps the given version into perspecta_version frontmatter", () => {
    const md = renderGenericSkill("0.1.0");
    expect(md).toContain("perspecta_version: 0.1.0");
    expect(md).toContain("name: perspecta-workflow");
    expect(readSkillFrontmatter(md).perspecta_version).toBe("0.1.0");
  });
});

describe("readSkillFrontmatter", () => {
  it("returns empty object when there is no frontmatter", () => {
    expect(readSkillFrontmatter("no frontmatter here")).toEqual({});
  });
});
