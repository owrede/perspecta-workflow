import { classifyToolGroup, type McpRegistryTool, type McpToolAnnotations } from "@perspecta/core";
import type { McpJsonServer } from "./mcpJson.js";

/** A tool as returned by an MCP tools/list probe. */
export interface ProbedTool {
  name: string;
  description?: string;
  annotations?: McpToolAnnotations;
}

/** Host-agnostic probe: launch a server, return its tools. Impl chosen per host. */
export interface McpProbe {
  probe(server: McpJsonServer): Promise<ProbedTool[]>;
}

/** Convert probed tools into registry tool entries: classify group (annotation
 *  source when a hint decided it, else heuristic), default permission = ask. Pure. */
export function probedToolsToRegistry(tools: ProbedTool[]): Record<string, McpRegistryTool> {
  const out: Record<string, McpRegistryTool> = {};
  for (const t of tools) {
    const group = classifyToolGroup(t.name, t.annotations);
    const decidedByAnnotation = t.annotations?.readOnlyHint === true || t.annotations?.destructiveHint === true;
    out[t.name] = {
      description: t.description,
      group,
      groupSource: decidedByAnnotation ? "annotation" : "heuristic",
      permission: "ask",
    };
  }
  return out;
}

/** Node-side stdio probe using the MCP SDK client. Obsidian/Electron provides
 *  Node at runtime; the SDK is marked external in the plugin build. Only stdio
 *  servers are supported in this first version; others reject with a clear error. */
export class NodeMcpProbe implements McpProbe {
  async probe(server: McpJsonServer): Promise<ProbedTool[]> {
    if (server.transport !== "stdio") {
      throw new Error(`Only stdio MCP servers can be probed in this version (got "${server.transport}")`);
    }
    if (!server.command) {
      throw new Error(`Stdio server "${server.name}" has no command — check .mcp.json`);
    }
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
    const transport = new StdioClientTransport({ command: server.command, args: server.args ?? [], env: server.env });
    const client = new Client({ name: "perspecta-workflow-probe", version: "1.0.0" });
    try {
      await client.connect(transport);
      // v1 limitation: listTools() returns only the first page; a server that
      // paginates its tools (nextCursor) would have later pages unregistered.
      const res = await client.listTools();
      return res.tools.map((t) => ({
        name: t.name,
        description: t.description,
        annotations: t.annotations as McpToolAnnotations | undefined,
      }));
    } finally {
      await client.close().catch(() => {});
    }
  }
}
