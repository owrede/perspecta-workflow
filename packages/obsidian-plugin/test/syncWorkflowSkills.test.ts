import { describe, it, expect } from "vitest";
import { planWorkflowSkills } from "../src/skills/syncWorkflowSkills.js";
import { renderWorkflowSkill } from "@perspecta/core";
import type { WorkflowSummary } from "@perspecta/core";

const s = (name: string, canvasPath: string): WorkflowSummary => ({
  name, canvasPath, trigger: `t-${name}`, purpose: `p-${name}`, nodeCount: 2,
});

describe("planWorkflowSkills", () => {
  it("writes a skill per summary at .claude/skills/<name>/SKILL.md", () => {
    const plan = planWorkflowSkills([s("person-brief", "flows/person-brief.canvas")], {});
    const write = plan.writes.find((w) => w.path === ".claude/skills/person-brief/SKILL.md");
    expect(write).toBeDefined();
    expect(write!.content).toContain("name: person-brief");
    expect(plan.deletes).toEqual([]);
  });

  it("prunes a generated skill whose source canvas is gone", () => {
    const existing = {
      ".claude/skills/old/SKILL.md": renderWorkflowSkill(s("old", "flows/old.canvas")),
    };
    const plan = planWorkflowSkills([s("keep", "flows/keep.canvas")], existing);
    expect(plan.deletes).toContain(".claude/skills/old/SKILL.md");
  });

  it("never deletes a hand-authored (unmarked) skill", () => {
    const existing = {
      ".claude/skills/hand/SKILL.md": "---\nname: hand\ndescription: mine\n---\nKeep me.",
    };
    const plan = planWorkflowSkills([], existing);
    expect(plan.deletes).toEqual([]);
  });

  it("re-writes (not duplicates) a generated skill that still has a source", () => {
    const existing = {
      ".claude/skills/keep/SKILL.md": renderWorkflowSkill(s("keep", "flows/keep.canvas")),
    };
    const plan = planWorkflowSkills([s("keep", "flows/keep.canvas")], existing);
    expect(plan.deletes).toEqual([]);
    expect(plan.writes.map((w) => w.path)).toContain(".claude/skills/keep/SKILL.md");
  });

  it("emits the registry and pointer paths", () => {
    const plan = planWorkflowSkills([s("a", "flows/a.canvas")], {});
    expect(plan.registryPath).toBe("_agents/workflows/INDEX.md");
    expect(plan.registryContent).toContain("a");
  });
});
