import { TextFileView, type WorkspaceLeaf } from "obsidian";
import { mount, unmount } from "svelte";
import { parsePflow, type PflowDocument } from "@perspecta/core";
import { dedupeDuplicateNamedPorts, applyMcpExpectedGrants } from "./flow-map.js";
import { exportClaudeCodeWorkflowFile } from "../../commands/exportWorkflow.js";
import Editor from "./editor.svelte";
import type PerspectaWorkflowPlugin from "../../main.js";

export const VIEW_TYPE_PFLOW = "perspecta-pflow-editor";

export class PflowEditorView extends TextFileView {
  private current: PflowDocument | null = null;
  private svelteApp: ReturnType<typeof mount> | null = null;

  constructor(leaf: WorkspaceLeaf, private plugin: PerspectaWorkflowPlugin) {
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
    // Self-heal a legacy duplicate-port corruption (a non-structural port whose
    // name collides with a structural one, e.g. a loop's `out:fix` beside its
    // structural `fix`). Returns the same object when there's nothing to fix, so
    // a clean file is untouched and won't be needlessly rewritten on autosave.
    doc = dedupeDuplicateNamedPorts(doc);
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
        app: this.app,
        onChange: (next: PflowDocument) => {
          this.current = next;
          this.requestSave();
        },
        // The inspector's Export button calls this with the live document. We own
        // vault access, so we do the write here and return a human string (or let the
        // codegen error propagate so the inspector can show it).
        onExport: async (doc: PflowDocument) => {
          // Stamp the policy snapshot each mcp node was exported against (drives
          // the import-warning), persist it, then write the artifacts.
          const stamped = applyMcpExpectedGrants(doc, this.plugin.settings.mcpRegistry);
          this.current = stamped;
          this.requestSave();
          const res = await exportClaudeCodeWorkflowFile(this.app.vault.adapter, stamped, this.plugin.settings.mcpRegistry);
          const extra = res.subagentPaths.length ? ` + ${res.subagentPaths.length} connector agent${res.subagentPaths.length === 1 ? "" : "s"}` : "";
          return `${res.workflowPath}${extra}`;
        },
        // NOTE (v1): snapshot of the registry at mount. If the user probes a
        // server or changes permissions in Settings while this editor is open,
        // the picker/grant-summary won't refresh until the file is reopened.
        registry: this.plugin.settings.mcpRegistry,
      },
    });
  }
}
