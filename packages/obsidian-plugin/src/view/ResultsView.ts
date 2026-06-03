import { ItemView, WorkspaceLeaf } from "obsidian";
import type { LintResult } from "@perspecta/core";

export const VIEW_TYPE_PERSPECTA = "perspecta-results";

export class ResultsView extends ItemView {
  private result: LintResult | null = null;

  constructor(leaf: WorkspaceLeaf) { super(leaf); }
  getViewType() { return VIEW_TYPE_PERSPECTA; }
  getDisplayText() { return "Perspecta Workflow"; }
  getIcon() { return "checkmark"; }

  setResult(result: LintResult, onClickNode?: (nodeId: string) => void) {
    this.result = result;
    this.render(onClickNode);
  }

  async onOpen() { this.render(); }

  private render(onClickNode?: (nodeId: string) => void) {
    const c = this.contentEl;
    c.empty();
    if (!this.result) {
      c.createDiv({ cls: "perspecta-results-empty", text: "Run “Validate workflow canvas”." });
      return;
    }
    if (this.result.ok) {
      c.createDiv({ cls: "perspecta-finding-ok", text: "✓ Valid workflow." });
      return;
    }
    for (const f of this.result.errors) {
      const el = c.createDiv({ cls: "perspecta-finding" });
      el.createSpan({ cls: "perspecta-finding-rule", text: f.rule });
      el.createSpan({ text: ` — ${f.message}` });
      if (f.nodeId && onClickNode) {
        el.onClickEvent(() => onClickNode(f.nodeId!));
      }
    }
  }
}
