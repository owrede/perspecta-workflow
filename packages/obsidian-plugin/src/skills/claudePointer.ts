export const POINTER_BEGIN = "<!-- perspecta-workflow:begin -->";
export const POINTER_END = "<!-- perspecta-workflow:end -->";

const BLOCK = `${POINTER_BEGIN}
**Workflows:** This vault defines Perspecta workflows as \`.pflow\` documents
under \`_agents/\` and as generated skills under \`.claude/skills/\`. Before a
multi-step task that matches a workflow's "when to use", offer to run it (see the
\`perspecta-workflow\` skill).
${POINTER_END}`;

/** Insert or replace the marked pointer block. Idempotent. */
export function upsertPointerBlock(existing: string): string {
  const begin = existing.indexOf(POINTER_BEGIN);
  if (begin !== -1) {
    const end = existing.indexOf(POINTER_END, begin);
    if (end !== -1) {
      const before = existing.slice(0, begin);
      const after = existing.slice(end + POINTER_END.length);
      return before + BLOCK + after;
    }
  }
  const sep = existing.length === 0 || existing.endsWith("\n") ? "" : "\n";
  const lead = existing.length === 0 ? "" : "\n";
  return existing + sep + lead + BLOCK + "\n";
}
