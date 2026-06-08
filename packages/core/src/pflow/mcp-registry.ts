/** Per-tool permission, modelled on the Claude app (Blocked / Ask / Always-allow). */
export type McpToolPermission = "blocked" | "ask" | "allow";

/** Read/write grouping (UI grouping + bulk action only; NOT a runtime semantic). */
export type McpToolGroup = "read" | "write";

/** Optional MCP tool annotations (many servers omit these). */
export interface McpToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
}

/** A tool as cached in the registry after a probe. */
export interface McpRegistryTool {
  description?: string;
  group: McpToolGroup;
  groupSource: "annotation" | "heuristic" | "user";
  permission: McpToolPermission;
}

export interface McpRegistryServer {
  whitelisted: boolean;
  probe: { status: "cold" | "probing" | "hot" | "failed"; error?: string; probedAt?: string };
  tools: Record<string, McpRegistryTool>;
}

export type McpRegistry = Record<string, McpRegistryServer>;

const READ_VERBS = /^(get|list|search|read|fetch|describe|view|find|query|show)(_|$)|_(get|list|search|read|fetch|describe|view)(_|$)/i;
const WRITE_VERBS = /^(create|update|delete|write|set|add|remove|put|post|patch|insert|upsert|send|move|rename)(_|$)/i;

/** Classify a tool into read/write: annotations win; else a name/verb heuristic;
 *  unknown → write (the safe side). Pure. */
export function classifyToolGroup(name: string, ann?: McpToolAnnotations): McpToolGroup {
  if (ann?.readOnlyHint === true) return "read";
  if (ann?.destructiveHint === true) return "write";
  if (READ_VERBS.test(name) && !WRITE_VERBS.test(name)) return "read";
  if (WRITE_VERBS.test(name)) return "write";
  return "write"; // unknown → safe side
}
