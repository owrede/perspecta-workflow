# MCP settings UI redesign — sub-screen, grouping, Claude-style permission controls

**Date:** 2026-06-09
**Status:** Design — approved, pending plan
**Scope:** `packages/core` (registry model), `packages/obsidian-plugin` (MCP settings tab)

## Problem

The MCP settings tab (`packages/obsidian-plugin/src/settings.ts`, `renderMcpTab`)
has grown awkward:

1. Every server's per-tool permission dropdowns are **inlined** in the same flat
   list as the servers themselves, so a vault with several probed servers becomes
   an unscannable wall of rows.
2. Whitelisted servers aren't grouped — you scroll past disabled ones to reach the
   ones you use.
3. Bulk control is a single **"Block all"** button that *overwrites* every tool's
   permission. There's no "Ask all"/"Allow all", and no notion of a per-group
   default that tools follow.
4. The UI shows the internal probe status word **"hot"**.
5. There's no clear entry point to a server's permission controls.

We're replacing this with a two-view tab (server list → per-server permission
sub-screen) whose sub-screen replicates Claude Code's tool-permissions UI 1:1,
backed by a default/deviation permission model.

## Decisions (locked)

1. **Three tool groups**, not two: `read` / `interactive` / `write`.
2. **Per-group default + per-tool "use default" / deviation.** A tool's permission
   is `"default" | "blocked" | "ask" | "allow"`; `"default"` follows its group's
   default. Setting a tool to its group's current default value auto-collapses to
   `"default"`.
3. **Sub-screen**, not inlined tools. The MCP tab has a list view and a per-server
   detail view, navigated in-place (no settings-shell change).
4. **Enabled servers grouped at the top** of the list.
5. **"enabled"**, never "hot", in the UI.
6. **Claude-style controls**: each group has a default pulldown (text, or "Custom"
   when mixed); each tool has a 3-icon segmented control (allow/ask/block) showing
   its resolved permission.

## Architecture

### 1. Data model (`packages/core/src/pflow/mcp-registry.ts`)

The two-group, concrete-permission model becomes three-group with a default
sentinel. Codegen and the editor read permissions **only** through
`resolveServerGrants` / `snapshotGrants`, so resolving the sentinel inside those
keeps every downstream consumer unchanged.

Type changes:

- `McpToolGroup`: `"read" | "write"` → `"read" | "interactive" | "write"`.
- New `McpStoredPermission = "default" | McpToolPermission` (i.e. `"default" |
  "blocked" | "ask" | "allow"`). `McpRegistryTool.permission` becomes
  `McpStoredPermission`.
- `McpRegistryServer` gains `groupDefaults: Record<McpToolGroup, McpToolPermission>`
  (the per-group default; concrete). Initial value for a freshly probed server:
  all three `"ask"`.

New / changed functions (all pure):

- `classifyToolGroup(name, ann)` → 3-way:
  - `ann.readOnlyHint === true` → `read`
  - `ann.destructiveHint === true` → `write`
  - else by verb: read-verb → `read`, write-verb → `write`
  - else (neither hint, no decisive verb) → `interactive` (the new middle bucket;
    today this case fell through to `write`).
- `resolveToolPermission(server, toolName): McpToolPermission` — returns the tool's
  own permission if concrete, else `server.groupDefaults[tool.group]`. The single
  place the `"default"` sentinel is resolved.
- `resolveServerGrants(server)` — now partitions by `resolveToolPermission(...)`
  instead of `t.permission`. Output type (`ServerGrants`) and shape unchanged.
- `snapshotGrants(server)` — values become `resolveToolPermission(...)` (always
  concrete, as before). Unchanged signature.
- `isPolicyStricter(expected, local)` — compares against `resolveToolPermission`
  for each local tool (unchanged signature; just resolves the sentinel).
- `applyGroupPermission(server, group, permission)` — repurposed to **set the
  group default**: sets `groupDefaults[group] = permission` AND collapses every
  tool in that group to `"default"` (clears deviations). (The bulk buttons call
  this; "all tools follow the new default" is the result.)
- New `setToolPermission(server, toolName, permission): McpRegistryServer` — sets a
  tool to a concrete value, but if that value equals the tool's current group
  default, stores `"default"` instead (deviation auto-collapse). Immutable.
- New `groupIsUniform(server, group): boolean` — true when every tool in the group
  resolves to `groupDefaults[group]` (i.e. no deviations). Drives the pulldown's
  "Custom" state.

**Migration (load of an existing registry):** old tools have concrete permissions
and 2-group classification. On load, tool permissions are kept as-is (a concrete
value = a deviation, harmless if it equals the new default); `groupDefaults` is
absent → treat as all `"ask"` (a missing-field default applied where read). Groups
get the 3-way classification on the next probe. No destructive migration; no data
loss. (Concretely: `groupDefaults` is read with a `?? { read:"ask",
interactive:"ask", write:"ask" }` fallback so pre-existing registries Just Work.)

### 2. The MCP tab: two views (`packages/obsidian-plugin/src/settings.ts`)

`renderMcpTab` keeps owning its container and re-rendering in place (as it does
today via `el.empty()`); it gains a local view state:

```ts
type McpView = { mode: "list" } | { mode: "detail"; server: string };
```

Held in the tab render closure; a setter calls `el.empty()` + re-render.

**List view** (default):
- **"Enabled" heading + group** — whitelisted servers first. Each row: server name;
  desc shows **"enabled"** (or "probing"/"failed — <error>"); right side has the
  enable toggle, a **re-probe** button (when enabled+probed), and a **"Permissions"
  button** (opens detail). The Permissions button shows only when the server is
  enabled and probed (status the new "enabled").
- **"Available" heading + group** — servers in `.mcp.json` not whitelisted: name +
  enable toggle only.
- Empty state unchanged (the existing "No MCP servers" info box).

**Detail view** (sub-screen for one server):
- A **"‹ Back to servers"** control (a `Setting` with a button) → `{mode:"list"}`.
- Title row: server name + "Tool permissions" heading; subtitle "Choose when the
  agent may use these tools."
- A re-probe button.
- The three permission groups (§3). Groups with zero tools are omitted.

Toggling a server off in either view deletes its registry entry (as today) and
returns to / stays in the list.

### 3. Permission controls (the detail-view body)

For each non-empty group in order **Read-only → Interactive → Write/Delete**:

- **Group header** (`Setting().setHeading()`): disclosure name + a count, plus a
  **default control** on the right — a dropdown whose options are the three
  permissions shown as text:
  - `allow` → "Always allow"
  - `ask` → "Permission required"
  - `blocked` → "Blocked"

  When `groupIsUniform(server, group)` is false (≥1 deviation), the dropdown shows
  an extra, selected **"— Custom"** option (and the three real options remain
  choosable). Selecting a real option calls `applyGroupPermission(server, group,
  value)` → sets the group default and collapses deviations; re-render.

  *(Obsidian's `DropdownComponent` is the closest native analog to the
  screenshot's group pulldown; the segmented 3-icon control is per-tool below.)*

- **One row per tool**: tool name (+ description as the setting desc), and on the
  right a **3-icon segmented control** built from three `ExtraButton`s (lucide
  icons: `circle-check` = allow, `hand` = ask, `ban` = block — all standard Lucide
  names Obsidian bundles; `setIcon` silently no-ops on an unknown name, so the
  implementer must eyeball each one renders and swap to a present alternative if
  not, e.g. `check`/`check-circle`, `circle-slash`/`x-circle`). The icon matching
  the tool's **resolved** permission (`resolveToolPermission`) is shown active
  (e.g. `.setCta()`-style emphasis / accent class); the others muted. Clicking an
  icon calls `setToolPermission(server, tool, thatPermission)` (which auto-collapses
  if it equals the group default) and re-renders so the group pulldown reflects
  uniform/Custom. A tool whose resolved permission is `blocked` renders slightly
  dimmed (match the screenshot).

Every mutation persists via `plugin.saveSettings()` then re-renders the detail view
in place.

## Components & boundaries

- **`mcp-registry.ts`** (core, pure): the model + `resolveToolPermission`,
  `setToolPermission`, `groupIsUniform`, updated `classifyToolGroup` /
  `applyGroupPermission` / grants. Unit-tested without Obsidian.
- **`settings.ts`** (plugin): `renderMcpTab` (list) + new private
  `renderMcpDetail(el, serverName)` + a small `renderPermissionGroup(...)` helper.
  Obsidian-dependent; verified by typecheck + manual.
- The segmented-control rendering is a focused helper so the icon/active-state
  logic is in one place.

## Testing

- **Core (unit, the logic that matters):**
  - `classifyToolGroup` 3-way: read-hint→read, destructive-hint→write,
    read-verb→read, write-verb→write, neutral→interactive.
  - `resolveToolPermission`: concrete returns itself; `"default"` returns the
    group default.
  - `setToolPermission`: setting ≠ default stores concrete (deviation); setting
    = current group default stores `"default"` (collapse).
  - `applyGroupPermission`: sets `groupDefaults[group]` and collapses that group's
    tools to `"default"`; other groups untouched.
  - `groupIsUniform`: true when all tools resolve to the default; false with a
    deviation.
  - `resolveServerGrants` / `snapshotGrants` resolve the sentinel (a `"default"`
    tool lands in the partition of its group default).
  - Back-compat: a server object with no `groupDefaults` resolves as if all `"ask"`.
- **Plugin:** existing probe/registry tests keep passing; the segmented-control
  active-state mapping (resolved permission → which icon is active) is a pure
  function worth a unit test if extracted.
- **Manual (dev vault):** enable a server → Permissions → toggle a group default,
  deviate one tool (pulldown → Custom), set it back (collapses), Back returns to a
  list with the server under "Enabled" showing "enabled".

## Out of scope

- Changing how `.mcp.json` is read or written (the import-prompt feature owns that).
- Any change to codegen output (grants stay concrete via the resolver).
- A fourth "interactive" data signal beyond annotations/verbs (we derive it as the
  neutral bucket; no new probe data).
- Persisting per-tool group *overrides* of the read/interactive/write
  classification (`groupSource: "user"` exists in the type but the UI doesn't let
  users reclassify a tool's group in this redesign).
