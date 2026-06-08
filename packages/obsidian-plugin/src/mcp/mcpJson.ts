/** A server entry as declared in .mcp.json (the subset the probe needs). */
export interface McpJsonServer {
  name: string;
  transport: "stdio" | "http" | "sse" | "ws" | "unknown";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

/** Parse .mcp.json text into a server list. Never throws — returns [] on any
 *  malformed input (a missing/invalid .mcp.json just means no servers). */
export function parseMcpJsonServers(text: string): McpJsonServer[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  const servers = (raw as { mcpServers?: Record<string, Record<string, unknown>> })?.mcpServers;
  if (!servers || typeof servers !== "object") return [];
  return Object.entries(servers).map(([name, cfg]) => {
    const t = (cfg.type as string) ?? (cfg.command ? "stdio" : cfg.url ? "http" : "unknown");
    const transport = (["stdio", "http", "sse", "ws"].includes(t) ? t : "unknown") as McpJsonServer["transport"];
    return {
      name, transport,
      command: cfg.command as string | undefined,
      args: cfg.args as string[] | undefined,
      env: cfg.env as Record<string, string> | undefined,
      url: cfg.url as string | undefined,
    };
  });
}
