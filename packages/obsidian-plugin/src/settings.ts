import { App, PluginSettingTab, Setting } from "obsidian";
import type PerspectaWorkflowPlugin from "./main.js";

export interface PerspectaSettings {
  nodeFolder: string;
  autoColor: boolean;
}

export const DEFAULT_SETTINGS: PerspectaSettings = {
  nodeFolder: "workflows",
  autoColor: true,
};

export class PerspectaSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: PerspectaWorkflowPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName("Node note folder")
      .setDesc("Where inserted WorkflowNode notes are created.")
      .addText((t) => t.setValue(this.plugin.settings.nodeFolder).onChange(async (v) => { this.plugin.settings.nodeFolder = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName("Auto-color workflow nodes")
      .setDesc("Automatically color nodes by type when a workflow canvas opens or changes.")
      .addToggle((t) => t.setValue(this.plugin.settings.autoColor).onChange(async (v) => { this.plugin.settings.autoColor = v; await this.plugin.saveSettings(); }));
  }
}
