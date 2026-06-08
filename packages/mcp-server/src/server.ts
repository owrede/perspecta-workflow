import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildGraph, lint, applyColors, Stepper, VERSION, type LintError } from "@perspecta/core";
import { NodeFileSystem } from "./NodeFileSystem.js";

const fs = new NodeFileSystem();

const sessions = new Map<string, Stepper>();
export function resetSessions(): void {
  sessions.clear();
}

/** Look up a live session or fail with a consistent error. */
function requireSession(session: string): Stepper {
  const s = sessions.get(session);
  if (!s) throw new Error(`Unknown session ${session}`);
  return s;
}

export const handlers = {
  async workflow_lint({ canvas, fix = false }: { canvas: string; fix?: boolean }) {
    const graph = buildGraph(canvas, { fs });
    const result = lint(graph, fs);
    let recolored = 0;
    if (fix && result.ok) recolored = applyColors(graph, canvas, fs);
    return { ...result, recolored };
  },

  async workflow_start({
    canvas,
  }: {
    canvas: string;
  }): Promise<{ ok: boolean; session?: string; errors?: LintError[] }> {
    const graph = buildGraph(canvas, { fs });
    const result = lint(graph, fs);
    if (!result.ok) return { ok: false, errors: result.errors };
    const session = randomUUID();
    sessions.set(session, new Stepper(canvas, { fs }));
    return { ok: true, session };
  },

  async workflow_current({ session }: { session: string }) {
    return requireSession(session).current();
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
    const s = requireSession(session);
    s.advance({ edge, outputs });
    const status = s.status();
    // Free the session once the run reaches its end so finished walks don't leak.
    if (status.atEnd) sessions.delete(session);
    return { ok: true, ...status };
  },

  async workflow_context({ session }: { session: string }) {
    return requireSession(session).context();
  },

  async workflow_status({ session }: { session: string }) {
    return requireSession(session).status();
  },

  /** Release a session's resources. Idempotent: returns `{ ok: true, ended }`
   *  where `ended` is false if the session was already gone. */
  async workflow_end({ session }: { session: string }) {
    return { ok: true, ended: sessions.delete(session) };
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

  server.registerTool(
    "workflow_end",
    {
      description:
        "Release a finished or abandoned workflow session. Call when a run is done to free server resources; advancing to an end node frees the session automatically.",
      inputSchema: { session: z.string() },
    },
    async ({ session }) => toContent(await handlers.workflow_end({ session })),
  );

  return server;
}

/** True when this module is the process entry point (spawned as `node server.js`
 *  / `node mcp-server.mjs`), false when imported (e.g. by tests). Compares real
 *  filesystem paths, not raw strings: `import.meta.url` percent-encodes spaces
 *  and resolves symlinks, while `process.argv[1]` does neither — a naive
 *  `file://${argv[1]}` comparison silently fails for any vault path containing a
 *  space or reached via a symlink (iCloud/Dropbox-synced vaults), leaving the
 *  spawned server connected to nothing. realpathSync on both sides normalizes
 *  encoding and symlinks so the guard holds for real-world paths. */
function isProcessEntry(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isProcessEntry()) {
  const server = buildServer();
  await server.connect(new StdioServerTransport());
}
