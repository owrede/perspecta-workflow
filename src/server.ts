import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildGraph } from "./graph.js";
import { lint, applyColors, type LintError } from "./linter.js";
import { Stepper } from "./stepper.js";
import { VERSION } from "./index.js";

const sessions = new Map<string, Stepper>();
export function resetSessions(): void {
  sessions.clear();
}

export const handlers = {
  async workflow_lint({ canvas, fix = false }: { canvas: string; fix?: boolean }) {
    const graph = buildGraph(canvas);
    const result = lint(graph);
    let recolored = 0;
    if (fix && result.ok) recolored = applyColors(graph, canvas);
    return { ...result, recolored };
  },

  async workflow_start({
    canvas,
  }: {
    canvas: string;
  }): Promise<{ ok: boolean; session?: string; errors?: LintError[] }> {
    const graph = buildGraph(canvas);
    const result = lint(graph);
    if (!result.ok) return { ok: false, errors: result.errors };
    const session = randomUUID();
    sessions.set(session, new Stepper(canvas));
    return { ok: true, session };
  },

  async workflow_current({ session }: { session: string }) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    return s.current();
  },

  async workflow_advance({
    session,
    edge,
    outputs,
  }: {
    session: string;
    edge?: string;
    outputs?: Record<string, unknown>;
  }) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    s.advance({ edge, outputs });
    return { ok: true, ...s.status() };
  },

  async workflow_context({ session }: { session: string }) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    return s.context();
  },

  async workflow_status({ session }: { session: string }) {
    const s = sessions.get(session);
    if (!s) throw new Error(`Unknown session ${session}`);
    return s.status();
  },
};

/** Wrap a handler result as an MCP tool text-content response. */
function toContent(result: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
}

export function buildServer(): McpServer {
  const server = new McpServer({ name: "perspecta-workflow", version: VERSION });

  server.registerTool(
    "workflow_lint",
    {
      description:
        "Lint a Perspecta workflow canvas. Optionally auto-fix node colors from their node_type.",
      inputSchema: { canvas: z.string(), fix: z.boolean().optional() },
    },
    async ({ canvas, fix }) => toContent(await handlers.workflow_lint({ canvas, fix })),
  );

  server.registerTool(
    "workflow_start",
    {
      description:
        "Lint then start a workflow run. Returns a session id on success, or lint errors on failure.",
      inputSchema: { canvas: z.string() },
    },
    async ({ canvas }) => toContent(await handlers.workflow_start({ canvas })),
  );

  server.registerTool(
    "workflow_current",
    {
      description: "Return the current node (instruction, frontmatter, outgoing edges) for a session.",
      inputSchema: { session: z.string() },
    },
    async ({ session }) => toContent(await handlers.workflow_current({ session })),
  );

  server.registerTool(
    "workflow_advance",
    {
      description:
        "Advance the cursor along an edge. Supply `edge` at branch points and `outputs` produced by the current node.",
      inputSchema: {
        session: z.string(),
        edge: z.string().optional(),
        outputs: z.record(z.string(), z.unknown()).optional(),
      },
    },
    async ({ session, edge, outputs }) =>
      toContent(await handlers.workflow_advance({ session, edge, outputs })),
  );

  server.registerTool(
    "workflow_context",
    {
      description: "Return the accumulated context bag (all recorded outputs) for a session.",
      inputSchema: { session: z.string() },
    },
    async ({ session }) => toContent(await handlers.workflow_context({ session })),
  );

  server.registerTool(
    "workflow_status",
    {
      description: "Return run status: whether at end, stack depth, and current node id.",
      inputSchema: { session: z.string() },
    },
    async ({ session }) => toContent(await handlers.workflow_status({ session })),
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
