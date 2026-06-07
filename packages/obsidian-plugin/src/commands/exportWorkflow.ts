import { generateClaudeCodeWorkflow, type PflowDocument } from "@perspecta/core";

/** The slice of Obsidian's vault adapter this helper needs. Declared structurally
 *  so the function is unit-testable with a fake and reusable from both the plugin
 *  command (main.ts) and the editor view (view.ts) without importing Obsidian. */
export interface WorkflowWriteAdapter {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  write(path: string, data: string): Promise<void>;
}

/** Generate the Claude Code dynamic workflow for `doc` and write it to
 *  `.claude/workflows/<workflow.name>.js`, creating the directories if needed.
 *  Returns the vault-relative path written. Throws (with the validation/codegen
 *  message) if the document does not compile — callers surface that to the user.
 *
 *  This is the single source of truth for "export a .pflow to a runnable Claude
 *  Code workflow": the palette command and the inspector Export button both call
 *  it, so the output and destination never drift. */
export async function exportClaudeCodeWorkflowFile(
  adapter: WorkflowWriteAdapter,
  doc: PflowDocument,
): Promise<string> {
  // Generate first: if the document is invalid, throw BEFORE touching the
  // filesystem so a failed export never leaves a half-written or stale file.
  const code = generateClaudeCodeWorkflow(doc);
  if (!(await adapter.exists(".claude"))) await adapter.mkdir(".claude");
  const dir = ".claude/workflows";
  if (!(await adapter.exists(dir))) await adapter.mkdir(dir);
  const path = `${dir}/${doc.workflow.name}.js`;
  await adapter.write(path, code);
  return path;
}
