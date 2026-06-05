export interface EmitViolation { token: string; index: number; }
export interface EmitLintResult { ok: boolean; violations: EmitViolation[]; }

/** Banned tokens that would break the resume-cache (non-determinism) or the
 *  sandbox (fs/shell/network/require). `new Date(` is banned only when argless. */
const BANNED: { token: string; re: RegExp }[] = [
  { token: "Date.now", re: /\bDate\.now\b/ },
  { token: "Math.random", re: /\bMath\.random\b/ },
  { token: "new Date", re: /\bnew\s+Date\s*\(\s*\)/ },
  { token: "require", re: /\brequire\s*\(/ },
  { token: "import(", re: /\bimport\s*\(/ },
  { token: "fetch", re: /\bfetch\s*\(/ },
  { token: "fs.", re: /\bfs\./ },
];

/** Scan emitted workflow code for non-deterministic / sandbox-illegal tokens.
 *  A hit must FAIL the export. */
export function lintEmittedScript(code: string): EmitLintResult {
  const violations: EmitViolation[] = [];
  for (const { token, re } of BANNED) {
    const m = re.exec(code);
    if (m) violations.push({ token, index: m.index });
  }
  return { ok: violations.length === 0, violations };
}
