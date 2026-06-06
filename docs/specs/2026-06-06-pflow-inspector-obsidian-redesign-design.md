# pflow inspector — Obsidian-idiomatic redesign

Date: 2026-06-06
Branch: `feat/pflow-m2-editor`
Status: approved design, pre-implementation

## Motivation

The pflow editor's inspector sidebar uses ad-hoc CSS (plain labels, hard-coded
spacing) that does not follow Obsidian's settings/sidebar design language. It
should look native — matching the structure, spacing tokens, and theme
variables Obsidian uses for settings panes — and match the proven inspector in
the sibling vault-memory plugin (the canonical reference for Svelte +
@xyflow/svelte editors in this ecosystem).

## Decisions (from brainstorming Q&A)

- **Full adopt** the vault-memory inspector pattern: `<section>` groups,
  kind-accented header with icon + one-line description, Obsidian size/typography
  tokens, accent focus rings. Both inspector modes (node selected / workflow
  config when nothing selected).
- **Kind descriptions** come from a small built-in `KIND_INFO` map in the
  plugin (no schema change), mirroring vault-memory's verb-catalog approach.
- Keep the implementation in Svelte (not the imperative Obsidian `Setting` API),
  since the whole editor is Svelte runes.

## Scope

Presentation only. No document-mutation logic changes — the existing props and
callbacks (`onPrompt`, `onRename`, `onKindChange`, `onWorkflowMeta`,
`onArgDefault`) are unchanged. Files:

- `src/views/pflow-editor/kind-info.ts` (new) — `KIND_INFO: Record<NodeKind,
  { title: string; description: string; icon: string }>`. The `icon` is the
  same Lucide-path key already used in `PflowNode.svelte`; consolidate the
  icon-path map here so node + inspector share one source.
- `src/views/pflow-editor/inspector-pane.svelte` (rewrite markup + styles).
- `src/views/pflow-editor/PflowNode.svelte` (import icon paths from kind-info to
  avoid duplication; no visual change).

## Design — inspector layout

### Shared chrome
- Root `.pflow-inspector`: `background: var(--background-secondary)`,
  `font-family: var(--font-interface)`, `font-size: var(--font-ui-small)`,
  scrollable, left border `--background-modifier-border`.
- `<section>` blocks: `padding: var(--size-4-3)`, bottom border
  `--background-modifier-border` (last child none).
- Section title: uppercase, `--font-ui-smaller`, `--font-semibold`,
  letter-spacing 0.06em, `color: var(--text-muted)`.
- Section help: `--text-muted`, `--font-ui-smaller`, line-height 1.45; inline
  `<code>` uses `--font-monospace` + `--text-accent`.
- Inputs/textareas/selects: full width, `--background-primary`,
  `1px solid var(--background-modifier-border)`, `--radius-s`, padding
  `var(--size-2-2) var(--size-2-3)`, `--font-ui-small`; focus →
  `outline: 2px solid var(--interactive-accent); outline-offset: -1px`.

### Mode A — node selected
- **Header** (`.pflow-inspector-header`), left-accented with the node's kind
  colour (reuse the `--pflow-accent` mapping from PflowNode, lifted into
  kind-info or duplicated as a kind→colorVar map):
  - Row: kind icon (SVG, 20px, accent-coloured) + title block.
  - Title block: node label (editable inline is in the Name section below; the
    header shows the current label as an `h2`) + kind badge (`KIND_INFO.title`
    or the raw kind) in accent monospace.
  - Description paragraph: `KIND_INFO[kind].description`.
- **Section "Name"**: help ("Other nodes wire to this node's ports; the name is
  how it reads on the canvas.") + text input bound to label (`onRename`).
- **Section "Type"**: help ("Changing the type resets this node's ports; wires
  that no longer fit are removed after confirmation.") + `<select>` of
  NODE_KINDS (advanced kinds disabled as today) (`onKindChange`).
- **Section "Prompt"**: textarea bound to prompt (`onPrompt`). Only shown for
  kinds that carry a prompt (agent/verify/synthesize/loop/branch); hidden for
  input/output/split/join (no prompt). For `script`, show the config body note.
- **Section "Ports"**: Inputs and Outputs as labelled rows
  (`name : type` + required `*`), styled like vault-memory's arg rows (muted
  key, monospace type).

### Mode B — nothing selected (workflow config)
- **Header**: "Workflow" title + a one-line description ("The workflow's
  identity and save defaults. These compile into the generated workflow's args.").
- **Section "Name"**: help + text input (`onWorkflowMeta({name})`).
- **Section "Description"**: help + textarea (`onWorkflowMeta({description})`).
- **Section "Save defaults"**: three text inputs (`target_folder`,
  `filename_template`, `on_exists`) each with a one-line help, wired to
  `onArgDefault`.

## KIND_INFO content (one-liners)

- input — "An entry point: a value supplied when the workflow runs."
- output — "An exit point: the value the workflow returns."
- agent — "An LLM step that processes its wired inputs."
- split — "Fans an array out to run the next steps per item."
- join — "Collects the per-item results from a split back into a list."
- loop — "Repeats its upstream span until a sentinel condition is met."
- verify — "Checks its input and records a pass/fail verdict (non-blocking)."
- synthesize — "Merges several inputs into one result."
- branch — "Routes to one of several paths based on an LLM decision."
- script — "A terminal escape hatch: hand-written workflow code."

## Testing

- Presentation change; verified by build + typecheck + manual reload. The
  existing flow-map unit tests are unaffected (no logic change). A light DOM
  smoke is out of scope (no component-test harness in this plugin).
- Gate: full build, both typechecks, deploy byte-identical, manual visual check.

## Out of scope

- Editing port schemas / adding-removing ports from the inspector.
- The imperative Obsidian `Setting` API.
- Any change to node/edge rendering beyond sharing the icon-path map.
