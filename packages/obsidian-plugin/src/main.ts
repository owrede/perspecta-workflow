import { Plugin, Notice, WorkspaceLeaf } from "obsidian";
import { VERSION } from "@perspecta/core";
import { ResultsView, VIEW_TYPE_PERSPECTA } from "./view/ResultsView.js";
import { runValidation } from "./commands/validate.js";

export default class PerspectaWorkflowPlugin extends Plugin {
  async onload() {
    console.log(`Perspecta Workflow plugin v${VERSION} loaded`);

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
