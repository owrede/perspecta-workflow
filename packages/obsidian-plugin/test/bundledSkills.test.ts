import { describe, expect, it } from "vitest";
import { bundledSkillWrites } from "../src/skills/bundledSkills.js";

describe("bundledSkillWrites", () => {
  it("ships the canonical workflow agent enablement skills", () => {
    const writes = bundledSkillWrites();
    expect(writes.map((w) => w.path)).toEqual([
      ".claude/skills/perspecta-workflow-overview/SKILL.md",
      ".claude/skills/perspecta-install-workflow/SKILL.md",
      ".claude/skills/perspecta-workflow-run/SKILL.md",
    ]);
    expect(writes[1].content).toContain("name: perspecta-install-workflow");
  });
});
