# Copy setup prompt — wire the perspecta-workflow MCP server into a coding agent

**Date:** 2026-06-08
**Status:** Design — approved, pending plan
**Scope:** `packages/obsidian-plugin` (Install tab UI, build), `packages/obsidian-plugin/manifest.json`

## Problem

The perspecta-workflow MCP server is what lets a coding agent (Claude Code) in
the vault directory actually *run* workflows. But there is no one-click way to
connect it:

- The MCP server (`@perspecta/mcp-server`) lives in the monorepo and is **not
  published to npm**. The plugin ships separately, so the server does not
  currently travel with it.
- The existing MCP settings tab only **reads** servers already declared in
  `.mcp.json` at the vault root and lets the user whitelist / set permissions on
  them. Nothing **writes** the perspecta-workflow server into the agent's MCP
  config.
- Result: the user wires it by hand, against a server binary that does not yet
  exist on their machine in a runnable form.

We are building the on-ramp: a button that hands the user a prompt they paste
into their coding agent, which then registers the server.

## Decisions (locked)

1. **Server delivery: bundled inside the plugin.** The built server ships inside
   the plugin folder (`<vault>/.obsidian/plugins/perspecta-workflow/`), so it is
   self-contained and version-coherent with the installed plugin. No npm, no
   repo-path dependency.
2. **Prompt style: natural-language instruction.** The button copies a
   human-readable instruction telling the agent what to do. The agent performs
   the edit — merging with existing servers, handling `.mcp.json` format,
   validating — rather than the plugin emitting raw JSON or a CLI command tied to
   one client.
3. **Placement: the Install tab.** Grouped with the existing "Install agent
   skills" action, since both are agent setup. The MCP tab stays purely about
   server discovery and per-tool permissions.
4. **Bundling build step: build it now.** Making the server truly self-contained
   requires a new plugin-build step that emits a single inlined file. We do this
   now rather than deferring to a `dist/`-path stopgap.
5. **Plugin is desktop-only.** `manifest.json` `isDesktopOnly` is set to `true`.

## Architecture

Three pieces, each independently understandable and testable.

### 1. Bundled server artifact (build)

The mcp-server package's entry (`packages/mcp-server/src/server.ts`, currently
built to `dist/server.js` as ESM with `@modelcontextprotocol/sdk` + `zod` as
runtime deps) must become a **single self-contained file** placed in the plugin
folder so it runs with only the user's system `node` — no sibling
`node_modules`.

- **Artifact:** `mcp-server.mjs` (ESM, dependencies inlined) written next
  to the plugin's `main.js`, `manifest.json`, `styles.css`. ESM (not CJS) is
  required because the server entry uses top-level await and `import.meta.url`,
  which CJS cannot host; a `createRequire` banner polyfills `require` for any
  bundled CJS deps. Node runs a `.mjs` file as ESM regardless of package type.
- **Build:** a companion esbuild build in the plugin's build pipeline
  (`esbuild.config.mjs`) with `entryPoints: [<mcp-server entry>]`,
  `bundle: true`, `platform: "node"`, `format: "esm"`,
  `outfile: "mcp-server.mjs"`, plus a `createRequire` banner. Unlike the main
  plugin bundle (which keeps `@modelcontextprotocol/sdk` external), this build
  **inlines** all runtime deps so the file is standalone. It is a *separate*
  esbuild invocation from the `platform: "browser"` plugin bundle — they have
  opposite externals and platforms.
- **Deploy:** `scripts/deploy-dev.sh` already copies the plugin folder to the
  test vault; it must include `mcp-server.mjs` in the copied set.

**Why a Node bundle, not the renderer bundle:** the MCP server is spawned by the
agent as its own Node child process over stdio. It is not loaded into Obsidian's
Electron renderer. So it targets `platform: "node"` and is free to use Node
built-ins and the full SDK.

### 2. Path + prompt generation (plugin runtime)

A small, pure-where-possible helper that produces the prompt text.

- **Absolute path resolution:** `FileSystemAdapter.getBasePath()` gives the
  vault's absolute disk path. The plugin's own folder is exposed by Obsidian as
  `this.plugin.manifest.dir` (a vault-relative path, e.g.
  `.obsidian/plugins/perspecta-workflow`). Join base path + `manifest.dir` +
  artifact name:

  ```
  <getBasePath()>/<manifest.dir>/mcp-server.mjs
  → /Users/.../MyVault/.obsidian/plugins/perspecta-workflow/mcp-server.mjs
  ```

  Using `manifest.dir` (rather than reconstructing from `configDir` + id) keeps
  the path correct even if Obsidian relocates plugin storage.

  Because the plugin is desktop-only (decision 5), the adapter is always a
  `FileSystemAdapter` at runtime, so `getBasePath()` is reliably present.

- **Prompt text (natural language, path embedded):**

  > Add an MCP server to this project so the agent can run Perspecta workflows.
  > Edit (or create) `.mcp.json` at the vault root and add a server entry named
  > `perspecta-workflow` that runs the command `node` with the single argument
  > `<ABS-PATH>/mcp-server.mjs`. Preserve any existing servers already declared
  > in the file. After editing, confirm the `perspecta-workflow` server is
  > registered.

  The resulting `.mcp.json` entry the agent should produce is shaped like
  `{ "command": "node", "args": ["<ABS-PATH>/mcp-server.mjs"] }`, but the prompt
  states intent in prose and lets the agent own the exact edit.

### 3. Install-tab UI (plugin settings)

A new `Setting` row in the Install tab (`packages/obsidian-plugin/src/settings.ts`,
`install` tab `render`), placed below the existing skills-install action:

- **Name:** "Connect a coding agent (MCP)"
- **Desc:** explains that the prompt, pasted into a coding agent running in this
  vault, registers the bundled perspecta-workflow MCP server so the agent can run
  workflows.
- **Button:** "Copy setup prompt".
- **On click:** resolve the absolute path, copy the generated prompt to the
  clipboard, show a `Notice`: *"Setup prompt copied — paste it into your coding
  agent running in this vault."*

## Guards & edge cases

The desktop-only decision removes the mobile / non-`FileSystemAdapter` branch
(no disk path). That leaves **one** real guard:

- **Bundled server file missing.** If `mcp-server.mjs` is not present in the
  plugin folder (e.g. a dev build skipped the bundling step), the setting's desc
  says so and the button does not copy a prompt pointing at a non-existent file.
  Detected via `adapter.exists(<plugin-relative path to mcp-server.mjs>)`.

## Manifest correction (related, independent)

`packages/obsidian-plugin/manifest.json` currently declares
`"isDesktopOnly": false`. This is incorrect: the plugin's purpose depends on
Node-spawned MCP servers, and it now ships a Node server bundle that only runs on
desktop. Per Obsidian plugin guidelines, a plugin that does not function on
mobile **must** declare `"isDesktopOnly": true` (this is the manifest field that
expresses "mobile = false"); otherwise Obsidian offers it on mobile where it
cannot work.

- **Change:** set `"isDesktopOnly": true`.
- **Note in code/commit:** record *why* (Node-spawned MCP server + bundled Node
  artifact) so it is not silently flipped back.
- **Side benefit:** guarantees `FileSystemAdapter` at runtime, making path
  resolution in piece 2 unconditional.

## Testing

- **Prompt/path helper:** unit-test the pure prompt-generation function — given a
  base path and artifact name, it produces the expected prose with the correctly
  joined absolute path. (Path joining and prompt wording are the logic worth
  pinning.)
- **Build artifact:** a build-level check that `mcp-server.mjs` is emitted and is
  self-contained — e.g. running `node mcp-server.mjs` starts the stdio server
  without a sibling `node_modules`. (Manual or a thin smoke step; the existing
  mcp-server test suite already covers server behavior.)
- **UI:** the missing-file guard path — when `mcp-server.mjs` is absent, the
  button is inert and the desc reflects it.

## Out of scope

- Publishing `@perspecta/mcp-server` to npm (a future alternative delivery).
- Auto-editing `.mcp.json` from the plugin itself (the agent does the edit, by
  decision 2).
- Any change to the MCP tab's existing whitelist/permission behavior.
- Mobile support.
