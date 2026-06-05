import { parse as parseYaml } from "yaml";

/** A leading `---`…`---` block split from the body that follows it.
 *  `raw` is the unparsed frontmatter text; `body` is everything after the
 *  closing fence. Returns null when the text has no opening frontmatter block. */
export interface SplitFrontmatter {
  raw: string;
  body: string;
}

/** CRLF-tolerant frontmatter fence.
 *  Matches a leading `---` block and captures (1) its inner text and (2) the
 *  body after the closing `---`. Accepts both `\n` and `\r\n` line endings so a
 *  note written with Windows newlines parses identically to a Unix one. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/;

/** Split a `---`-fenced frontmatter block from its body without parsing it.
 *  Use this when you need the raw frontmatter text (e.g. a surgical line edit);
 *  use {@link parseNoteFrontmatter} when you want the YAML parsed to an object. */
export function splitFrontmatter(text: string): SplitFrontmatter | null {
  const m = text.match(FRONTMATTER_RE);
  if (!m) return null;
  return { raw: m[1], body: m[2] ?? "" };
}

/** Parse a `---`-fenced frontmatter block into a typed object plus its body.
 *  Returns null when there is no frontmatter block. CRLF-tolerant. */
export function parseNoteFrontmatter<T>(text: string): { frontmatter: T; body: string } | null {
  const split = splitFrontmatter(text);
  if (!split) return null;
  return { frontmatter: parseYaml(split.raw) as T, body: split.body };
}

/** Read a flat `key: value` frontmatter block into a string map.
 *  Nested YAML is not interpreted — values are kept as their raw trimmed text.
 *  Good enough for the flat frontmatter the skill generators emit, where this
 *  drives generated-skill pruning. Returns `{}` when there is no frontmatter. */
export function readFlatFrontmatter(text: string): Record<string, string> {
  const split = splitFrontmatter(text);
  if (!split) return {};
  const out: Record<string, string> = {};
  for (const line of split.raw.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}
