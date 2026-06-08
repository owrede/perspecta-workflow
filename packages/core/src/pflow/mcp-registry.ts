import type { PflowDocument } from "./schema.js";

/** Per-tool permission, modelled on the Claude app (Blocked / Ask / Always-allow). */
export type McpToolPermission = "blocked" | "ask" | "allow";

/** Stored permission value: "default" means resolve via the server's groupDefaults. */
export type McpStoredPermission = "default" | McpToolPermission;

/** Read/interactive/write grouping (UI grouping + bulk action only; NOT a runtime semantic). */
export type McpToolGroup = "read" | "interactive" | "write";

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
  permission: McpStoredPermission;
}

export interface McpRegistryServer {
  whitelisted: boolean;
  probe: { status: "cold" | "probing" | "hot" | "failed"; error?: string; probedAt?: string };
  groupDefaults: Record<McpToolGroup, McpToolPermission>;
  tools: Record<string, McpRegistryTool>;
}

export type McpRegistry = Record<string, McpRegistryServer>;

export const DEFAULT_GROUP_DEFAULTS: Record<McpToolGroup, McpToolPermission> = {
  read: "ask", interactive: "ask", write: "ask",
};

export function serverGroupDefaults(server: McpRegistryServer): Record<McpToolGroup, McpToolPermission> {
  return server.groupDefaults ?? DEFAULT_GROUP_DEFAULTS;
}

const READ_VERBS = /^(get|list|search|read|fetch|describe|view|find|query|show)(_|$)|_(get|list|search|read|fetch|describe|view)(_|$)/i;
const WRITE_VERBS = /^(create|update|delete|write|set|add|remove|put|post|patch|insert|upsert|send|rename)(_|$)/i;

/** Classify a tool into read/interactive/write: annotations win; else a name/verb heuristic;
 *  unknown → interactive (the middle bucket). Pure. */
export function classifyToolGroup(name: string, ann?: McpToolAnnotations): McpToolGroup {
  if (ann?.readOnlyHint === true) return "read";
  if (ann?.destructiveHint === true) return "write";
  // If both hints are explicitly present and both false, no annotation is decisive → interactive.
  if (ann && "readOnlyHint" in ann && "destructiveHint" in ann) return "interactive";
  if (READ_VERBS.test(name) && !WRITE_VERBS.test(name)) return "read";
  if (WRITE_VERBS.test(name)) return "write";
  return "interactive"; // unknown → middle bucket
}

/** The tool-name sets a server grant resolves to, for codegen + summaries. */
export interface ServerGrants { allow: string[]; ask: string[]; blocked: string[]; }

/** Partition a server's tools by permission (sorted for determinism). Pure. */
export function resolveServerGrants(server: McpRegistryServer): ServerGrants {
  const allow: string[] = [], ask: string[] = [], blocked: string[] = [];
  for (const [name, t] of Object.entries(server.tools)) {
    (t.permission === "allow" ? allow : t.permission === "ask" ? ask : blocked).push(name);
  }
  const sorted = (a: string[]) => [...a].sort();
  return { allow: sorted(allow), ask: sorted(ask), blocked: sorted(blocked) };
}

/** Set the permission of every tool in a group (bulk action). Immutable. */
export function applyGroupPermission(
  server: McpRegistryServer,
  group: McpToolGroup,
  permission: McpToolPermission,
): McpRegistryServer {
  const tools: Record<string, McpRegistryTool> = {};
  for (const [name, t] of Object.entries(server.tools)) {
    tools[name] = t.group === group ? { ...t, permission } : t;
  }
  return { ...server, tools };
}

/** Resolve a tool's effective permission: if stored as "default", use the server's group default. Pure. */
export function resolveToolPermission(server: McpRegistryServer, toolName: string): McpToolPermission {
  const t = server.tools[toolName];
  if (!t) return "blocked";
  if (t.permission !== "default") return t.permission;
  return serverGroupDefaults(server)[t.group];
}

/** Snapshot tool→permission for a server (stored on an mcp node at export). Pure. */
export function snapshotGrants(server: McpRegistryServer): Record<string, McpToolPermission> {
  const out: Record<string, McpToolPermission> = {};
  for (const name of Object.keys(server.tools)) out[name] = resolveToolPermission(server, name);
  return out;
}

// Permission strength ordering: allow (loosest) > ask > blocked (strictest).
const STRENGTH: Record<McpToolPermission, number> = { allow: 2, ask: 1, blocked: 0 };

/** Tool names whose LOCAL permission is STRICTER than the snapshot expected.
 *  A tool absent locally counts as blocked (strictest). Pure. */
export function isPolicyStricter(
  expected: Record<string, McpToolPermission>,
  local: McpRegistryServer,
): string[] {
  const stricter: string[] = [];
  for (const [name, exp] of Object.entries(expected)) {
    const localPerm = local.tools[name] ? resolveToolPermission(local, name) : "blocked";
    if (STRENGTH[localPerm] < STRENGTH[exp]) stricter.push(name);
  }
  return stricter.sort();
}

export interface ResourceServiceSummary {
  server: string;
  nodeCount: number;
  available: boolean;          // whitelisted + hot
  allow: number; ask: number; blocked: number;
}
export interface WorkflowResourceSummary {
  services: ResourceServiceSummary[];
  allMet: boolean;
}

/** Roll up every mcp node's service against the registry. Pure. */
export function summarizeWorkflowResources(doc: PflowDocument, registry: McpRegistry): WorkflowResourceSummary {
  const counts = new Map<string, number>();
  for (const n of doc.nodes) {
    if (n.kind !== "mcp") continue;
    const s = (n.config?.mcpServer as string | undefined) ?? "(none)";
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  const services: ResourceServiceSummary[] = [];
  for (const [server, nodeCount] of [...counts.entries()].sort()) {
    const reg = registry[server];
    const hot = !!reg && reg.whitelisted && reg.probe.status === "hot";
    const g = hot ? resolveServerGrants(reg) : { allow: [], ask: [], blocked: [] };
    services.push({ server, nodeCount, available: hot, allow: g.allow.length, ask: g.ask.length, blocked: g.blocked.length });
  }
  return { services, allMet: services.every((s) => s.available) };
}
