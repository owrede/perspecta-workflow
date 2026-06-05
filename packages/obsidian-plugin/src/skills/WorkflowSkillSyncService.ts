import { VERSION, renderGenericSkill, summarizeWorkflow, isWorkflowCanvas, type WorkflowSummary } from "@perspecta/core";
import { decideGenericSkill } from "./reconcileGenericSkill.js";
import { planWorkflowSkills, SKILLS_DIR, REGISTRY_PATH, type SkillSyncPlan } from "./syncWorkflowSkills.js";
import { upsertPointerBlock } from "./claudePointer.js";
import { bundledSkillWrites } from "./bundledSkills.js";
import { ObsidianFileSystem } from "../fs/ObsidianFileSystem.js";
import { ancestorDirs } from "../fs/paths.js";
import { preloadCanvas } from "../fs/preload.js";

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

  private async isMarkedCanvas(path: string): Promise<boolean> {
    try {
      return isWorkflowCanvas(JSON.parse(await this.io.read(path)));
    } catch { return false; }
  }

  private reader() {
    return {
      read: (p: string) => this.io.read(p),
      exists: (p: string) => this.io.exists(p),
    };
  }

  /** Build a summary for every marked canvas. Best-effort per canvas. */
  async collectWorkflowSummaries(canvasPaths: string[]): Promise<WorkflowSummary[]> {
    const summaries: WorkflowSummary[] = [];
    for (const path of canvasPaths) {
      try {
        if (!(await this.isMarkedCanvas(path))) continue;
        const { map } = await preloadCanvas(path, this.reader());
        summaries.push(summarizeWorkflow(path, new ObsidianFileSystem(map)));
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

  /** Apply a sync plan: write per-workflow skills, prune orphans, write registry + pointer. */
  async applySkillSyncPlan(plan: SkillSyncPlan): Promise<void> {
    // Guard against silent data loss: two canvases with the same filename map to
    // the same skill path. Warn rather than overwrite one silently.
    const seen = new Set<string>();
    for (const w of plan.writes) {
      if (seen.has(w.path)) {
        this.notify(`Perspecta: duplicate workflow name → ${w.path} (one will be overwritten; rename a canvas)`);
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
    await this.writeIfChanged(plan.registryPath, plan.registryContent);

    let existing = "";
    try { existing = await this.io.read(POINTER_PATH); } catch { existing = ""; }
    await this.writeIfChanged(POINTER_PATH, upsertPointerBlock(existing));
  }

  /** Full regenerate: scan canvases → plan → apply. Best-effort; never throws. */
  async rebuildWorkflowSkills(canvasPaths: string[]): Promise<number> {
    try {
      const summaries = await this.collectWorkflowSummaries(canvasPaths);
      const existing = await this.readExistingSkills();
      await this.applySkillSyncPlan(planWorkflowSkills(summaries, existing));
      return summaries.length;
    } catch (e) {
      this.notify(`Perspecta: skill sync failed — ${(e as Error).message}`);
      return 0;
    }
  }

  /** User-facing install action for the settings Install tab. */
  async installAgentSkills(canvasPaths: string[]): Promise<number> {
    await this.writeBundledSkills();
    await this.reconcileGenericSkill();
    return this.rebuildWorkflowSkills(canvasPaths);
  }

  async agentInstallStatus(): Promise<{ installedSkills: number; hasRegistry: boolean; hasPointer: boolean }> {
    let installedSkills = 0;
    for (const skill of bundledSkillWrites()) {
      if (await this.io.exists(skill.path)) installedSkills += 1;
    }
    if (await this.io.exists(`${SKILLS_DIR}/perspecta-workflow/SKILL.md`)) {
      installedSkills += 1;
    }
    const hasRegistry = await this.io.exists(REGISTRY_PATH);
    let hasPointer = false;
    try {
      hasPointer = (await this.io.read(POINTER_PATH)).includes(POINTER_MARKER);
    } catch { hasPointer = false; }
    return { installedSkills, hasRegistry, hasPointer };
  }
}
