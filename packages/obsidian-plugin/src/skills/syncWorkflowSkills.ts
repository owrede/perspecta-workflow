import { renderWorkflowSkill, renderRegistry, readSkillFrontmatter } from "@perspecta/core";
import type { WorkflowSummary } from "@perspecta/core";

export const SKILLS_DIR = ".claude/skills";
export const REGISTRY_PATH = "_agents/workflows/INDEX.md";

export interface SkillWrite { path: string; content: string; }
export interface SkillSyncPlan {
  writes: SkillWrite[];
  deletes: string[];
  registryPath: string;
  registryContent: string;
}

function skillPath(name: string): string {
  return `${SKILLS_DIR}/${name}/SKILL.md`;
}

/**
 * Pure sync plan.
 * @param summaries  one per marked canvas (already extracted via summarizeWorkflow)
 * @param existing   map of existing skill paths → file content (only SKILL.md files)
 */
export function planWorkflowSkills(
  summaries: WorkflowSummary[],
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

  return {
    writes,
    deletes,
    registryPath: REGISTRY_PATH,
    registryContent: renderRegistry(summaries),
  };
}
