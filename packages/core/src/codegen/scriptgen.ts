import type { PflowDocument } from "../pflow/schema.js";

/** JSON.stringify yields a spec-compliant double-quoted JS string literal with
 *  correct escaping of quotes, backslashes, and control chars. */
export function jsString(value: string): string {
  return JSON.stringify(value);
}

/** Render `export const meta = {...}` as a pure literal. Phases are the
 *  distinct, declaration-ordered `phase` annotations on nodes. */
export function renderMeta(doc: PflowDocument): string {
  const phases: string[] = [];
  for (const n of doc.nodes) {
    if (n.phase && !phases.includes(n.phase)) phases.push(n.phase);
  }
  const phaseLines = phases.map((p) => `    { title: ${jsString(p)} },`).join("\n");
  return [
    "export const meta = {",
    `  name: ${jsString(doc.workflow.name)},`,
    `  description: ${jsString(doc.workflow.description)},`,
    "  phases: [",
    phaseLines,
    "  ],",
    "}",
  ].join("\n");
}
