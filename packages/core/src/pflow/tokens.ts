/** The value-shape a token declares. Only these change generated code:
 *  string → bare interpolation; json → JSON.stringify; table → Markdown table.
 *  (filename/path/note-name are all strings to the LLM, so they are NOT types.) */
export type TokenType = "string" | "json" | "table";
export const TOKEN_TYPES: TokenType[] = ["string", "json", "table"];

/** Token grammar (suffix form): {{in:NAME}} / {{out:NAME}} default to string;
 *  {{in:NAME:TYPE}} / {{out:NAME:TYPE}} carry an explicit type. NAME =
 *  [A-Za-z_][A-Za-z0-9_-]*; TYPE is one of TOKEN_TYPES. No whitespace inside the
 *  braces. Unknown types do not match (the whole token is ignored). Build a
 *  FRESH RegExp per scan (the global flag makes them stateful via lastIndex).
 *  Shared by the prompt highlighter so the grammar has one source of truth. */
export const TOKEN_SOURCE = "\\{\\{(in|out):([A-Za-z_][A-Za-z0-9_-]*)(?::(string|json|table))?\\}\\}";
export function tokenRegExp(): RegExp {
  return new RegExp(TOKEN_SOURCE, "g");
}

/** One parsed token: its port name and declared value-type. */
export interface TokenPort {
  name: string;
  type: TokenType;
}

export interface PromptTokens {
  inputs: TokenPort[];
  outputs: TokenPort[];
}

/** Ordered, de-duplicated input/output tokens found in a prompt. De-duplication
 *  is by name within a direction; the FIRST occurrence's type wins. */
export function parsePromptTokens(prompt: string): PromptTokens {
  const inputs: TokenPort[] = [];
  const outputs: TokenPort[] = [];
  if (!prompt) return { inputs, outputs };
  for (const m of prompt.matchAll(tokenRegExp())) {
    const dir = m[1];
    const name = m[2];
    const type = (m[3] as TokenType | undefined) ?? "string";
    const bucket = dir === "in" ? inputs : outputs;
    if (!bucket.some((t) => t.name === name)) bucket.push({ name, type });
  }
  return { inputs, outputs };
}

/** The PortSchema type that best represents a token type, for the derived port's
 *  `schema.type`. The TOKEN type keyword (carried separately on derivation) is
 *  what actually drives codegen; this is just the closest schema shape. */
export function portSchemaTypeForToken(type: TokenType): "string" | "object" | "array" {
  if (type === "json") return "object";
  if (type === "table") return "array";
  return "string";
}
