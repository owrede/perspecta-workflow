# MCP "Copy setup prompt" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Install-tab "Copy setup prompt" button that copies a natural-language prompt to register the bundled perspecta-workflow MCP server in a coding agent's `.mcp.json`.

**Architecture:** A new esbuild build bundles the mcp-server into a self-contained `mcp-server.mjs` inside the plugin folder. A pure helper builds the natural-language prompt from an absolute server path. The Install-tab UI resolves that path via `FileSystemAdapter.getFullPath(manifest.dir + "/" + artifact)` (OS-native separators on every platform), guards against a missing artifact, and copies the prompt. The manifest is flipped to `isDesktopOnly: true` with `minAppVersion` 1.7.2.

**Tech Stack:** TypeScript, esbuild, Obsidian plugin API, Vitest.

**Spec:** `docs/specs/2026-06-08-mcp-copy-setup-prompt-design.md`

---

## File Structure

- **Create** `packages/obsidian-plugin/src/mcp/setupPrompt.ts` — pure prompt-text generator (no Obsidian deps). Sibling of the existing `mcp/mcpJson.ts`.
- **Create** `packages/obsidian-plugin/test/mcp-setup-prompt.test.ts` — unit tests for the generator.
- **Modify** `packages/obsidian-plugin/esbuild.config.mjs` — add a second esbuild build that emits `mcp-server.mjs` (deps inlined, `platform: node`).
- **Modify** `packages/obsidian-plugin/scripts/deploy-dev.sh` — copy `mcp-server.mjs` into the test vault.
- **Modify** `packages/obsidian-plugin/manifest.json` — `isDesktopOnly: true`.
- **Modify** `packages/obsidian-plugin/src/main.ts` — add a `mcpSetupPrompt()` helper that resolves the absolute path + presence and returns prompt-or-reason.
- **Modify** `packages/obsidian-plugin/src/settings.ts` — add the "Connect a coding agent (MCP)" row to the Install tab.

The pure generator is split from the Obsidian-dependent path resolution so the wording/joining logic is unit-testable without a Vault. Path resolution lives on the plugin (it needs `getBasePath()` + the adapter), mirroring how `listMcpServers()` already wraps adapter access.

---

## Task 1: Pure prompt generator

**Files:**
- Create: `packages/obsidian-plugin/src/mcp/setupPrompt.ts`
- Test: `packages/obsidian-plugin/test/mcp-setup-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/obsidian-plugin/test/mcp-setup-prompt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildMcpSetupPrompt, MCP_SERVER_ARTIFACT } from "../src/mcp/setupPrompt.js";

describe("buildMcpSetupPrompt", () => {
  it("embeds the absolute server path and the server name", () => {
    const prompt = buildMcpSetupPrompt("/Users/me/Vault/.obsidian/plugins/perspecta-workflow/mcp-server.mjs");
    expect(prompt).toContain("/Users/me/Vault/.obsidian/plugins/perspecta-workflow/mcp-server.mjs");
    expect(prompt).toContain("perspecta-workflow");
    expect(prompt).toContain(".mcp.json");
  });

  it("instructs node as the command", () => {
    const prompt = buildMcpSetupPrompt("/abs/mcp-server.mjs");
    expect(prompt).toContain("node");
  });

  it("instructs preserving existing servers", () => {
    const prompt = buildMcpSetupPrompt("/abs/mcp-server.mjs");
    expect(prompt.toLowerCase()).toContain("preserve");
  });

  it("exposes the artifact filename constant", () => {
    expect(MCP_SERVER_ARTIFACT).toBe("mcp-server.mjs");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w perspecta-workflow-plugin -- mcp-setup-prompt`
Expected: FAIL — cannot resolve `../src/mcp/setupPrompt.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/obsidian-plugin/src/mcp/setupPrompt.ts`:

```typescript
/** Filename of the bundled MCP server artifact shipped inside the plugin folder. */
export const MCP_SERVER_ARTIFACT = "mcp-server.mjs";

/** Name the perspecta-workflow server is registered under in the agent's .mcp.json. */
export const MCP_SERVER_NAME = "perspecta-workflow";

/**
 * Natural-language prompt the user pastes into a coding agent running in the
 * vault. The agent edits .mcp.json itself — we state intent and the exact
 * command/path, and let the agent own the file format and merge.
 *
 * @param serverAbsPath absolute disk path to the bundled mcp-server.mjs
 */
export function buildMcpSetupPrompt(serverAbsPath: string): string {
  return [
    `Add an MCP server to this project so the agent can run Perspecta workflows.`,
    `Edit (or create) \`.mcp.json\` at the vault root and add a server entry named`,
    `\`${MCP_SERVER_NAME}\` that runs the command \`node\` with the single argument`,
    `\`${serverAbsPath}\`. Preserve any existing servers already declared in the`,
    `file. After editing, confirm the \`${MCP_SERVER_NAME}\` server is registered.`,
  ].join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w perspecta-workflow-plugin -- mcp-setup-prompt`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/mcp/setupPrompt.ts packages/obsidian-plugin/test/mcp-setup-prompt.test.ts
git commit -m "feat(plugin): pure MCP setup-prompt generator"
```

---

## Task 2: Bundle the MCP server into the plugin folder

**Files:**
- Modify: `packages/obsidian-plugin/esbuild.config.mjs`

The existing build produces `main.js` (`platform: browser`, SDK external). Add a
**separate** build for the server: `platform: node`, deps **inlined**, emitting
`mcp-server.mjs`. The entry is the workspace sibling source
`../mcp-server/src/server.ts` (esbuild compiles TS and resolves the
`@perspecta/core` + SDK workspace deps, inlining them).

- [ ] **Step 1: Add the server-bundle build**

In `packages/obsidian-plugin/esbuild.config.mjs`, after the existing plugin
`ctx` block and its `if (watch) { ... }` line, append:

```javascript
// ---- Bundle the MCP server into a self-contained file shipped in the plugin
// folder. The agent (Claude Code) spawns this as its own Node child process
// over stdio — it is NOT loaded into Obsidian's renderer — so it targets
// platform:node and INLINES all deps (opposite of the main bundle, which keeps
// @modelcontextprotocol/sdk external). Output sits next to main.js so it ships
// with the plugin and the "Copy setup prompt" button can point node at it.
const serverCtx = await esbuild.context({
  entryPoints: ["../mcp-server/src/server.ts"],
  bundle: true,
  // The server entry uses top-level await and import.meta.url, which require
  // ESM format. CJS does not support either. We emit .mjs so Node treats the
  // file as ESM regardless of the nearest package.json's "type" field.
  // The banner polyfills `require` for bundled CJS deps (e.g. yaml) whose
  // dynamic require() calls would otherwise throw in an ESM context.
  format: "esm",
  platform: "node",
  target: "node18",
  outfile: "mcp-server.mjs",
  sourcemap: false,
  logLevel: "info",
  banner: {
    js: `import { createRequire } from "module"; const require = createRequire(import.meta.url);`,
  },
  // No externals: the server must run with only the user's system `node`.
});

if (watch) { await serverCtx.watch(); } else { await serverCtx.rebuild(); await serverCtx.dispose(); }
```

- [ ] **Step 2: Run the build**

Run: `npm run build -w perspecta-workflow-plugin`
Expected: build completes; `packages/obsidian-plugin/mcp-server.mjs` now exists.

- [ ] **Step 3: Verify the artifact exists and is non-trivial**

Run: `ls -la packages/obsidian-plugin/mcp-server.mjs && head -c 200 packages/obsidian-plugin/mcp-server.mjs`
Expected: file present, size well over 100 KB (SDK + core inlined), starts with the `createRequire` ESM banner.

- [ ] **Step 4: Verify the server is self-contained (runs with only node)**

The stdio server reads from stdin and does not exit on its own. Confirm it
starts without a missing-module crash by feeding it empty stdin with a short
timeout — a clean start produces no `Cannot find module` / `ERR_MODULE_NOT_FOUND`:

Run: `printf '' | node packages/obsidian-plugin/mcp-server.mjs & PID=$!; sleep 1; kill $PID 2>/dev/null; echo "started cleanly"`
Expected: prints `started cleanly` with no `Cannot find module` / `Error` output above it.

- [ ] **Step 5: Ignore the build artifact in git**

Confirm `mcp-server.mjs` is not tracked (it is a build output, like `main.js` and `styles.css`). Check how the existing outputs are ignored:

Run: `git check-ignore packages/obsidian-plugin/main.js packages/obsidian-plugin/mcp-server.mjs; cat packages/obsidian-plugin/.gitignore 2>/dev/null; cat .gitignore | grep -n "main.js\|styles.css\|obsidian-plugin" `

If `main.js` is ignored but `mcp-server.mjs` is not, add `mcp-server.mjs` next to the `main.js` entry in whichever `.gitignore` lists it (mirror the existing pattern — same file, same style). If `main.js` is NOT ignored (i.e. build outputs are committed in this repo), do nothing here.

- [ ] **Step 6: Commit**

```bash
git add packages/obsidian-plugin/esbuild.config.mjs
# include the .gitignore only if you edited it in Step 5:
git add packages/obsidian-plugin/.gitignore 2>/dev/null || true
git add .gitignore 2>/dev/null || true
git commit -m "build(plugin): bundle mcp-server into self-contained mcp-server.mjs"
```

---

## Task 3: Ship the artifact via the deploy script

**Files:**
- Modify: `packages/obsidian-plugin/scripts/deploy-dev.sh`

- [ ] **Step 1: Add `mcp-server.mjs` to the copied artifacts**

In `packages/obsidian-plugin/scripts/deploy-dev.sh`, change the copy loop line:

```bash
for f in main.js manifest.json styles.css versions.json preload.js; do
```

to:

```bash
for f in main.js manifest.json styles.css versions.json preload.js mcp-server.mjs; do
```

- [ ] **Step 2: Verify deploy copies it (no-op safe when vault absent)**

Run: `npm run deploy -w perspecta-workflow-plugin`
Expected: build runs, then either `deploy-dev: copied N artifact(s)` (vault present) or `deploy-dev: vault not found ... skipping` (exit 0). If the vault is present, N includes `mcp-server.mjs`.

- [ ] **Step 3: Commit**

```bash
git add packages/obsidian-plugin/scripts/deploy-dev.sh
git commit -m "build(plugin): deploy mcp-server.mjs into the dev vault"
```

---

## Task 4: Flip the manifest to desktop-only

**Files:**
- Modify: `packages/obsidian-plugin/manifest.json`

The plugin depends on Node-spawned MCP servers and now ships a Node server
bundle; it cannot function on mobile. Obsidian guidelines require such a plugin
to declare `isDesktopOnly: true`.

- [ ] **Step 1: Set the flag**

In `packages/obsidian-plugin/manifest.json`, change:

```json
  "isDesktopOnly": false
```

to:

```json
  "isDesktopOnly": true
```

- [ ] **Step 2: Verify manifest is still valid JSON**

Run: `node -e "console.log(require('./packages/obsidian-plugin/manifest.json').isDesktopOnly)"`
Expected: prints `true`.

- [ ] **Step 3: Commit**

```bash
git add packages/obsidian-plugin/manifest.json
git commit -m "fix(plugin): mark desktop-only — Node-spawned MCP server + bundled Node artifact"
```

---

## Task 5: Plugin path-resolution helper

**Files:**
- Modify: `packages/obsidian-plugin/src/main.ts`

Add a method that resolves the bundled server's absolute path, checks it exists,
and returns either the ready prompt or a reason it can't. This wraps the
Obsidian-only bits (`FileSystemAdapter.getBasePath()`, `manifest.dir`, adapter
`exists`) so `settings.ts` stays declarative. Mirrors the existing
`listMcpServers()` adapter-wrapping pattern.

- [ ] **Step 1: Add the import**

In `packages/obsidian-plugin/src/main.ts`, the obsidian import currently reads:

```typescript
import { App, Plugin, Notice, WorkspaceLeaf, SuggestModal, TFile } from "obsidian";
```

Add `FileSystemAdapter`:

```typescript
import { App, Plugin, Notice, WorkspaceLeaf, SuggestModal, TFile, FileSystemAdapter } from "obsidian";
```

And add the setup-prompt import next to the existing `parseMcpJsonServers` import:

```typescript
import { buildMcpSetupPrompt, MCP_SERVER_ARTIFACT } from "./mcp/setupPrompt.js";
```

- [ ] **Step 2: Add the helper method**

In `packages/obsidian-plugin/src/main.ts`, find the existing `listMcpServers` method:

```typescript
  async listMcpServers() {
    if (!(await this.app.vault.adapter.exists(".mcp.json"))) return [];
    return parseMcpJsonServers(await this.app.vault.adapter.read(".mcp.json"));
  }
```

Immediately after it, add:

```typescript
  /**
   * Resolve the bundled MCP server's absolute path and build the agent setup
   * prompt. Returns { prompt } when the artifact is present, or { reason } when
   * it is not (e.g. a dev build skipped the bundling step). Desktop-only, so the
   * adapter is always a FileSystemAdapter — getBasePath() is reliable.
   */
  async mcpSetupPrompt(): Promise<{ prompt: string } | { reason: string }> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      return { reason: "MCP setup requires a desktop vault." };
    }
    // manifest.dir is vault-relative, e.g. ".obsidian/plugins/perspecta-workflow".
    const relPath = `${this.manifest.dir}/${MCP_SERVER_ARTIFACT}`;
    if (!(await adapter.exists(relPath))) {
      return { reason: `Bundled server (${MCP_SERVER_ARTIFACT}) not found in the plugin folder — rebuild the plugin.` };
    }
    const absPath = `${adapter.getBasePath()}/${relPath}`;
    return { prompt: buildMcpSetupPrompt(absPath) };
  }
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck -w perspecta-workflow-plugin`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/obsidian-plugin/src/main.ts
git commit -m "feat(plugin): resolve bundled server path + build setup prompt"
```

---

## Task 6: Install-tab "Copy setup prompt" UI

**Files:**
- Modify: `packages/obsidian-plugin/src/settings.ts`

Add a setting row below the existing skills-install action in the `install` tab.
On click it calls `plugin.mcpSetupPrompt()`, copies the prompt via
`navigator.clipboard.writeText`, and shows a Notice. When the artifact is
missing, the row shows the reason and the button is disabled.

- [ ] **Step 1: Add an async MCP-row appender after the sync install section**

The existing MCP tab handles async work inside a sync `render` via `void this.renderMcpTab(el)` (see `settings.ts:81`). Follow that exact pattern instead of making `render` itself async — the settings shell's `render` is called synchronously and we do not rely on it awaiting a returned Promise.

In `packages/obsidian-plugin/src/settings.ts`, the `install` tab's `render` currently ends like this (the `renderInstallSection(...)` call followed by the function's closing braces):

```typescript
              onError: (err) => new Notice(`Perspecta Workflow: install failed - ${(err as Error).message}`),
            });
          },
        },
```

Change it to keep `render` synchronous but fire off the async MCP row after the sync section:

```typescript
              onError: (err) => new Notice(`Perspecta Workflow: install failed - ${(err as Error).message}`),
            });

            // Connect a coding agent to the bundled MCP server. Resolving the
            // server path is async, so append the row when it resolves — same
            // void-an-inner-async approach the MCP tab uses for renderMcpTab.
            void this.renderMcpSetupRow(el);
          },
        },
```

- [ ] **Step 2: Add the `renderMcpSetupRow` method**

In `packages/obsidian-plugin/src/settings.ts`, add this method to the `PerspectaSettingTab` class, right before the existing `private async renderMcpTab(el: HTMLElement): Promise<void> {`:

```typescript
  private async renderMcpSetupRow(el: HTMLElement): Promise<void> {
    const setup = await this.plugin.mcpSetupPrompt();
    const row = new Setting(el)
      .setName("Connect a coding agent (MCP)")
      .setDesc(
        "reason" in setup
          ? setup.reason
          : "Copies a prompt to paste into a coding agent running in this vault. It registers the bundled perspecta-workflow MCP server so the agent can run your workflows.",
      );
    row.addButton((btn) => {
      btn.setButtonText("Copy setup prompt");
      if ("reason" in setup) {
        btn.setDisabled(true);
      } else {
        btn.setCta().onClick(async () => {
          await navigator.clipboard.writeText(setup.prompt);
          new Notice("Setup prompt copied — paste it into your coding agent running in this vault.");
        });
      }
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck -w perspecta-workflow-plugin`
Expected: no errors. (Note `Setting` and `Notice` are already imported in `settings.ts`.)

- [ ] **Step 3: Build the plugin**

Run: `npm run build -w perspecta-workflow-plugin`
Expected: build succeeds; both `main.js` and `mcp-server.mjs` are produced.

- [ ] **Step 4: Manual verification in the dev vault**

Run: `npm run deploy -w perspecta-workflow-plugin`

Then in Obsidian (dev vault), reload the plugin and:
1. Open Settings → Perspecta Workflow → Install tab.
2. Confirm the "Connect a coding agent (MCP)" row appears with an enabled "Copy setup prompt" button.
3. Click it → expect the Notice "Setup prompt copied …".
4. Paste into a scratch note → expect the prompt text containing the absolute path ending in `/.obsidian/plugins/perspecta-workflow/mcp-server.mjs`.

Expected: all four hold. (If the vault isn't available on this machine, note that Step 4 is deferred to a machine with the dev vault; Steps 1–3 of this task plus all automated tests still gate the change.)

- [ ] **Step 5: Commit**

```bash
git add packages/obsidian-plugin/src/settings.ts
git commit -m "feat(plugin): Install-tab Copy setup prompt button for the MCP server"
```

---

## Task 7: Full suite + final verification

- [ ] **Step 1: Run the full plugin test suite**

Run: `npm test -w perspecta-workflow-plugin`
Expected: all suites pass, including the new `mcp-setup-prompt` tests.

- [ ] **Step 2: Run the whole-repo build to confirm nothing else broke**

Run: `npm run build`
Expected: all workspaces build.

- [ ] **Step 3: Confirm the spec's requirements are met**

Re-read `docs/specs/2026-06-08-mcp-copy-setup-prompt-design.md` and confirm:
- Bundled `mcp-server.mjs` emitted into the plugin folder ✔ (Task 2)
- Deploy ships it ✔ (Task 3)
- Natural-language prompt, path embedded, preserve existing servers ✔ (Task 1)
- Install-tab button + missing-artifact guard ✔ (Tasks 5–6)
- `isDesktopOnly: true`, documented ✔ (Task 4)

No commit needed if Steps 1–2 are clean and prior tasks are committed.

---

## Notes for the implementer

- **Test commands:** the full plugin suite is `npm test -w perspecta-workflow-plugin`. To run/filter a SINGLE test file, use `npx vitest run <path/to/file.test.ts>` from the repo root — the `npm test -w … -- <pattern>` form does NOT thread the pattern through to Vitest (it errors "No test files found"), because Vitest is configured at the repo root with `include: ["packages/*/test/**/*.test.ts"]`. Tests import source as `../src/<path>.js` (note the `.js` extension on the import even though the file is `.ts` — that is the repo convention; see `test/mcp-json.test.ts`).
- **Two esbuild builds, opposite settings:** the main bundle is `platform: browser` with `@modelcontextprotocol/sdk` **external**; the server bundle is `platform: node` with **everything inlined**. Do not merge them.
- **`navigator.clipboard`** is available in Obsidian's Electron renderer; this is the first clipboard write in the plugin, which is fine.
- **No npm publish, no repo-path dependency:** the prompt always points at the artifact inside the installed plugin folder, resolved at click time from the live vault path.
