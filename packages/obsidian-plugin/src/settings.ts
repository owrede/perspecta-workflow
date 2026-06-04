import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {
  PerspectaSettingsStore,
  renderSettingsShell,
  renderInstallSection,
  renderInfoBox,
  wiredText,
  wiredToggle,
} from "perspecta-ui";
import type PerspectaWorkflowPlugin from "./main.js";
import { bundledSkillWrites } from "./skills/bundledSkills.js";
import { CHANGELOG } from "./changelog.generated.js";

export interface PerspectaSettings {
  nodeFolder: string;
  autoColor: boolean;
}

export const DEFAULT_SETTINGS: PerspectaSettings = {
  nodeFolder: "workflows",
  autoColor: true,
};

export class PerspectaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PerspectaWorkflowPlugin) {
    super(app, plugin);
  }

  display(): void {
    const store = this.plugin.settingsStore;
    renderSettingsShell(this.containerEl, {
      plugin: this.plugin,
      displayName: "Perspecta Workflow",
      changelog: CHANGELOG,
      defaultTab: "general",
      tabs: [
        {
          id: "general",
          label: "General",
          render: (el) => {
            wiredText(new Setting(el), store, {
              key: "nodeFolder",
              name: "Node note folder",
              desc: "Where inserted WorkflowNode notes are created.",
            });
            wiredToggle(new Setting(el), store, {
              key: "autoColor",
              name: "Auto-color workflow nodes",
              desc: "Automatically color nodes by type when a workflow canvas opens or changes.",
            });
          },
        },
        {
          id: "install",
          label: "Install",
          render: (el) => {
            // Bundled static skills plus the generated generic workflow skill.
            const total = bundledSkillWrites().length + 1;
            renderInstallSection<number>(el, {
              body: "Install or update the skills and workflow index that let agents discover and run Perspecta workflows in this vault.",
              settingDesc: "Writes plugin-owned skills to .claude/skills, rebuilds _agents/workflows/INDEX.md, and updates the vault CLAUDE.md pointer block.",
              status: async () => {
                const s = await this.plugin.agentInstallStatus();
                return `Installed skills: ${s.installedSkills}/${total}. Registry: ${s.hasRegistry ? "yes" : "no"}. CLAUDE.md pointer: ${s.hasPointer ? "yes" : "no"}.`;
              },
              install: () => this.plugin.installAgentSkills(),
              onInstalled: (count) => {
                new Notice(`Perspecta Workflow: installed agent skills and indexed ${count} workflow${count === 1 ? "" : "s"}`);
              },
              onError: (err) => new Notice(`Perspecta Workflow: install failed - ${(err as Error).message}`),
            });
          },
        },
      ],
      debugTab: {
        render: (el) => {
          renderInfoBox(el, {
            variant: "info",
            title: "Diagnostics",
            body: `Auto-color is ${store.get("autoColor") ? "on" : "off"}. Node folder: ${store.get("nodeFolder")}.`,
          });
        },
      },
    });
  }
}
