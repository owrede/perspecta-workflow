# Import MCP servers — wire the agent's MCP servers (incl. perspecta-workflow) into the vault

**Date:** 2026-06-08 (updated after shipping; goal broadened from one server to all)
**Status:** Shipped; prompt refined
**Scope:** `packages/obsidian-plugin` (Install tab UI, build), `packages/obsidian-plugin/manifest.json`

## Problem

The perspecta-workflow MCP server is what lets a coding agent (Claude Code) in
the vault directory actually *run* workflows. But there is no one-click way to
connect it — and more broadly, the plugin's MCP tab can only manage servers that
already appear in the vault's `.mcp.json`, which is usually empty:

- The MCP server (`@perspecta/mcp-server`) lives in the monorepo and is **not
  published to npm**. The plugin ships separately, so the server does not
  currently travel with it.
- The MCP settings tab only **reads** servers declared in `.mcp.json` at the
  vault root. Nothing **writes** servers into it — neither perspecta-workflow nor
  the many MCP servers the agent already has configured across its own scopes.
- Result: the tab is blind to most of what the agent can do, and the user wires
  everything by hand.

We are building the on-ramp: a button that hands the user a prompt they paste
into their coding agent. The agent then **imports every MCP server it has
configured** (user/project/managed scopes) into the vault's `.mcp.json`, ensuring
the bundled perspecta-workflow server is among them — so the MCP tab can see and
manage all of them. (The original scope was just registering perspecta-workflow;
it was broadened to all servers per the user's correction.)

## Decisions (locked)

1. **Server delivery: bundled inside the plugin.** The built server ships inside
   the plugin folder (`<vault>/.obsidian/plugins/perspecta-workflow/`), so it is
   self-contained and version-coherent with the installed plugin. No npm, no
   repo-path dependency.
2. **Prompt style: natural-language instruction; imports ALL the agent's
   servers.** The button copies a human-readable, numbered instruction telling
   the agent to enumerate every MCP server it has (across scopes), ensure
   perspecta-workflow is included, and MERGE them all into `.mcp.json`. The agent
   performs the edit — handling format, merge, secret redaction, validation —
   rather than the plugin emitting raw JSON or a client-specific CLI command.
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

- **Absolute path resolution:** the plugin's own folder is exposed by Obsidian
  as `this.plugin.manifest.dir` (a vault-relative path, e.g.
  `.obsidian/plugins/perspecta-workflow`). The artifact's vault-relative path is
  `manifest.dir + "/" + artifact`. To turn that into an OS-native absolute path
  with correct separators on every platform (including Windows backslashes), use
  `FileSystemAdapter.getFullPath(relPath)` rather than string-joining
  `getBasePath()` (which would yield mixed separators on Windows):

  ```
  adapter.getFullPath(".obsidian/plugins/perspecta-workflow/mcp-server.mjs")
  → /Users/.../MyVault/.obsidian/plugins/perspecta-workflow/mcp-server.mjs   (POSIX)
  → C:\Users\...\MyVault\.obsidian\plugins\perspecta-workflow\mcp-server.mjs (Windows)
  ```

  `minAppVersion` is raised to `1.7.2` as a conservative floor for relying on
  `getFullPath` on `FileSystemAdapter` (the method predates this, but 1.7.2 is a
  safe, recent baseline; the plugin is desktop-only regardless). Using
  `manifest.dir` (rather than reconstructing from `configDir` + id) keeps the
  path correct even if Obsidian relocates plugin storage.

  Because the plugin is desktop-only (decision 5), the adapter is always a
  `FileSystemAdapter` at runtime, so `getBasePath()` is reliably present.

- **Prompt text (natural language, numbered, path embedded).** The pure helper
  `buildMcpSetupPrompt(serverAbsPath)` (in `src/mcp/setupPrompt.ts`) returns a
  5-step instruction. The steps:

  1. **Enumerate** every MCP server across all scopes (prefer `claude mcp list` /
     `claude mcp get <name>`; else read config), capturing name, transport, and
     launch details.
  2. **Ensure perspecta-workflow is included** as a stdio server. Because the
     *plugin itself* spawns this one (outside a shell, no PATH), its `command`
     must be an ABSOLUTE node path (`which node`), with `args` =
     `["<ABS-PATH>/mcp-server.mjs"]`. Other servers keep bare commands — the
     plugin's probe augments PATH for those.
  3. **Merge** into `.mcp.json` under `mcpServers`: add/update, never delete or
     modify unrecognized entries.
  4. **Redact secrets**: replace secret `env` VALUES (keys like `*_API_KEY`,
     `*_TOKEN`, `*_SECRET`, `AUTH*`) with `${VAR_NAME}` references; if unsure,
     treat as secret. Non-secret env (paths, flags, IDs) stays.
  5. **Validate and report**: re-read `.mcp.json`, confirm valid JSON +
     perspecta-workflow present with an absolute node command; report
     added/updated/untouched + any redactions.

  The resulting perspecta-workflow entry is shaped like
  `{ "command": "/abs/node", "args": ["<ABS-PATH>/mcp-server.mjs"] }`; the prompt
  states intent in prose and lets the agent own the exact edit.

### 3. Install-tab UI (plugin settings)

A new `Setting` row in the Install tab (`packages/obsidian-plugin/src/settings.ts`,
`install` tab `render`), placed below the existing skills-install action:

- **Name:** "Import the agent's MCP servers"
- **Desc:** explains that the prompt, pasted into a coding agent running in this
  vault, records every MCP server the agent has into the vault's `.mcp.json`
  (including the bundled perspecta-workflow server) so the MCP tab can manage
  them all.
- **Button:** "Copy import prompt".
- **On click:** resolve the absolute path, copy the generated prompt to the
  clipboard, show a `Notice`: *"Import prompt copied — paste it into your coding
  agent running in this vault."* `navigator.clipboard.writeText` is wrapped in
  try/catch with a fallback Notice; a disabled button (missing artifact) shows
  the reason as a tooltip.

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
