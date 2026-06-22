#!/usr/bin/env node
// Perspecta Workflow — export fidelity checker (the optimization loop).
//
// Verifies that the Claude Code workflow EXPORT of a .pflow document is a
// faithful translation of the visual design. Three tiers:
//
//   Tier 1  deterministic property checks  (always)
//   Tier 2  whole-corpus sweep over many .pflow files  (always — pass a dir)
//   Tier 3  LLM judge bundle               (--judge: emits a bundle for an
//                                            agent to grade; this script does
//                                            NOT call an LLM itself)
//
// Determinism lives here (parse → validate → codegen → emit-lint → fidelity).
// LLM grading lives in the /perspecta-check-export skill, which reads the
// --judge bundles this script writes and spawns judge agents over them.
//
// Usage:
//   node scripts/check-export.mjs <path> [<path> ...] [--judge] [--json] [--quiet]
//
//   <path>   a .pflow file, OR a directory scanned recursively for *.pflow
//            (e.g. a vault root, or a vault's _agents/ folder).
//   --judge  also write a judge bundle per workflow to .perspecta/judge/ next
//            to this script's cwd, for Tier-3 LLM grading by the skill.
//   --json   machine-readable report on stdout (suppresses the pretty output).
//   --quiet  only print failures and the summary line.
//
// Exit code: 0 if every workflow passes Tier 1+2 with zero errors; 1 otherwise.

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve @perspecta/core from the repo it ships in (built dist).
const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = resolve(HERE, "..");
const core = await import(join(REPO, "packages/core/dist/index.js"));
const {
  parsePflow,
  validatePflow,
  mcpLints,
  generateClaudeCodeWorkflow,
  checkExportFidelity,
} = core;

// ── arg parsing ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = new Set(argv.filter((a) => a.startsWith("--")));
const inputs = argv.filter((a) => !a.startsWith("--"));
const JSON_OUT = flags.has("--json");
const QUIET = flags.has("--quiet");
const JUDGE = flags.has("--judge");

if (inputs.length === 0) {
  process.stderr.write(
    "usage: node scripts/check-export.mjs <file-or-dir> [...] [--judge] [--json] [--quiet]\n",
  );
  process.exit(2);
}

// An empty registry: mcpLints reports cold/not-whitelisted for any mcp node, but
// only mcp-server-missing / memory-contract-missing / memory-input-unbound are
// BLOCKING for export. The fidelity layer needs no registry at all.
const REGISTRY = {};

// ── discovery: expand files + dirs to a sorted list of .pflow paths ────────────
function collectPflow(p) {
  const abs = resolve(p);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return { missing: [abs], files: [] };
  }
  if (st.isFile()) {
    return extname(abs) === ".pflow" ? { missing: [], files: [abs] } : { missing: [], files: [] };
  }
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      // Skip noise dirs that never hold authored workflows.
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        walk(join(dir, entry.name));
      } else if (extname(entry.name) === ".pflow") {
        files.push(join(dir, entry.name));
      }
    }
  };
  walk(abs);
  return { missing: [], files };
}

const allFiles = [];
const missing = [];
for (const inp of inputs) {
  const { files, missing: m } = collectPflow(inp);
  allFiles.push(...files);
  missing.push(...m);
}
const files = [...new Set(allFiles)].sort();

// ── per-workflow check ─────────────────────────────────────────────────────────
function checkOne(path) {
  const rel = relative(REPO, path).startsWith("..") ? path : relative(REPO, path);
  const out = { path: rel, name: null, ok: false, stage: null, findings: [], lints: [] };
  let doc;
  try {
    doc = parsePflow(readFileSync(path, "utf8"));
  } catch (e) {
    out.stage = "parse";
    out.findings.push({ check: "parse", severity: "error", message: String(e.message ?? e) });
    return { out, doc: null, code: null };
  }
  out.name = doc.workflow?.name ?? null;

  const validation = validatePflow(doc);
  if (!validation.ok) {
    out.stage = "validate";
    for (const e of validation.errors)
      out.findings.push({ check: e.rule, severity: "error", message: e.message, nodeId: e.nodeId });
    return { out, doc, code: null };
  }

  // mcpLints are advisory here (no live registry); surface as warnings except the
  // ones generateClaudeCodeWorkflow itself will throw on.
  for (const e of mcpLints(doc, REGISTRY)) {
    const blocking = ["mcp-server-missing", "memory-contract-missing", "memory-input-unbound"].includes(e.rule);
    out.lints.push({ check: e.rule, severity: blocking ? "error" : "warn", message: e.message, nodeId: e.nodeId });
  }

  let code;
  try {
    code = generateClaudeCodeWorkflow(doc);
  } catch (e) {
    out.stage = "codegen";
    out.findings.push({ check: "codegen", severity: "error", message: String(e.message ?? e) });
    return { out, doc, code: null };
  }

  const report = checkExportFidelity(doc, code);
  out.stage = "fidelity";
  out.findings.push(...report.findings);
  const blockingLints = out.lints.filter((l) => l.severity === "error");
  out.ok = report.ok && blockingLints.length === 0;
  return { out, doc, code };
}

// ── Tier 3 judge bundle ──────────────────────────────────────────────────────
// A human-readable description of the design intent, derived from the doc, paired
// with the emitted script. The skill feeds {intent, design, script} to a judge
// agent that answers: "does the script faithfully realise this design?".
function designSummary(doc) {
  const lines = [];
  lines.push(`Workflow: ${doc.workflow.name}`);
  lines.push(`Description: ${doc.workflow.description}`);
  lines.push("");
  lines.push("Nodes (declaration order):");
  for (const n of doc.nodes) {
    const ins = n.inputs.map((p) => p.name).join(", ");
    const outs = n.outputs.map((p) => p.name).join(", ");
    const cfg = n.config && Object.keys(n.config).length ? ` config=${JSON.stringify(n.config)}` : "";
    lines.push(`  - [${n.kind}] ${n.id} "${n.label}"  in:(${ins}) out:(${outs})${cfg}`);
    if (n.prompt) lines.push(`      prompt: ${n.prompt.replace(/\s+/g, " ").slice(0, 300)}`);
  }
  lines.push("");
  lines.push("Wires (data flow):");
  for (const w of doc.wires) {
    lines.push(`  - ${w.from.nodeId}.${w.from.portId} -> ${w.to.nodeId}.${w.to.portId}`);
  }
  return lines.join("\n");
}

function writeJudgeBundle(doc, code) {
  const dir = join(process.cwd(), ".perspecta", "judge");
  mkdirSync(dir, { recursive: true });
  const bundlePath = join(dir, `${doc.workflow.name}.judge.md`);
  const body = [
    `# Judge bundle: ${doc.workflow.name}`,
    "",
    "Grade whether the EMITTED SCRIPT faithfully realises the DESIGN below.",
    "Answer with a verdict line `JUDGE: pass` or `JUDGE: fail`, then list any",
    "behavioural divergence (a node whose emitted prompt no longer does what its",
    "kind/label implies; a gate that does not gate; a step whose intent is lost).",
    "",
    "## Design intent (from the .pflow document)",
    "",
    "```",
    designSummary(doc),
    "```",
    "",
    "## Emitted Claude Code workflow script",
    "",
    "```javascript",
    code,
    "```",
    "",
  ].join("\n");
  writeFileSync(bundlePath, body);
  return relative(process.cwd(), bundlePath);
}

// ── run ───────────────────────────────────────────────────────────────────────
const results = [];
const bundles = [];
for (const f of files) {
  const { out, doc, code } = checkOne(f);
  results.push(out);
  if (JUDGE && doc && code) bundles.push(writeJudgeBundle(doc, code));
}

const failed = results.filter((r) => !r.ok);
const allOk = failed.length === 0 && missing.length === 0;

if (JSON_OUT) {
  process.stdout.write(
    JSON.stringify({ ok: allOk, checked: results.length, missing, results, bundles }, null, 2) + "\n",
  );
  process.exit(allOk ? 0 : 1);
}

// pretty output
const C = { red: "\x1b[31m", yellow: "\x1b[33m", green: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m", reset: "\x1b[0m" };
const sev = (s) => (s === "error" ? `${C.red}error${C.reset}` : `${C.yellow}warn${C.reset}`);

for (const m of missing) process.stdout.write(`${C.red}missing${C.reset}  ${m}\n`);

for (const r of results) {
  const all = [...r.findings, ...r.lints];
  const errs = all.filter((f) => f.severity === "error");
  const warns = all.filter((f) => f.severity === "warn");
  if (r.ok && warns.length === 0 && QUIET) continue;
  const mark = r.ok ? `${C.green}ok${C.reset}` : `${C.red}FAIL${C.reset}`;
  const label = r.name ? `${r.name} ${C.dim}(${r.path})${C.reset}` : r.path;
  process.stdout.write(`\n${mark}  ${C.bold}${label}${C.reset}  ${C.dim}[${r.stage}]${C.reset}\n`);
  for (const f of [...errs, ...warns]) {
    const where = f.nodeId ? ` ${C.dim}@${f.nodeId}${C.reset}` : "";
    process.stdout.write(`  ${sev(f.severity)} ${C.dim}${f.check}${C.reset}${where}: ${f.message}\n`);
  }
}

if (bundles.length) {
  process.stdout.write(`\n${C.dim}Tier-3 judge bundles written:${C.reset}\n`);
  for (const b of bundles) process.stdout.write(`  ${b}\n`);
  process.stdout.write(`${C.dim}Have the /perspecta-check-export skill grade these with judge agents.${C.reset}\n`);
}

const errCount = results.reduce((n, r) => n + [...r.findings, ...r.lints].filter((f) => f.severity === "error").length, 0);
process.stdout.write(
  `\n${allOk ? C.green : C.red}${allOk ? "PASS" : "FAIL"}${C.reset}  ` +
    `${results.length} workflow(s) checked, ${failed.length} failing, ${errCount} error finding(s)` +
    (missing.length ? `, ${missing.length} path(s) missing` : "") +
    "\n",
);
process.exit(allOk ? 0 : 1);
