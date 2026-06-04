import { App, PluginSettingTab, Setting } from "obsidian";
import {
  PerspectaSettingsStore,
  renderSettingsShell,
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
