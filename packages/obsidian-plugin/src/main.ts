import { App, Plugin, Notice, WorkspaceLeaf, SuggestModal, TFile } from "obsidian";
import { VERSION, isWorkflowCanvas, type NodeType } from "@perspecta/core";
import { ResultsView, VIEW_TYPE_PERSPECTA } from "./view/ResultsView.js";
import { runValidation } from "./commands/validate.js";
import { computeRecoloredCanvas } from "./commands/autocolor.js";
import { stampCanvasJson } from "./commands/convertToWorkflow.js";
import { setNodeTypeInFrontmatter, noteFilePathForNode, NODE_TYPE_OPTIONS, type NodeTypeOption } from "./commands/setNodeType.js";
import { ColorWatcher } from "./live/colorWatcher.js";
import { WorkflowBadge } from "./live/badge.js";
import { attachNodeMenu } from "./live/nodeMenu.js";
import { PerspectaSettingTab, DEFAULT_SETTINGS, type PerspectaSettings } from "./settings.js";
import { buildNodeNote, addFileNodeToCanvas } from "./commands/insertNode.js";

interface NoteFileRef { id: string; file: string; }

export default class PerspectaWorkflowPlugin extends Plugin {
  settings: PerspectaSettings = DEFAULT_SETTINGS;
  private watcher!: ColorWatcher;
  private statusEl: HTMLElement | null = null;
  private menuDisposers = new Map<WorkspaceLeaf, () => void>();

  async loadSettings() { this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData()); }
  async saveSettings() { await this.saveData(this.settings); }

  // ---- shared helpers ------------------------------------------------------

  private vaultReader() {
    return {
      read: (p: string) => this.app.vault.adapter.read(p),
      exists: (_p: string) => true,
    };
  }

  /** Read a canvas file and report whether it carries the workflow marker. */
  private async isMarkedCanvas(path: string): Promise<boolean> {
    try {
      const text = await this.app.vault.adapter.read(path);
      return isWorkflowCanvas(JSON.parse(text));
    } catch { return false; }
  }

  /** Recolor a canvas if marked; write back; tell the watcher we self-wrote. Returns written content or null. */
  private async recolorCanvas(path: string): Promise<string | null> {
    const out = await computeRecoloredCanvas(path, this.vaultReader());
    if (out == null) return null;
    this.watcher.onSelfWrite(path);
    await this.app.vault.adapter.write(path, out);
    return out;
  }

  private activeCanvas(): TFile | null {
    const f = this.app.workspace.getActiveFile();
    return f && f.extension === "canvas" ? f : null;
  }

  /** Resolve a canvas node id → its .md node-note path, via an explicit canvas file JSON. */
  private async resolveNotePathInCanvas(canvasPath: string, nodeId: string): Promise<string | null> {
    try {
      return noteFilePathForNode(await this.app.vault.adapter.read(canvasPath), nodeId);
    } catch { return null; }
  }

  /** Write node_type into a node-note (frontmatter-preserving) and recolor the given canvas. */
  private async applyNodeType(notePath: string, nodeType: NodeType, canvasPath?: string): Promise<void> {
    const noteText = await this.app.vault.adapter.read(notePath);
    await this.app.vault.adapter.write(notePath, setNodeTypeInFrontmatter(noteText, nodeType));
    const path = canvasPath ?? this.activeCanvas()?.path;
    if (path && this.settings.autoColor) this.watcher.onCanvasTouched(path);
    new Notice(`Perspecta: node_type set to ${nodeType}`);
  }

  // ---- badge + status + node menu -----------------------------------------

  private async refreshBadge(): Promise<void> {
    const leaf = this.app.workspace.getMostRecentLeaf();
    const file = this.activeCanvas();
    const marked = file ? await this.isMarkedCanvas(file.path) : false;
    // overlay (best-effort)
    this.app.workspace.iterateAllLeaves((l) => WorkflowBadge.detach(l));
    if (marked && leaf) WorkflowBadge.attach(leaf);
    // status-bar fallback (always reliable)
    if (this.statusEl) this.statusEl.setText(marked ? "⬡ Workflow" : "");
    // right-click "Set node type" menu on workflow canvases (best-effort)
    this.refreshNodeMenu(leaf, marked);
  }

  /** Get the canvas file path bound to a specific leaf (NOT the global active file). */
  private canvasPathForLeaf(leaf: WorkspaceLeaf): string | null {
    const f = (leaf.view as unknown as { file?: { path?: string; extension?: string } }).file;
    if (f && typeof f.path === "string" && f.path.endsWith(".canvas")) return f.path;
    return null;
  }

  /** Attach the node context menu on a marked canvas leaf; detach elsewhere. */
  private refreshNodeMenu(leaf: WorkspaceLeaf | null, marked: boolean): void {
    // detach disposers for leaves that are gone or no longer the active marked canvas
    for (const [l, dispose] of this.menuDisposers) {
      if (l !== leaf || !marked) { dispose(); this.menuDisposers.delete(l); }
    }
    if (!marked || !leaf || this.menuDisposers.has(leaf)) return;
    const dispose = attachNodeMenu(leaf, {
      // Bind to THIS leaf's canvas file, not getActiveFile() (which can return
      // the embedded node-note when a node is selected).
      resolveNotePath: async (l, nodeId) => {
        const path = this.canvasPathForLeaf(l);
        return path ? this.resolveNotePathInCanvas(path, nodeId) : null;
      },
      applyNodeType: (notePath, nodeType) => this.applyNodeType(notePath, nodeType, this.canvasPathForLeaf(leaf) ?? undefined),
    });
    this.menuDisposers.set(leaf, dispose);
  }

  async onload() {
    console.log(`Perspecta Workflow plugin v${VERSION} loaded`);

    await this.loadSettings();
    this.addSettingTab(new PerspectaSettingTab(this.app, this));
    this.registerView(VIEW_TYPE_PERSPECTA, (leaf: WorkspaceLeaf) => new ResultsView(leaf));

    this.statusEl = this.addStatusBarItem();

    this.watcher = new ColorWatcher({
      debounceMs: 400,
      isMarked: (p) => this.isMarkedCanvas(p),
      recolor: (p) => this.recolorCanvas(p),
      schedule: (fn, ms) => window.setTimeout(fn, ms),
      clearScheduled: (id) => window.clearTimeout(id as number),
    });

    // ---- events ----
    this.registerEvent(this.app.workspace.on("file-open", async (file) => {
      await this.refreshBadge();
      if (this.settings.autoColor && file && file.extension === "canvas") {
        this.watcher.onCanvasTouched(file.path);
      }
    }));
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => { void this.refreshBadge(); }));
    this.registerEvent(this.app.vault.on("modify", (file) => {
      if (!this.settings.autoColor || !(file instanceof TFile)) return;
      if (file.extension === "canvas") {
        this.watcher.onCanvasTouched(file.path);
      } else if (file.extension === "md") {
        // a node-note changed: recolor the active canvas if it's a workflow
        const canvas = this.activeCanvas();
        if (canvas) this.watcher.onCanvasTouched(canvas.path);
      }
    }));

    // ---- commands ----
    this.addCommand({
      id: "use-canvas-as-workflow",
      name: "Use canvas as workflow",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Open a canvas first"); return; }
        try {
          const json = await this.app.vault.adapter.read(file.path);
          const out = stampCanvasJson(json);
          if (out == null) { new Notice("Already a workflow canvas"); return; }
          this.watcher.onSelfWrite(file.path);
          await this.app.vault.adapter.write(file.path, out);
          await this.refreshBadge();
          if (this.settings.autoColor) this.watcher.onCanvasTouched(file.path);
          new Notice("Perspecta: canvas marked as workflow");
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "validate-workflow-canvas",
      name: "Validate workflow canvas",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Not a workflow canvas"); return; }
        if (!(await this.isMarkedCanvas(file.path))) { new Notice("Not a workflow canvas. Run 'Use canvas as workflow' first."); return; }
        try {
          const result = await runValidation(file.path, this.vaultReader());
          await this.revealResults();
          const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA)[0]?.view as ResultsView;
          view?.setResult(result);
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "apply-node-colors",
      name: "Apply node colors",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Not a workflow canvas"); return; }
        if (!(await this.isMarkedCanvas(file.path))) { new Notice("Not a workflow canvas. Run 'Use canvas as workflow' first."); return; }
        try {
          const out = await this.recolorCanvas(file.path);
          new Notice(out == null ? "Colors already up to date" : "Perspecta: node colors applied");
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "set-node-type",
      name: "Set node type",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Not a workflow canvas"); return; }
        if (!(await this.isMarkedCanvas(file.path))) { new Notice("Not a workflow canvas. Run 'Use canvas as workflow' first."); return; }
        try {
          const canvasJson = JSON.parse(await this.app.vault.adapter.read(file.path));
          const noteFiles: NoteFileRef[] = (canvasJson.nodes ?? [])
            .filter((n: { type?: string; file?: string }) => n.type === "file" && typeof n.file === "string" && n.file.endsWith(".md"))
            .map((n: { id: string; file: string }) => ({ id: n.id, file: n.file }));
          if (noteFiles.length === 0) { new Notice("No node-notes on this canvas"); return; }
          const targetFile = await this.chooseNoteFile(noteFiles);
          if (!targetFile) return;
          const nodeType = await this.chooseNodeType();
          if (!nodeType) return;
          await this.applyNodeType(targetFile, nodeType);
        } catch (e) { new Notice(`Perspecta: ${(e as Error).message}`); }
      },
    });

    this.addCommand({
      id: "insert-prompt-node",
      name: "Insert prompt node",
      callback: async () => {
        const file = this.activeCanvas();
        if (!file) { new Notice("Open a workflow canvas first"); return; }
        const id = `n${Date.now()}`;
        const notePath = `${this.settings.nodeFolder}/${id}.md`;
        await this.app.vault.adapter.write(notePath, buildNodeNote("prompt"));
        let canvasJson = await this.app.vault.adapter.read(file.path);
        // inserting a node implies workflow intent: stamp the marker if missing
        const stamped = stampCanvasJson(canvasJson);
        if (stamped != null) canvasJson = stamped;
        this.watcher.onSelfWrite(file.path);
        await this.app.vault.adapter.write(file.path, addFileNodeToCanvas(canvasJson, notePath, id));
        await this.refreshBadge();
        if (this.settings.autoColor) this.watcher.onCanvasTouched(file.path);
        new Notice("Perspecta: prompt node inserted");
      },
    });

    // initial badge for whatever is open at load
    this.app.workspace.onLayoutReady(() => { void this.refreshBadge(); });
  }

  // ---- choosers ------------------------------------------------------------

  private chooseNodeType(): Promise<NodeType | null> {
    return new Promise((resolve) => {
      new NodeTypeModal(this.app, NODE_TYPE_OPTIONS, (opt) => resolve(opt ? opt.type : null)).open();
    });
  }

  private chooseNoteFile(files: NoteFileRef[]): Promise<string | null> {
    if (files.length === 1) return Promise.resolve(files[0].file);
    return new Promise((resolve) => {
      new NoteFileModal(this.app, files, (f) => resolve(f ? f.file : null)).open();
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
    for (const dispose of this.menuDisposers.values()) dispose();
    this.menuDisposers.clear();
    this.app.workspace.iterateAllLeaves((l) => WorkflowBadge.detach(l));
    this.app.workspace.getLeavesOfType(VIEW_TYPE_PERSPECTA).forEach((l) => l.detach());
  }
}

class NodeTypeModal extends SuggestModal<NodeTypeOption> {
  private chosen = false;
  constructor(app: App, private options: NodeTypeOption[], private onChoose: (o: NodeTypeOption | null) => void) {
    super(app);
    this.setPlaceholder("Pick a node type…");
  }
  getSuggestions(query: string): NodeTypeOption[] {
    const q = query.toLowerCase();
    return this.options.filter((o) => o.type.includes(q) || o.description.toLowerCase().includes(q));
  }
  renderSuggestion(o: NodeTypeOption, el: HTMLElement) {
    el.createDiv({ text: o.type, cls: "perspecta-finding-rule" });
    el.createDiv({ text: o.description });
  }
  onChooseSuggestion(o: NodeTypeOption) { this.chosen = true; this.onChoose(o); }
  onClose() { if (!this.chosen) this.onChoose(null); }
}

class NoteFileModal extends SuggestModal<NoteFileRef> {
  private chosen = false;
  constructor(app: App, private files: NoteFileRef[], private onChoose: (f: NoteFileRef | null) => void) {
    super(app);
    this.setPlaceholder("Which node?");
  }
  getSuggestions(query: string): NoteFileRef[] {
    const q = query.toLowerCase();
    return this.files.filter((f) => f.file.toLowerCase().includes(q) || f.id.toLowerCase().includes(q));
  }
  renderSuggestion(f: NoteFileRef, el: HTMLElement) {
    el.createDiv({ text: f.file });
  }
  onChooseSuggestion(f: NoteFileRef) { this.chosen = true; this.onChoose(f); }
  onClose() { if (!this.chosen) this.onChoose(null); }
}
