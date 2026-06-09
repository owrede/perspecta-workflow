import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { classifyToolGroup, type McpRegistryTool, type McpToolAnnotations } from "@perspecta/core";
import type { McpJsonServer } from "./mcpJson.js";
import { resolveNodePath, augmentedPath, NO_NODE_REASON } from "./nodeResolver.js";

// `child_process` (unprefixed) is marked external in the plugin build, so esbuild
// emits a CommonJS `require("child_process")` that Electron's renderer resolves
// at load time. A dynamic `import("node:child_process")` does NOT work in the
// renderer — its ESM loader tries to *fetch* the bare specifier and fails with
// "Failed to fetch dynamically imported module: node:child_process".

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
 *  source when a hint decided it, else heuristic); each tool starts on "default"
 *  so it follows its group's default (initially "ask") rather than pinning a
 *  concrete value — keeps groups uniform until the user deviates a tool. Pure. */
export function probedToolsToRegistry(tools: ProbedTool[]): Record<string, McpRegistryTool> {
  const out: Record<string, McpRegistryTool> = {};
  for (const t of tools) {
    const group = classifyToolGroup(t.name, t.annotations);
    const decidedByAnnotation = t.annotations?.readOnlyHint === true || t.annotations?.destructiveHint === true;
    out[t.name] = {
      description: t.description,
      group,
      groupSource: decidedByAnnotation ? "annotation" : "heuristic",
      permission: "default",
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
 *  @param spawnFn injectable spawn (defaults to the statically-imported one)
 *  @param resolveNode injectable node-path resolver (defaults to resolveNodePath)
 *  @param buildPath injectable PATH builder (defaults to augmentedPath)
 */
export class NodeMcpProbe implements McpProbe {
  constructor(
    private readonly probeHelperPath: string,
    private readonly spawnFn: (
      cmd: string,
      args: string[],
      opts: { env: NodeJS.ProcessEnv },
    ) => ChildProcessWithoutNullStreams = spawn,
    private readonly resolveNode: () => string | null = () => resolveNodePath(),
    private readonly buildPath: () => string = () => augmentedPath(),
  ) {}

  async probe(server: McpJsonServer): Promise<ProbedTool[]> {
    if (server.transport !== "stdio") {
      throw new Error(`Only stdio MCP servers can be probed in this version (got "${server.transport}")`);
    }
    if (!server.command) {
      throw new Error(`Stdio server "${server.name}" has no command — check .mcp.json`);
    }
    // Obsidian launched from the Dock has a minimal PATH (no nvm/Homebrew), so we
    // (1) resolve an absolute node to launch the helper, and (2) hand the helper
    // an augmented PATH so the MCP SDK inside it can spawn the TARGET server's
    // command (npx/uvx/vault-memory/…), which would otherwise ENOENT.
    const nodePath = this.resolveNode();
    if (!nodePath) throw new Error(NO_NODE_REASON);
    const childEnv: NodeJS.ProcessEnv = { ...process.env, PATH: this.buildPath() };
    const child = this.spawnFn(nodePath, [this.probeHelperPath], { env: childEnv });
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
