import { describe, it, expect } from "vitest";
import { WorkflowSkillSyncService, type VaultIO } from "../src/skills/WorkflowSkillSyncService.js";
import { SKILLS_DIR } from "../src/skills/syncWorkflowSkills.js";

/** In-memory VaultIO for testing the service without Obsidian. */
class FakeIO implements VaultIO {
  files = new Map<string, string>();
  dirs = new Set<string>();
  writes: string[] = [];

  async read(path: string): Promise<string> {
    if (!this.files.has(path)) throw new Error(`ENOENT: ${path}`);
    return this.files.get(path)!;
  }
  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    this.writes.push(path);
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path);
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    const folders = new Set<string>();
    const files: string[] = [];
    for (const key of this.files.keys()) {
      if (!key.startsWith(`${path}/`)) continue;
      const rest = key.slice(path.length + 1);
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(`${path}/${rest.slice(0, slash)}`);
      else files.push(key);
    }
    return { files, folders: [...folders] };
  }
}

function makeService(): { svc: WorkflowSkillSyncService; io: FakeIO; notices: string[] } {
  const io = new FakeIO();
  const notices: string[] = [];
  const svc = new WorkflowSkillSyncService(io, (m) => notices.push(m));
  return { svc, io, notices };
}

describe("WorkflowSkillSyncService.writeIfChanged", () => {
  it("writes when absent and creates parent dirs", async () => {
    const { svc, io } = makeService();
    const wrote = await svc.writeIfChanged(".claude/skills/x/SKILL.md", "hi");
    expect(wrote).toBe(true);
    expect(io.files.get(".claude/skills/x/SKILL.md")).toBe("hi");
    expect(io.dirs.has(".claude/skills/x")).toBe(true);
  });

  it("is a no-op when content is unchanged", async () => {
    const { svc, io } = makeService();
    await svc.writeIfChanged("a/b.md", "same");
    io.writes.length = 0;
    const wrote = await svc.writeIfChanged("a/b.md", "same");
    expect(wrote).toBe(false);
    expect(io.writes).toEqual([]);
  });
});

describe("WorkflowSkillSyncService.applySkillSyncPlan", () => {
  it("warns on duplicate skill paths instead of silently overwriting", async () => {
    const { svc, notices } = makeService();
    await svc.applySkillSyncPlan({
      writes: [
        { path: ".claude/skills/dup/SKILL.md", content: "a" },
        { path: ".claude/skills/dup/SKILL.md", content: "b" },
      ],
      deletes: [],
    });
    expect(notices.some((n) => n.includes("duplicate workflow name"))).toBe(true);
  });

  it("prunes orphaned skills listed in plan.deletes", async () => {
    const { svc, io } = makeService();
    io.files.set(".claude/skills/old/SKILL.md", "stale");
    await svc.applySkillSyncPlan({
      writes: [],
      deletes: [".claude/skills/old/SKILL.md"],
    });
    expect(io.files.has(".claude/skills/old/SKILL.md")).toBe(false);
  });

  it("writes no registry file (the INDEX.md model is gone)", async () => {
    const { svc, io } = makeService();
    await svc.applySkillSyncPlan({ writes: [], deletes: [] });
    expect(io.files.has("_agents/workflows/INDEX.md")).toBe(false);
  });
});

describe("WorkflowSkillSyncService.rebuildWorkflowSkills", () => {
  const PFLOW = JSON.stringify({
    pflowFormatVersion: 1,
    workflow: { name: "person-brief", description: "Brief a person." },
    nodes: [
      {
        id: "in", kind: "input", label: "In", inputs: [],
        outputs: [{ id: "out:person", name: "person", schema: { type: "string" }, required: true }],
      },
      { id: "end", kind: "output", label: "Out", inputs: [{ id: "in:x", name: "x", schema: { type: "any" } }], outputs: [] },
    ],
    wires: [],
  });

  it("generates one skill per .pflow with the .pflow source path and args", async () => {
    const { svc, io } = makeService();
    io.files.set("_agents/person-brief.pflow", PFLOW);
    const n = await svc.rebuildWorkflowSkills(["_agents/person-brief.pflow"]);
    expect(n).toBe(1);
    const skill = io.files.get(".claude/skills/person-brief/SKILL.md")!;
    expect(skill).toContain("perspecta_source: _agents/person-brief.pflow");
    expect(skill).toContain("`person` (string, required)");
    expect(io.files.has("_agents/workflows/INDEX.md")).toBe(false);
  });

  it("skips an unparseable .pflow with a notice instead of throwing", async () => {
    const { svc, io, notices } = makeService();
    io.files.set("_agents/broken.pflow", "{ not json");
    const n = await svc.rebuildWorkflowSkills(["_agents/broken.pflow"]);
    expect(n).toBe(0);
    expect(notices.some((m) => m.includes("broken.pflow"))).toBe(true);
  });
});

describe("WorkflowSkillSyncService.agentInstallStatus", () => {
  it("reports zero installed on an empty vault", async () => {
    const { svc } = makeService();
    const status = await svc.agentInstallStatus();
    expect(status.installedSkills).toBe(0);
    expect(status.hasPointer).toBe(false);
  });

  it("counts installed bundled + generic skills and detects the pointer", async () => {
    const { svc, io } = makeService();
    await svc.writeBundledSkills(); // installs the 3 bundled skills
    io.files.set(`${SKILLS_DIR}/perspecta-workflow/SKILL.md`, "generic");
    io.files.set("CLAUDE.md", "...perspecta-workflow:begin...");
    const status = await svc.agentInstallStatus();
    expect(status.installedSkills).toBe(4); // 3 bundled + 1 generic
    expect(status.hasPointer).toBe(true);
  });
});
