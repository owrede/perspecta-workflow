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

  it("writes each skill under .claude/skills in a folder matching its name", () => {
    for (const write of bundledSkillWrites()) {
      const match = write.path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/);
      expect(match, `unexpected skill path: ${write.path}`).not.toBeNull();
      const folder = match![1];
      const nameLine = write.content.match(/^name:\s*(.+)$/m);
      expect(nameLine, `no name in ${write.path}`).not.toBeNull();
      expect(nameLine![1].trim()).toBe(folder);
    }
  });

  it("gives every skill a trigger-rich, perspecta-namespaced identity", () => {
    for (const write of bundledSkillWrites()) {
      const nameLine = write.content.match(/^name:\s*(.+)$/m);
      const descLine = write.content.match(/^description:\s*(.+)$/m);
      expect(nameLine![1].trim()).toMatch(/^perspecta-/);
      expect(descLine, `no description in ${write.path}`).not.toBeNull();
      expect(descLine![1]).toMatch(/Use when/i);
    }
  });
});
