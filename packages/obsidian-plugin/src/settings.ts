import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import {
  PerspectaSettingsStore,
  renderSettingsShell,
  wireAsyncButton,
  wiredText,
  wiredToggle,
  renderInfoBox,
  type ChangelogModel,
} from "perspecta-ui";
import type PerspectaWorkflowPlugin from "./main.js";

export interface PerspectaSettings {
  nodeFolder: string;
  autoColor: boolean;
}

export const DEFAULT_SETTINGS: PerspectaSettings = {
  nodeFolder: "workflows",
  autoColor: true,
};

// Inline changelog model for the settings Changelog tab. Keep newest first.
const CHANGELOG: ChangelogModel = [
  {
    version: "0.1.0",
    date: "2026-06-04",
    changes: [
      "Settings UI rebuilt on the shared perspecta-ui component library.",
      "Workflow identity marker, auto-color, set-node-type, formatter/config nodes.",
    ],
  },
];

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
            renderInfoBox(el, {
              variant: "info",
              title: "Agent skills",
              body: "Install or update the skills and workflow index that let agents discover and run Perspecta workflows in this vault.",
            });
            const status = el.createDiv({ cls: "perspecta-workflow-install-status" });
            status.setText("Checking install status...");
            void this.plugin.agentInstallStatus().then((s) => {
              status.setText(`Installed skills: ${s.installedSkills}/4. Registry: ${s.hasRegistry ? "yes" : "no"}. CLAUDE.md pointer: ${s.hasPointer ? "yes" : "no"}.`);
            });
            new Setting(el)
              .setName("Agent skills")
              .setDesc("Writes plugin-owned skills to .claude/skills, rebuilds _agents/workflows/INDEX.md, and updates the vault CLAUDE.md pointer block.")
              .addButton((button) => {
                wireAsyncButton(button, {
                  label: "Install / Update agent skills",
                  runningLabel: "Installing...",
                  cta: true,
                  onClick: async () => {
                    const count = await this.plugin.installAgentSkills();
                    const s = await this.plugin.agentInstallStatus();
                    status.setText(`Installed skills: ${s.installedSkills}/4. Registry: ${s.hasRegistry ? "yes" : "no"}. CLAUDE.md pointer: ${s.hasPointer ? "yes" : "no"}.`);
                    new Notice(`Perspecta Workflow: installed agent skills and indexed ${count} workflow${count === 1 ? "" : "s"}`);
                  },
                  onError: (err) => new Notice(`Perspecta Workflow: install failed - ${(err as Error).message}`),
                });
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
