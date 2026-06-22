import { VERSION, renderGenericSkill, parsePflow, summarizePflowWorkflow, type PflowWorkflowSummary } from "@perspecta/core";
import { decideGenericSkill } from "./reconcileGenericSkill.js";
import { planWorkflowSkills, SKILLS_DIR, type SkillSyncPlan } from "./syncWorkflowSkills.js";
import { upsertPointerBlock } from "./claudePointer.js";
import { bundledSkillWrites } from "./bundledSkills.js";
import { ancestorDirs } from "../fs/paths.js";

/**
 * The vault file operations the skill installer needs. Satisfied by Obsidian's
 * `vault.adapter`; kept narrow so the service can be unit-tested with a fake.
 */
export interface VaultIO {
  read(path: string): Promise<string>;
  write(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
}

const POINTER_PATH = "CLAUDE.md";
const POINTER_MARKER = "perspecta-workflow:begin";

/**
 * Owns installing and reconciling Perspecta Workflow's agent files in a vault:
 * bundled static skills, the version-stamped generic skill, per-workflow
 * generated skills, the registry, and the CLAUDE.md pointer block.
 *
 * Extracted from the plugin entry file so the generated-skills/install logic
 * lives under src/skills/ (Suite Convention Catalog §8.3) and is testable
 * without Obsidian. UI feedback is delegated via `notify` so the service stays
 * framework-free.
 */
export class WorkflowSkillSyncService {
  constructor(
    private readonly io: VaultIO,
    private readonly notify: (message: string) => void,
  ) {}

  /** Create the parent directory chain for a vault-relative file path if missing. */
  async ensureParentDir(filePath: string): Promise<void> {
    for (const dir of ancestorDirs(filePath)) {
      if (!(await this.io.exists(dir))) {
        await this.io.mkdir(dir);
      }
    }
  }

  /** Write only if the file is absent or its content differs (avoids git churn). Returns true if written. */
  async writeIfChanged(path: string, content: string): Promise<boolean> {
    let current: string | null = null;
    try { current = await this.io.read(path); } catch { current = null; }
    if (current === content) return false;
    await this.ensureParentDir(path);
    await this.io.write(path, content);
    return true;
  }

  /** Reconcile the bundled, version-stamped generic skill (install/upgrade/never-downgrade). */
  async reconcileGenericSkill(): Promise<void> {
    const path = `${SKILLS_DIR}/perspecta-workflow/SKILL.md`;
    let installed: string | null = null;
    try { installed = await this.io.read(path); } catch { installed = null; }
    if (decideGenericSkill(installed, VERSION) === "skip") return;
    await this.ensureParentDir(path);
    await this.io.write(path, renderGenericSkill(VERSION));
  }

  /** Install/update static plugin-owned skills shipped with this plugin build. */
  async writeBundledSkills(): Promise<void> {
    for (const skill of bundledSkillWrites()) {
      await this.writeIfChanged(skill.path, skill.content);
    }
  }

  /** Build a summary for every `.pflow` document. Best-effort per file: a doc
   *  that fails to parse is skipped with a notice, not fatal. */
  async collectWorkflowSummaries(pflowPaths: string[]): Promise<PflowWorkflowSummary[]> {
    const summaries: PflowWorkflowSummary[] = [];
    for (const path of pflowPaths) {
      try {
        const doc = parsePflow(await this.io.read(path));
        summaries.push(summarizePflowWorkflow(path, doc));
      } catch (e) {
        this.notify(`Perspecta: skipped ${path} — ${(e as Error).message}`);
      }
    }
    return summaries;
  }

  /** Read every existing .claude/skills/<x>/SKILL.md into a path→content map. */
  async readExistingSkills(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    if (!(await this.io.exists(SKILLS_DIR))) return out;
    const listing = await this.io.list(SKILLS_DIR);
    for (const sub of listing.folders) {
      const skillFile = `${sub}/SKILL.md`;
      try {
        if (await this.io.exists(skillFile)) {
          out[skillFile] = await this.io.read(skillFile);
        }
      } catch { /* unreadable → ignore */ }
    }
    return out;
  }

  /** Apply a sync plan: write per-workflow skills, prune orphans, update pointer.
   *  No registry file is written (the INDEX.md model is gone). */
  async applySkillSyncPlan(plan: SkillSyncPlan): Promise<void> {
    // Guard against silent data loss: two .pflow docs declaring the same
    // workflow.name map to the same skill path. Warn rather than overwrite one
    // silently.
    const seen = new Set<string>();
    for (const w of plan.writes) {
      if (seen.has(w.path)) {
        this.notify(`Perspecta: duplicate workflow name → ${w.path} (one will be overwritten; rename a workflow)`);
        console.warn(`Perspecta: duplicate skill path in sync plan: ${w.path}`);
      }
      seen.add(w.path);
    }
    for (const w of plan.writes) {
      await this.writeIfChanged(w.path, w.content);
    }
    for (const d of plan.deletes) {
      try { await this.io.remove(d); } catch { /* already gone */ }
    }

    let existing = "";
    try { existing = await this.io.read(POINTER_PATH); } catch { existing = ""; }
    await this.writeIfChanged(POINTER_PATH, upsertPointerBlock(existing));
  }

  /** Full regenerate: scan .pflow docs → plan → apply. Best-effort; never throws. */
  async rebuildWorkflowSkills(pflowPaths: string[]): Promise<number> {
    try {
      const summaries = await this.collectWorkflowSummaries(pflowPaths);
      const existing = await this.readExistingSkills();
      await this.applySkillSyncPlan(planWorkflowSkills(summaries, existing));
      return summaries.length;
    } catch (e) {
      this.notify(`Perspecta: skill sync failed — ${(e as Error).message}`);
      return 0;
    }
  }

  /** User-facing install action for the settings Install tab. */
  async installAgentSkills(pflowPaths: string[]): Promise<number> {
    await this.writeBundledSkills();
    await this.reconcileGenericSkill();
    return this.rebuildWorkflowSkills(pflowPaths);
  }

  async agentInstallStatus(): Promise<{ installedSkills: number; hasPointer: boolean }> {
    let installedSkills = 0;
    for (const skill of bundledSkillWrites()) {
      if (await this.io.exists(skill.path)) installedSkills += 1;
    }
    if (await this.io.exists(`${SKILLS_DIR}/perspecta-workflow/SKILL.md`)) {
      installedSkills += 1;
    }
    let hasPointer = false;
    try {
      hasPointer = (await this.io.read(POINTER_PATH)).includes(POINTER_MARKER);
    } catch { hasPointer = false; }
    return { installedSkills, hasPointer };
  }
}
