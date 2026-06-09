import type { PortSchema } from "@perspecta/core";

/**
 * contract-ui — pure helpers behind the contract inspector's pin editors.
 * A pinned contract input is edited as TEXT; these convert between the text
 * field and the typed literal stored in `config.contractInputs[name]`,
 * per the input's PortSchema. Unit-tested without Svelte
 * (contract-inspector-helpers.test.ts), mirroring mcp-inspector-helpers.
 */

export type CoerceResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse a pin editor's text into a typed literal for the given schema.
 *  string → as-is; number → finite Number; boolean → true/false; array/object/
 *  any → JSON (an `any` input also accepts plain text as a string fallback). */
export function coerceContractLiteral(text: string, schema: PortSchema): CoerceResult {
  const t = schema.type;
  if (t === "string") return { ok: true, value: text };
  if (t === "number") {
    const n = Number(text.trim());
    return Number.isFinite(n) && text.trim() !== "" ? { ok: true, value: n } : { ok: false, error: "not a number" };
  }
  if (t === "boolean") {
    const v = text.trim().toLowerCase();
    if (v === "true") return { ok: true, value: true };
    if (v === "false") return { ok: true, value: false };
    return { ok: false, error: "true or false" };
  }
  // array / object / any: JSON first.
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    if (t === "any") return { ok: true, value: text }; // untyped: keep the raw text
    return { ok: false, error: t === "array" ? 'not valid JSON (e.g. ["a", "b"])' : "not valid JSON" };
  }
}

/** Render a stored pinned literal back into the pin editor's text. Strings
 *  render bare; everything else as compact JSON. Undefined → "". */
export function formatContractLiteral(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

/** The dropdown slug for a canonical contract name ("meeting-prep" →
 *  "meeting_prep"), matching vault-memory's vm_* tool slugs. */
export function contractSlug(contract: string): string {
  return contract.replace(/-/g, "_");
}
