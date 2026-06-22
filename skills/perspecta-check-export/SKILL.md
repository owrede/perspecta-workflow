---
name: perspecta-check-export
description: Use when the user asks to verify, check, validate, or optimize a Perspecta Workflow export — i.e. confirm that the Claude Code workflow generated from a .pflow document faithfully does what the visual design intends. Triggers on "check the export", "is the workflow export correct", "run the export checks", "optimize the workflow".
---

# Check Perspecta Workflow export fidelity (the optimization loop)

A `.pflow` document (the visual design) is compiled to a Claude Code workflow
script at `.claude/workflows/<name>.js`. This skill verifies the generated
script is a **faithful translation** of the design — not just syntactically
valid, but behaviorally equivalent to what the diagram says.

Three layers already guarantee the *output* is well-formed (schema parse,
`validatePflow`, codegen, emit-lint). This loop adds the missing layer:
**semantic equivalence** between design and emit.

## How to run

The deterministic checks (Tier 1) and the whole-corpus sweep (Tier 2) live in a
CLI in the perspecta-workflow repo. Run it against a single `.pflow` file, or a
directory scanned recursively (e.g. a vault's `_agents/` folder or the vault
root):

```
node scripts/check-export.mjs <file-or-dir> [...] [--judge] [--json] [--quiet]
```

- Exit 0 = every workflow passes Tier 1+2 with zero errors; non-zero = failures.
- `--judge` also writes a Tier-3 judge bundle per workflow under
  `.perspecta/judge/<name>.judge.md` (design intent + emitted script, paired).
- Build `@perspecta/core` first if `packages/core/dist` is stale
  (`npm run build --workspace @perspecta/core`); the CLI checks the BUILT output.

Report the findings verbatim. Each finding names the check, the offending node,
and what the script does vs. what the design intends.

## Tier 3 — LLM judge (this skill's job)

The CLI cannot grade semantics it can't express as a rule, so for each
`.perspecta/judge/<name>.judge.md` bundle, spawn a judge agent:

> Read the bundle. Grade whether the EMITTED SCRIPT faithfully realises the
> DESIGN. Be adversarial and node-specific: does each node's emitted prompt still
> do what its kind + label imply? Does every gate actually gate? Does each wire
> deliver the data the design promises? End with a single line `JUDGE: pass` or
> `JUDGE: fail`, then list any behavioral divergence.

Run the judges in parallel (one per bundle). A `JUDGE: fail` is a real defect —
**verify it against the emitted code before reporting** (the judge can be wrong);
quote the offending lines.

## The optimization loop

1. Run the CLI over every `.pflow` (Tiers 1+2). Fix or report each error.
2. Run the judges (Tier 3) over the bundles. For each genuine `JUDGE: fail`,
   confirm it in the emitted code.
3. When a judge finds a defect a deterministic rule *could* catch, promote it:
   add a check to `packages/core/src/codegen/check-export.ts` so the next run
   catches it for free. That is how the loop tightens over time.
4. Re-run until Tier 1+2 are clean and the judges pass.

## What the deterministic checks cover

`node-emits-variable`, `node-label-present`, `wire-realized`, `output-returns`,
`eval-block-on-fail`, `verdict-instruction`, `branch-arm-present`,
`branch-arm-input-data`, `split-pipeline`, `loop-bounded`, `mcp-agent-type`,
`contract-tool-call`, `typed-token-serializer`, `meta-phases`, `no-forward-ref`.

These check the EMIT against the DESIGN — distinct from `validatePflow` (which
checks the document) and emit-lint (which checks the output is sandbox-safe).

Never overwrite a `.pflow` document or codegen source unless the user explicitly
asks for authoring or a fix.
