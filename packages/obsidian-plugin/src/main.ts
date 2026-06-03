import { Plugin, Notice, WorkspaceLeaf } from "obsidian";
import { VERSION } from "@perspecta/core";
import { ResultsView, VIEW_TYPE_PERSPECTA } from "./view/ResultsView.js";
import { runValidation } from "./commands/validate.js";
import { PerspectaSettingTab, DEFAULT_SETTINGS, type PerspectaSettings } from "./settings.js";
import { buildNodeNote, addFileNodeToCanvas } from "./commands/insertNode.js";

export default class PerspectaWorkflowPlugin extends Plugin {
  settings: PerspectaSettings = DEFAULT_SETTINGS;

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  async onload() {
    console.log(`Perspecta Workflow plugin v${VERSION} loaded`);

    await this.loadSettings();
    this.addSettingTab(new PerspectaSettingTab(this.app, this));

    this.registerView(VIEW_TYPE_PERSPECTA, (leaf: WorkspaceLeaf) => new ResultsView(leaf));

    this.addCommand({
      id: "validate-workflow-canvas",
      name: "Validate workflow canvas",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "canvas") { new Notice("Not a workflow canvas"); return; }
        try {
          const result = await runValidation(file.path, {
            read: (p: string) => this.app.vault.adapter.read(p),
            exists: (_p: string) => true,
          });
          await this.revealResults();
          const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA)[0]?.view as ResultsView;
          view?.setResult(result);
        } catch (e) {
          new Notice(`Perspecta: ${(e as Error).message}`);
        }
      },
    });

    this.addCommand({
      id: "apply-node-colors",
      name: "Apply node colors",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "canvas") { new Notice("Not a workflow canvas"); return; }
        try {
          const { computeRecoloredCanvas } = await import("./commands/autocolor.js");
          const out = await computeRecoloredCanvas(file.path, {
            read: (p: string) => this.app.vault.adapter.read(p),
            exists: (_p: string) => true,
          });
          if (out == null) { new Notice("Colors already up to date"); return; }
          await this.app.vault.adapter.write(file.path, out);
          new Notice("Perspecta: node colors applied");
        } catch (e) {
          new Notice(`Perspecta: ${(e as Error).message}`);
        }
      },
    });

    this.addCommand({
      id: "insert-prompt-node",
      name: "Insert prompt node",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "canvas") { new Notice("Open a workflow canvas first"); return; }
        const id = `n${Date.now()}`;
        const notePath = `${this.settings.nodeFolder}/${id}.md`;
        await this.app.vault.adapter.write(notePath, buildNodeNote("prompt"));
        const canvasJson = await this.app.vault.adapter.read(file.path);
        await this.app.vault.adapter.write(file.path, addFileNodeToCanvas(canvasJson, notePath, id));
        new Notice("Perspecta: prompt node inserted");
      },
    });
  }

  private async revealResults() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA);
    if (existing.length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      await leaf?.setViewState({ type: VIEW_TYPE_PERSPECTA, active: true });
    }
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA)[0];
    if (leaf) this.app.workspace.revealLeaf(leaf);
  }

  onunload() {
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA).forEach((l) => l.detach());
  }
}
