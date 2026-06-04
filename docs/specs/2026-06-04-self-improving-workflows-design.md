# Perspecta Workflow — Self-Improving Workflows (formatter, config, and learning)

**Date:** 2026-06-04
**Status:** Approved (design), pending implementation plan
**Repo:** `~/Documents/GitHub/perspecta-workflow`
**Depends on:** Phase 1.5 (marker, auto-color, Set node type) — merged to `main`.
**Relates to:** Phase 1.6 (discovery & invocation) — the `/perspecta:workflow`
command is where the learning behaviour is instructed.

## Purpose

Two capabilities, one coherent model:

1. **A clean way to express output target and output format** in a workflow,
   without nested maps or multi-line strings in frontmatter (which break
   Obsidian's Properties UI). Introduces the `formatter` node type and a
   `config` node convention.
2. **Self-improving workflows** — when an agent walking a workflow learns
   something (a missing value, a correction, a better instruction), it
   **updates the workflow itself** so the next run starts from what it learned.
   The canvas + node-notes ARE the memory.

The formatter/config work is the first concrete instance of the second: a
`config` node that starts with placeholders and becomes filled-in defaults
after the first run.

## Motivation

The original `write_note` node crammed the output template into frontmatter:

```yaml
params:
  path: "Meetings/Follow-ups/{{meeting}} — Follow-up.md"
  content: "## Summary\n\n{{summary}}\n\n## Action items\n\n{{action_items}}"
```

Valid YAML, hostile to Obsidian: nested maps render as an indented blob and the
multi-line `content` string (with literal `\n`) is uneditable in the visual
Properties editor; an edit there risks corrupting the YAML. The engine never
parsed `params` anyway — the agent reads frontmatter + body as text and IS the
runtime. So the fields were author-facing convention with a Properties-hostile
shape and no engine benefit.

**General lesson (a suite-level rule, see §6):** node frontmatter must be
Properties-UI-friendly — flat scalars and simple lists only. Rich content
(templates, prose) belongs in the node body.

## Part A — Output target and format

### A.1 The `formatter` node type

`formatter` is a first-class node type (added to core `NODE_TYPES`, color hex
`#999900` olive). It renders an output template from upstream context vars into
a single formatted string.

- **Frontmatter:** flat scalars/lists only.
  ```yaml
  class: WorkflowNode
  node_type: formatter
  inputs: [meeting, summary, action_items]   # documentation; optional
  outputs: [formatted]                        # the rendered string var
  ```
- **Body:** the template, as Markdown with `{{var}}` placeholders, inside a
  fenced ` ```template ` block. The fenced block is the **literal output**;
  everything outside it is instruction to the agent.

**Engine semantics:** the engine does not parse the template. Like `prompt`, a
`formatter` node is handed to the agent as frontmatter + body; the agent
substitutes vars and stores the result in the declared `outputs` var. The
`formatter` type is therefore a **convention with one lint contract** (see
A.4), not a parsed construct. The ` ```template ` fence is a reading aid for
the agent and a future extraction point; today it carries no engine behaviour.

### A.2 The `config` node — declared learnable settings

A `config` node holds workflow settings as flat frontmatter scalars. It is the
designated home for **resolved defaults the agent may remember** (see Part B).

```yaml
class: WorkflowNode
node_type: config
target_folder: Meetings/Follow-ups
filename_template: "{{meeting}} — Follow-up.md"
on_exists: version            # overwrite | append | version
auto-apply-learnings: false   # consent policy, see B.4
outputs: [target_folder, filename_template, on_exists]
```

Body: prose explaining each field and instructing the agent to ask the user for
any empty/missing field, then remember the answer (Part B).

### A.3 The writer node — structured target

`tool: write_note` nodes express their target as flat scalars, not a `params`
map:

```yaml
class: WorkflowNode
node_type: tool
tool: write_note
target_folder: "{{target_folder}}"        # from the config node
filename_template: "{{filename_template}}"
on_exists: "{{on_exists}}"
outputs: [saved_path]
```

`on_exists` is **agent-interpreted** (the engine does not enforce it):
- `overwrite` — replace an existing file at the target.
- `append` — append the rendered body to an existing file.
- `version` — write a numbered variant (e.g. ` (2)`) rather than overwrite.

### A.4 Lint contract for `formatter`

Minimal, honest: a `formatter` node SHOULD declare a non-empty `outputs` (the
var it produces). This is the only structural rule the linter enforces for the
type beyond the universal `valid-node-type` check. The linter does NOT validate
template contents or `{{var}}` resolution — that is the agent's runtime job.

### A.5 Variable namespace

Workflow context is one **flat namespace**. `config` outputs and node outputs
share it. On a name collision, the most-recently-written value wins (later
nodes overwrite earlier ones), consistent with the existing stepper model.
Authors should give config outputs distinct names (`target_folder`, not a
generic `path`) to avoid surprise. This is a documented convention, not an
enforced rule.

## Part B — Self-improving workflows (remember / learn)

### B.1 Definition

**"Remember" means: the agent updates the workflow so the learned thing is
reflected in the workflow's own definition.** Not an external memory store —
the canvas and node-notes are edited in place. Run the workflow, it learns, the
files change, the next run starts from what it learned.

### B.2 Writable scope — everything

Every part of a workflow is subject to a learn action: any node's frontmatter,
any node's body (prompt instructions, formatter templates), and the canvas
graph itself (adding/removing nodes, rewiring edges). There is no author-only
sanctuary in the file format. Trust is managed by **provenance + consent**
(B.3, B.4), not by locking regions.

### B.3 Learn triggers

Three moments, all in scope:

1. **Gap-resolution** — a required field/variable is empty or unresolved; the
   agent asks the user and records the answer. (Lowest risk; the config/target
   case in Part A.)
2. **Correction** — a run produced a wrong result, the user corrects it, and
   the agent absorbs the fix into the responsible node (e.g. tightening a
   prompt that mis-summarised).
3. **Proactive refinement** — the agent proposes an improvement to a prompt,
   template, or graph it judges suboptimal, unprompted.

### B.4 Consent — the `auto-apply-learnings` flag

Consent is a **property of the workflow**, read from a single workflow-level
setting: the `auto-apply-learnings` field on the workflow's canonical `config`
node (if multiple config nodes exist, the first in walk order is canonical).

- **`auto-apply-learnings: true`** → every learn-write applies and commits
  immediately, no prompt. The user reviews after the fact via git history.
- **`auto-apply-learnings: false` OR absent** → the agent shows the user the
  diff and waits for explicit OK before writing and committing.

**Safe by default:** a workflow with no flag gets the cautious, confirm-first
behaviour. Silent self-modification is strictly opt-in.

### B.5 Provenance — a git commit per learn-write

Each learn-write is its own vault commit with a structured message; nodes
themselves carry no bookkeeping fields. The git history is the audit trail and
the revert path.

- **Message form:** `learn(<workflow-name>): <what changed>` — e.g.
  `learn(meeting-followup): set target_folder=Meetings/Follow-ups (gap)`.
  Include the trigger class (`gap` | `correction` | `proactive`).
- **One write = one commit.** A learn-write must not be bundled with unrelated
  changes.
- **Vault-automation interaction (known constraint):** this vault runs an
  automatic `vault backup` commit hook. A learn-write must land as a distinct
  commit before the next backup sweep, so the structured message survives in
  history rather than being absorbed into a generic backup commit. The
  implementation plan must define how the agent commits the learn-write
  explicitly (stage only the changed workflow files, commit with the structured
  message) rather than relying on the backup automation.
- **Revertibility:** any drift is one `git revert <sha>` away; this is the
  primary safety net that makes "everything is writable" acceptable.

### B.6 Safe writes

Learn-writes that touch frontmatter MUST be surgical: set/replace the target
key and preserve every other frontmatter line and the body byte-for-byte. This
reuses the discipline already implemented in
`setNodeTypeInFrontmatter` (core) — a single-key surgical replace — rather than
rewriting the note. This directly avoids the known hazard where a naive
note-write drops the rest of the YAML.

Graph edits (adding/removing nodes, rewiring edges) MUST preserve unrelated
canvas keys and the `perspecta.workflow` marker, consistent with the
merge-on-write rule from the discovery spec.

## Part C — Where learning is instructed

The agent's learn behaviour is **instruction, not engine code** — the agent IS
the runtime (consistent with the discovery spec). It lives in the
`/perspecta:workflow` command file (`.claude/commands/perspecta/workflow.md`,
Phase 1.6) and in each learnable node's body. The command instructs the agent
to:

1. Walk the workflow node by node (existing behaviour).
2. At any node, on encountering an unresolved field/variable (gap), or after a
   user correction, or when it judges a proactive improvement worthwhile:
   a. Determine the consent policy from the canonical `config` node's
      `auto-apply-learnings`.
   b. If confirm-first: show the precise diff (which file, which field/body/
      edge, old→new) and wait for OK.
   c. Apply the change with a safe surgical write (B.6).
   d. Commit it as its own `learn(...)` commit (B.5).
3. Continue the walk using the now-updated workflow.

**Dependency:** Phase 1.6's command file is not yet installed in the target
vault. The learn instructions are authored as part of that command. Until 1.6
ships, the config/target gap-resolution behaviour is described in the node
bodies (already present in the `meeting-followup` example) so a session-agent
can honour it manually.

## Part D — Example (already shipped)

The `meeting-followup` workflow demonstrates Part A and the gap-resolution case
of Part B:

```
start → config → read → draft → review ⇄(refine) / →(done) format → save → end
```

- `00-config.md` — `config` node with `target_folder`, `filename_template`,
  `on_exists`, instructing ask-and-remember on missing fields.
- `05-format.md` — `formatter` node, template in body with `{{summary}}` /
  `{{action_items}}` placeholders, outputs `formatted`.
- `06-save.md` — `tool: write_note` with structured target scalars, writes the
  pre-rendered `formatted`.

Lints `ok: true`; colors consistent with core. (Committed 2026-06-04; the
`auto-apply-learnings` flag is added to the example config node as part of
implementing this spec.)

## Scope

### In
- `formatter` node type (core): NODE_TYPES, color, frontmatter fields, lint
  contract A.4. **(Shipped.)**
- `config` node convention with structured target scalars and
  `auto-apply-learnings`. **(Partly shipped — flag pending.)**
- Self-improving model: writable scope (everything), three triggers, git-commit
  provenance, `auto-apply-learnings` consent, surgical/safe writes.
- Learn instructions in the `/perspecta:workflow` command (rides on Phase 1.6).
- `meeting-followup` example updated with `auto-apply-learnings`.

### Out (deferred)
- Engine-side template extraction from the ` ```template ` fence (today: agent
  reads it).
- Engine enforcement of `on_exists` (today: agent-interpreted).
- A structured `learned:` in-file log (rejected in favour of git history;
  could be revisited if cross-tool legibility outside git is needed).
- Automatic conflict handling when two config nodes disagree (resolved by
  "first in walk order is canonical").
- Per-field opt-in learnability (rejected — scope is everything).

## Open questions / deferred

- **Proactive-refinement quality gate:** proactive rewrites are the riskiest
  trigger. Even with confirm-first as the default, what stops noisy or churny
  proposals? Likely an authoring guideline (propose only on observed failure,
  not on style preference) rather than a hard rule. To be refined when 1.6's
  command is authored.
- **Backup-hook race:** the exact mechanism for landing a `learn(...)` commit
  ahead of the vault backup sweep is an implementation detail for the plan.
- **Diff presentation for graph edits:** showing a readable diff for an edge
  rewire (vs. a frontmatter scalar) needs a concrete format; deferred to the
  plan.
