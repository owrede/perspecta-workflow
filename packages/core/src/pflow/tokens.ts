import type { NodeKind } from "./schema.js";

/** Token grammar: {{in:NAME}} / {{out:NAME}}, NAME = [A-Za-z_][A-Za-z0-9_-]*.
 *  No whitespace inside the braces. Build a FRESH RegExp per scan (the global
 *  flag makes them stateful via lastIndex). Shared by the prompt highlighter so
 *  the grammar has a single source of truth. */
export const TOKEN_SOURCE = "\\{\\{(in|out):([A-Za-z_][A-Za-z0-9_-]*)\\}\\}";
export function tokenRegExp(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g");
}

export interface PromptTokens {
  inputs: string[];
  outputs: string[];
}

/** Ordered, de-duplicated input/output token names found in a prompt. */
export function parsePromptTokens(prompt: string): PromptTokens {
  const inputs: string[] = [];
  const outputs: string[] = [];
  if (!prompt) return { inputs, outputs };
  for (const m of prompt.matchAll(tokenRegExp())) {
    const dir = m[1];
    const name = m[2];
    const bucket = dir === "in" ? inputs : outputs;
    if (!bucket.includes(name)) bucket.push(name);
  }
  return { inputs, outputs };
}

/** Protected structural port ids per kind: ids the prompt-token derivation must
 *  never remove. agent → empty (tokens fully own its ports); structural kinds →
 *  their default-port ids, so tokens only ADD. */
export const STRUCTURAL_PORT_IDS: Record<NodeKind, { inputs: string[]; outputs: string[] }> = {
  input: { inputs: [], outputs: ["out"] },
  output: { inputs: ["in"], outputs: [] },
  agent: { inputs: [], outputs: [] },
  split: { inputs: ["in"], outputs: ["out"] },
  join: { inputs: ["in"], outputs: ["out"] },
  loop: { inputs: ["in"], outputs: ["out"] },
  verify: { inputs: ["in"], outputs: ["out"] },
  synthesize: { inputs: ["in"], outputs: ["out"] },
  branch: { inputs: ["in"], outputs: ["out"] },
  script: { inputs: ["in"], outputs: ["out"] },
};
