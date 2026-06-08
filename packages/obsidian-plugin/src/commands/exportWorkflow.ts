import { buildWorkflowArtifacts, type PflowDocument, type McpRegistry } from "@perspecta/core";

/** " + N connector agent(s)" suffix for export notices, properly pluralized. */
export function formatConnectorSuffix(count: number): string {
  return count ? ` + ${count} connector agent${count === 1 ? "" : "s"}` : "";
}

/** The slice of Obsidian's vault adapter this helper needs. Declared structurally
 *  so the function is unit-testable with a fake and reusable from both the plugin
 *  command (main.ts) and the editor view (view.ts) without importing Obsidian. */
export interface WorkflowWriteAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
}

export interface ExportResult { workflowPath: string; subagentPaths: string[]; }

/** Generate the Claude Code workflow for `doc` and write it to
 *  `.claude/workflows/<name>.js`, plus one `.claude/agents/<wf>-<node>.md` per
 *  MCP node (granting its server per the registry). Generates BEFORE any write
 *  so an invalid doc throws without leaving a stale file. Returns the paths. */
export async function exportClaudeCodeWorkflowFile(
  adapter: WorkflowWriteAdapter,
  doc: PflowDocument,
  registry: McpRegistry,
): Promise<ExportResult> {
  const { workflowJs, subagents } = buildWorkflowArtifacts(doc, registry); // throws on invalid doc
  if (!(await adapter.exists(".claude"))) await adapter.mkdir(".claude");
  if (!(await adapter.exists(".claude/workflows"))) await adapter.mkdir(".claude/workflows");
  const workflowPath = `.claude/workflows/${doc.workflow.name}.js`;
  await adapter.write(workflowPath, workflowJs);
  const subagentPaths: string[] = [];
  if (subagents.length) {
    if (!(await adapter.exists(".claude/agents"))) await adapter.mkdir(".claude/agents");
    for (const s of subagents) { await adapter.write(s.path, s.content); subagentPaths.push(s.path); }
  }
  return { workflowPath, subagentPaths };
}
