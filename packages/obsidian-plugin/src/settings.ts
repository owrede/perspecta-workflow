import { App, PluginSettingTab, Setting } from "obsidian";
import type PerspectaWorkflowPlugin from "./main.js";

export interface PerspectaSettings {
  nodeFolder: string;
  autoColorOnSave: boolean;
  liveValidation: boolean;
}

export const DEFAULT_SETTINGS: PerspectaSettings = {
  nodeFolder: "workflows",
  autoColorOnSave: false,
  liveValidation: false,
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
      .setName("Auto-color on save")
      .addToggle((t) => t.setValue(this.plugin.settings.autoColorOnSave).onChange(async (v) => { this.plugin.settings.autoColorOnSave = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl)
      .setName("Live validation")
      .addToggle((t) => t.setValue(this.plugin.settings.liveValidation).onChange(async (v) => { this.plugin.settings.liveValidation = v; await this.plugin.saveSettings(); }));
  }
}
