import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { parsePflow, type PflowDocument } from "@perspecta/core";
import Editor from "./editor.svelte";

export const VIEW_TYPE_PFLOW = "perspecta-pflow-editor";

export class PflowEditorView extends TextFileView {
  private current: PflowDocument | null = null;
  private svelteApp: ReturnType<typeof mount> | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE_PFLOW; }
  getDisplayText(): string { return this.file?.basename ?? "Workflow"; }
  getIcon(): string { return "git-fork"; }

  /** The current document, or null when no valid document is loaded. */
  getDocument(): PflowDocument | null { return this.current; }

  setViewData(data: string, clear: boolean): void {
    if (clear) this.clear();
    const trimmed = data.trim();
    if (trimmed.length === 0) { this.renderError("Empty .pflow file."); return; }
    let doc: PflowDocument;
    try {
      doc = parsePflow(data);
    } catch (err) {
      this.renderError(`Invalid .pflow file: ${(err as Error).message}`);
      return;
    }
    this.current = doc;
    this.renderEditor();
  }

  getViewData(): string {
    if (this.current) return JSON.stringify(this.current, null, 2);
    // Never return "" — that would let TextFileView overwrite the file with
    // empty content on the next autosave. Return the raw on-disk bytes.
    return this.data ?? "";
  }

  clear(): void {
    this.current = null;
    if (this.svelteApp) { void unmount(this.svelteApp); this.svelteApp = null; }
    this.contentEl.empty();
  }

  private renderError(message: string): void {
    if (this.svelteApp) { void unmount(this.svelteApp); this.svelteApp = null; }
    this.contentEl.empty();
    const box = this.contentEl.createDiv({ cls: "pflow-error" });
    box.createEl("strong", { text: "Cannot open workflow" });
    box.createEl("div", { text: message });
  }

  private renderEditor(): void {
    if (!this.current) return;
    if (this.svelteApp) { void unmount(this.svelteApp); this.svelteApp = null; }
    this.contentEl.empty();
    const host = this.contentEl.createDiv({ cls: "pflow-editor-host" });
    this.svelteApp = mount(Editor, {
      target: host,
      props: {
        file: this.current,
        onChange: (next: PflowDocument) => {
          this.current = next;
          this.requestSave();
        },
      },
    });
  }
}
