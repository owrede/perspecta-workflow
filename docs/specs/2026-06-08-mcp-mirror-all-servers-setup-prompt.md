# Setup prompt — mirror all of an agent's MCP servers into the vault `.mcp.json`

**Date:** 2026-06-08
**Status:** ADOPTED — this hardened prompt is what `buildMcpSetupPrompt`
(`packages/obsidian-plugin/src/mcp/setupPrompt.ts`) now emits, with two
deviations the plugin makes for robustness:
  1. **CAPTURE_CLOUD = true** (not the doc's default `false`): cloud/plugin
     connectors are captured best-effort and marked auth-required, since the
     agent is already authenticated to them. Such entries are reference/inventory
     and may not probe in the plugin without that client's OAuth.
  2. **perspecta-workflow uses an ABSOLUTE node path** (`which node`), not bare
     `node` — the plugin spawns that one itself outside a shell (no PATH).
  3. The plugin passes the already-resolved absolute `.mjs` path
     (`FileSystemAdapter.getFullPath`) instead of asking the agent to derive
     `<VAULT_ROOT>`.
**Related:** [`2026-06-08-mcp-copy-setup-prompt-design.md`](2026-06-08-mcp-copy-setup-prompt-design.md)
**Audience:** another coding agent, pointed here to read and adopt the prompt.

## What this is

A hardened, reusable version of the "Copy setup prompt" on-ramp.

The base spec (`2026-06-08-mcp-copy-setup-prompt-design.md`) covers the
**minimal** case: hand a coding agent a prose instruction that registers the
single bundled `perspecta-workflow` MCP server into the vault's `.mcp.json`.

This document covers the **superset** case: register `perspecta-workflow`
**and mirror every other MCP server the coding agent already has configured**
into the vault `.mcp.json`, so the Perspecta Workflow plugin (and any agent
running in the vault) can see the user's full toolset — not just the workflow
server.

Use this when the goal is "make the workflow editor aware of all my MCP tools,"
not just "wire up the workflow server."

## Why the naive version of this prompt fails

The obvious phrasing — *"list every MCP server you have and write them all into
`.mcp.json`"* — breaks in practice because "every configured server" silently
mixes three incompatible kinds:

| Kind | Examples | Reproducible as a `.mcp.json` launch entry? |
|---|---|---|
| **Local-reproducible** | stdio `command`+`args`; plain `http`/`sse` url with no auth | **Yes** — copy verbatim, will launch |
| **Cloud OAuth connectors** (`claude.ai` scope) | Linear, Notion, Gmail, Drive, Figma, Miro, Zapier | **No** — the CLI deliberately hides their URLs; they need interactive OAuth and are managed by the cloud client |
| **Dynamic / plugin** (`plugin:*`, command-line scope) | `plugin:linear:linear`, `plugin:github:github` | **No** — owned by the plugin marketplace; transient; no stable launch spec |

An agent handed the naive prompt either stalls (asking what to do with the
cloud connectors) or guesses at URLs and writes dead entries. The hardened
prompt below pre-decides the policy: **classify, then write only what is
launchable**, and document the rest as skipped.

Other failure modes the hardened prompt closes:

- **Secrets aren't only in `env`.** They also appear in **url query strings**
  (e.g. `?key=<token>`) and occasionally in **args** (`--token abc`) and
  **headers**. The masking rule must scan all four.
- **Idempotency was undefined.** "Merge, don't replace" didn't say what counts
  as "differs" or how a second run should behave. The hardened version makes
  re-runs stable and defines precedence between live config and manual edits.
- **No transport normalization.** Real configs have inconsistent shapes (missing
  `type`, mixed key order). The prompt asks for a normalized schema plus a final
  JSON-validity and no-plaintext-secret check.
- **Hardcoded absolute path** for the workflow server (with a vault name
  containing spaces) is brittle. The reusable prompt derives it from the vault
  root.

## The single decision the operator must make: `CAPTURE_CLOUD`

Everything else in the prompt is mechanical. The real fork is whether to record
the non-reproducible (cloud/plugin) servers at all:

- **`CAPTURE_CLOUD = false` (recommended default).** Write only servers that
  actually launch. The file stays safe-to-sync and every entry works. Cloud and
  plugin servers are reported as "skipped — not reproducible." Choose this when
  the goal is *"the plugin can run these."*
- **`CAPTURE_CLOUD = true`.** Additionally record best-effort `http` entries for
  cloud connectors (secrets masked), marked as auth-required reference entries.
  They will **not** work in the plugin without that client's OAuth. Choose this
  only when the goal is *"`.mcp.json` should be a full inventory/manifest,"*
  accepting the cloud entries are reference-only.

## The hardened prompt

Copy everything in the block below into the coding agent. Set the two parameters
at the bottom first.

```text
Goal: Record the MCP servers I (this coding agent) have configured into this
vault's `.mcp.json`, so the Perspecta Workflow Obsidian plugin can see and
launch them. Be idempotent — running this twice produces the same file.

## 1. Enumerate
List every MCP server configured for me across ALL scopes: user/global,
project, dynamic/command-line, plugin, managed/enterprise, and cloud
(claude.ai) connectors. Use `claude mcp list` plus `claude mcp get <name>`
for detail; fall back to reading the config files directly
(~/.claude.json, managed config paths) for full transport, command, args,
url, env, and headers. Note each server's SCOPE and KIND.

## 2. Classify each server into one of three kinds
- LOCAL-REPRODUCIBLE: has a concrete launch spec (stdio command+args, or a
  plain http/sse url with no auth handshake). → WRITE these.
- CLOUD-OAUTH (claude.ai scope) or PLUGIN/DYNAMIC: launch details are
  managed/hidden or require interactive auth. → By default, SKIP and list
  them under "skipped (not reproducible)". If you can recover a usable url
  from the CLI output, you MAY record it as a best-effort http entry, but
  ONLY if CAPTURE_CLOUD = true; mark such entries as needing separate
  authentication.

## 3. Ensure perspecta-workflow is present
If absent, add a stdio server named `perspecta-workflow`: command `node`,
single arg = "<VAULT_ROOT>/.obsidian/plugins/perspecta-workflow/mcp-server.mjs"
(derive VAULT_ROOT from the current vault; don't hardcode).

## 4. Merge into <VAULT_ROOT>/.mcp.json (create if missing), under "mcpServers"
- ADD servers that are missing.
- For servers I own/recognize whose live config differs: UPDATE to match live config.
- For entries I do NOT recognize, or that look manually edited: LEAVE
  UNTOUCHED (do not reorder, reformat, or drop).
- Normalize every written entry to: {type, command, args, env} for stdio,
  or {type, url, headers?} for http/sse. Preserve existing key order for
  untouched entries.

## 5. Never write secrets in cleartext — anywhere
Scan env values, url query strings, args, and headers. If a value looks like
an API key, token, password, or secret, replace it with an env-var reference
like ${SERVER_NAME_API_KEY} and note the original lives outside the file.
Keep non-secret values (paths, namespaces, ids, flags) as-is.

## 6. Validate and report
- Confirm the file is valid JSON and contains no plaintext secret patterns.
- Report a table: ADDED / UPDATED / LEFT-UNTOUCHED / SKIPPED-NOT-REPRODUCIBLE
  (with the reason per skipped server).
- Confirm `perspecta-workflow` is present.
- Note that the plugin/agent must reload to pick up the changes.

Parameters: VAULT_ROOT = <auto-detect>, CAPTURE_CLOUD = false.
```

## Adoption notes (for whoever wires this into the plugin)

- This is the **advanced** on-ramp. The Install-tab button described in the base
  spec should keep emitting the **minimal** prompt by default (register only
  `perspecta-workflow`). This superset prompt is appropriate either as a second
  action ("Copy setup prompt — include my other MCP servers") or as docs for
  power users who want their full toolset mirrored.
- `VAULT_ROOT` should be filled in by the plugin the same way the base spec
  resolves the artifact path: `FileSystemAdapter.getFullPath(...)` against
  `manifest.dir`, not string-joined `getBasePath()` (correct separators on
  Windows). The prompt says "auto-detect" so it also works when pasted into an
  agent whose CWD is already the vault root.
- The CLI commands in step 1 are Claude Code-specific (`claude mcp list/get`,
  `~/.claude.json`). For other coding agents, the same step generalizes to
  "read your own MCP configuration files"; keep that fallback phrasing in the
  prompt so it isn't Claude-only.
- Step 5's masking is conservative by design (flag anything key/token/secret/
  password-shaped of sufficient length). False positives are acceptable — a
  masked non-secret is still launchable once the operator sets the env var; a
  leaked real secret in a synced file is not.

## Worked example (the run that produced this doc)

Against a real Claude Code install in the Intelligence Impact vault, with
`CAPTURE_CLOUD = false`:

- **Added (11, local-reproducible, user scope):** memory, figma-desktop,
  tinderbox, plaud, filesystem, applescript, pencil, open-design, playwright,
  sequential-thinking, git.
- **Left untouched (2, pre-existing vault entries):** vault-memory,
  perspecta-workflow.
- **Skipped — not reproducible (cloud OAuth):** Miro, Excalidraw, Linear, Figma,
  Zapier, Google Drive, Gmail, Google Calendar, Notion, OWR-Brain. The
  OWR-Brain connector carried a `?key=<token>` secret in its URL — a concrete
  case the env-only masking rule would have missed and step 5's url-scan
  catches.
- **Skipped — not reproducible (plugin/dynamic):** plugin:linear, plugin:github.
- **Secrets masked:** none needed among the written set (no API keys/tokens in
  any local server's env; open-design's env held only a data-dir path and a
  namespace id).

Result: 13 servers in `.mcp.json`, valid JSON, no cleartext secrets,
`perspecta-workflow` present.
