/**
 * Standalone MCP probe CLI. Spawned by the Obsidian plugin as a Node child
 * process to inspect another MCP server without loading the MCP SDK inside
 * Obsidian's renderer (the renderer has no module resolver for the SDK, and the
 * SDK's stdio client needs Node APIs anyway).
 *
 * Contract:
 *   stdin:  a JSON object { command: string, args?: string[], env?: Record<string,string> }
 *   stdout: on success, one line of JSON: { ok: true, tools: ProbedTool[] }
 *           on failure, one line of JSON: { ok: false, error: string }
 *   exit:   0 on success, 1 on failure (stdout still carries the JSON either way)
 *
 * Bundled to mcp-probe.mjs (platform:node, SDK inlined) and shipped in the
 * plugin folder next to mcp-server.mjs.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/sdk/client/stdio.js";

interface ProbeRequest {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ProbedTool {
  name: string;
  description?: string;
  annotations?: unknown;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { data += chunk; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function main(): Promise<void> {
  const raw = await readStdin();
  let req: ProbeRequest;
  try {
    req = JSON.parse(raw);
  } catch {
    process.stdout.write(JSON.stringify({ ok: false, error: "probe CLI: invalid JSON on stdin" }) + "\n");
    process.exit(1);
  }
  if (!req!.command) {
    process.stdout.write(JSON.stringify({ ok: false, error: "probe CLI: missing 'command'" }) + "\n");
    process.exit(1);
  }

  // Merge the target server's env over Node's default sanitized environment,
  // matching how a host launches stdio servers.
  const env = req!.env ? { ...getDefaultEnvironment(), ...req!.env } : getDefaultEnvironment();
  const transport = new StdioClientTransport({ command: req!.command, args: req!.args ?? [], env });
  const client = new Client({ name: "perspecta-workflow-probe", version: "1.0.0" });
  try {
    await client.connect(transport);
    const res = await client.listTools();
    const tools: ProbedTool[] = res.tools.map((t) => ({
      name: t.name,
      description: t.description,
      annotations: t.annotations,
    }));
    process.stdout.write(JSON.stringify({ ok: true, tools }) + "\n");
    await client.close().catch(() => {});
    process.exit(0);
  } catch (e) {
    await client.close().catch(() => {});
    process.stdout.write(JSON.stringify({ ok: false, error: (e as Error).message }) + "\n");
    process.exit(1);
  }
}

void main();
