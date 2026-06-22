import { describe, it, expect } from "vitest";
import { planWorkflowSkills } from "../src/skills/syncWorkflowSkills.js";
import { renderWorkflowSkill } from "@perspecta/core";
import type { PflowWorkflowSummary } from "@perspecta/core";

const s = (name: string): PflowWorkflowSummary => ({
  name, pflowPath: `_agents/${name}.pflow`, description: `t-${name}`, args: [],
});

describe("planWorkflowSkills", () => {
  it("writes a skill per summary at .claude/skills/<name>/SKILL.md", () => {
    const plan = planWorkflowSkills([s("person-brief")], {});
    const write = plan.writes.find((w) => w.path === ".claude/skills/person-brief/SKILL.md");
    expect(write).toBeDefined();
    expect(write!.content).toContain("name: person-brief");
    expect(plan.deletes).toEqual([]);
  });

  it("prunes a generated skill whose source .pflow is gone", () => {
    const existing = {
      ".claude/skills/old/SKILL.md": renderWorkflowSkill(s("old")),
    };
    const plan = planWorkflowSkills([s("keep")], existing);
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
      ".claude/skills/keep/SKILL.md": renderWorkflowSkill(s("keep")),
    };
    const plan = planWorkflowSkills([s("keep")], existing);
    expect(plan.deletes).toEqual([]);
    expect(plan.writes.map((w) => w.path)).toContain(".claude/skills/keep/SKILL.md");
  });

  it("emits no registry (the INDEX.md model is gone)", () => {
    const plan = planWorkflowSkills([s("a")], {});
    expect(plan).not.toHaveProperty("registryPath");
    expect(plan).not.toHaveProperty("registryContent");
  });
});
