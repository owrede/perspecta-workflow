import { renderWorkflowSkill, readSkillFrontmatter } from "@perspecta/core";
import type { PflowWorkflowSummary } from "@perspecta/core";

export const SKILLS_DIR = ".claude/skills";

export interface SkillWrite { path: string; content: string; }
export interface SkillSyncPlan {
  writes: SkillWrite[];
  deletes: string[];
}

function skillPath(name: string): string {
  return `${SKILLS_DIR}/${name}/SKILL.md`;
}

/**
 * Pure sync plan for `.pflow` workflows.
 * @param summaries  one per discovered .pflow (via summarizePflowWorkflow)
 * @param existing   map of existing skill paths → file content (only SKILL.md files)
 *
 * No registry is emitted: discovery is by listing `_agents/*.pflow` plus the
 * per-workflow skills' descriptions (the old `_agents/workflows/INDEX.md` model
 * is gone).
 */
export function planWorkflowSkills(
  summaries: PflowWorkflowSummary[],
  existing: Record<string, string>,
): SkillSyncPlan {
  const writes: SkillWrite[] = summaries.map((s) => ({
    path: skillPath(s.name),
    content: renderWorkflowSkill(s),
  }));
  const wantedPaths = new Set(writes.map((w) => w.path));

  // Prune: only generated skills (perspecta_generated:true) whose path is no
  // longer wanted. Hand-authored skills are left untouched.
  const deletes: string[] = [];
  for (const [path, content] of Object.entries(existing)) {
    if (wantedPaths.has(path)) continue;
    const fm = readSkillFrontmatter(content);
    if (fm.perspecta_generated === "true") deletes.push(path);
  }

  return { writes, deletes };
}
