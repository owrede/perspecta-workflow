export class ContextBag {
  private store = new Map<string, unknown>();
  set(name: string, value: unknown): void { this.store.set(name, value); }
  get(name: string): unknown { return this.store.get(name); }
  has(name: string): boolean { return this.store.has(name); }
  all(): Record<string, unknown> { return Object.fromEntries(this.store); }
}

const PLACEHOLDER = /\{\{\s*([\w.-]+)\s*\}\}/g;

export function resolveTemplateDetailed(
  text: string,
  ctx: ContextBag,
): { text: string; missing: string[] } {
  const missing: string[] = [];
  const out = text.replace(PLACEHOLDER, (whole, name: string) => {
    if (ctx.has(name)) return String(ctx.get(name));
    if (!missing.includes(name)) missing.push(name);
    return whole; // leave untouched
  });
  return { text: out, missing };
}

export function resolveTemplate(text: string, ctx: ContextBag): string {
  return resolveTemplateDetailed(text, ctx).text;
}
