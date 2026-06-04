import { compareSemver, readSkillFrontmatter } from "@perspecta/core";

export type GenericSkillDecision = "write" | "skip";

/**
 * Decide whether to (over)write the generic skill.
 * - installed === null  → "write" (install)
 * - no/garbage version stamp → "write" (self-heal a corrupted stamp)
 * - installed < bundled → "write" (upgrade)
 * - installed >= bundled → "skip" (equal = no-op; newer = never downgrade)
 */
export function decideGenericSkill(installed: string | null, bundledVersion: string): GenericSkillDecision {
  if (installed === null) return "write";
  const stamp = readSkillFrontmatter(installed).perspecta_version;
  if (!stamp) return "write";
  return compareSemver(stamp, bundledVersion) < 0 ? "write" : "skip";
}
