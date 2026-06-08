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

/** Shape the bundled probe CLI (mcp-probe.mjs) prints to stdout. */
interface ProbeCliResult {
  ok: boolean;
  tools?: ProbedTool[];
  error?: string;
}

/** Node-side stdio probe. Spawns the bundled `mcp-probe.mjs` helper as a child
 *  process (which carries the MCP SDK inlined) and reads back the tool list as
 *  JSON. The plugin runs in Obsidian's renderer, which has NO module resolver
 *  for the externalized MCP SDK and cannot host its Node-only stdio client — so
 *  the SDK work must happen in a spawned Node process, never via a renderer
 *  `import()`. Only stdio servers are supported; others reject with a clear error.
 *
 *  @param probeHelperPath absolute path to the bundled mcp-probe.mjs
 *  @param spawnFn injectable child_process.spawn (defaults to node:child_process)
 */
export class NodeMcpProbe implements McpProbe {
  constructor(
    private readonly probeHelperPath: string,
    private readonly spawnFn?: (cmd: string, args: string[]) => import("node:child_process").ChildProcessWithoutNullStreams,
  ) {}

  async probe(server: McpJsonServer): Promise<ProbedTool[]> {
    if (server.transport !== "stdio") {
      throw new Error(`Only stdio MCP servers can be probed in this version (got "${server.transport}")`);
    }
    if (!server.command) {
      throw new Error(`Stdio server "${server.name}" has no command — check .mcp.json`);
    }
    const spawn = this.spawnFn ?? (await import("node:child_process")).spawn;
    const child = spawn("node", [this.probeHelperPath]);
    const request = JSON.stringify({ command: server.command, args: server.args ?? [], env: server.env });

    const result = await new Promise<ProbeCliResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("error", (e: Error) => reject(new Error(`probe helper failed to spawn: ${e.message}`)));
      child.on("close", () => {
        const line = stdout.trim().split("\n").filter(Boolean).pop();
        if (!line) {
          reject(new Error(`probe helper produced no output${stderr ? ` (stderr: ${stderr.trim().slice(0, 200)})` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(line) as ProbeCliResult);
        } catch {
          reject(new Error(`probe helper returned non-JSON: ${line.slice(0, 200)}`));
        }
      });
      child.stdin.write(request);
      child.stdin.end();
    });

    if (!result.ok) {
      throw new Error(result.error ?? "probe failed");
    }
    // v1 limitation: the helper's listTools() returns only the first page; a
    // server that paginates its tools (nextCursor) would have later pages
    // unregistered.
    return (result.tools ?? []).map((t) => ({
      name: t.name,
      description: t.description,
      annotations: t.annotations as McpToolAnnotations | undefined,
    }));
  }
}
