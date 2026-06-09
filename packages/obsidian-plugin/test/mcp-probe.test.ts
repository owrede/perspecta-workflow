import { describe, it, expect } from "vitest";
import { probedToolsToRegistry, NodeMcpProbe } from "../src/mcp/probe.js";

describe("probedToolsToRegistry", () => {
  it("maps probed tools into classified groups; each tool starts on the 'default' sentinel", () => {
    const reg = probedToolsToRegistry([
      { name: "get_design", description: "Fetch", annotations: { readOnlyHint: true } },
      { name: "create_file", description: "Make" },
    ]);
    // Tools follow their group default (initially "ask") via the "default" sentinel,
    // not a pinned concrete value — so groups stay uniform until the user deviates one.
    expect(reg.get_design).toMatchObject({ group: "read", groupSource: "annotation", permission: "default" });
    expect(reg.create_file).toMatchObject({ group: "write", groupSource: "heuristic", permission: "default" });
  });
  it("uses heuristic groupSource when no annotation decided the group", () => {
    const reg = probedToolsToRegistry([{ name: "list_things" }]);
    expect(reg.list_things.groupSource).toBe("heuristic");
    expect(reg.list_things.group).toBe("read");
  });
});

describe("NodeMcpProbe guards", () => {
  it("rejects a non-stdio server without spawning the helper", async () => {
    await expect(new NodeMcpProbe("/abs/mcp-probe.mjs").probe({ name: "x", transport: "http", url: "http://localhost" }))
      .rejects.toThrow("Only stdio");
  });
  it("rejects a stdio server with no command without spawning the helper", async () => {
    await expect(new NodeMcpProbe("/abs/mcp-probe.mjs").probe({ name: "y", transport: "stdio" }))
      .rejects.toThrow("no command");
  });
});

describe("NodeMcpProbe child-process protocol", () => {
  // A minimal fake child: emits the given stdout line after stdin closes, then
  // fires 'close'. Captures the (cmd, args, opts) it was spawned with for assertions.
  function fakeSpawn(stdoutLine: string, captured?: { cmd?: string; opts?: { env: NodeJS.ProcessEnv } }) {
    return (cmd: string, _args: string[], opts: { env: NodeJS.ProcessEnv }) => {
      if (captured) { captured.cmd = cmd; captured.opts = opts; }
      const handlers: Record<string, (arg?: unknown) => void> = {};
      const child = {
        stdout: { on: (ev: string, cb: (d: Buffer) => void) => { if (ev === "data") setTimeout(() => cb(Buffer.from(stdoutLine)), 0); } },
        stderr: { on: () => {} },
        stdin: { write: () => {}, end: () => { setTimeout(() => handlers.close?.(), 0); } },
        on: (ev: string, cb: (arg?: unknown) => void) => { handlers[ev] = cb; },
      };
      return child as unknown as import("node:child_process").ChildProcessWithoutNullStreams;
    };
  }

  const stubNode = () => "/stub/bin/node";
  const stubPath = () => "/stub/bin:/usr/bin";

  it("launches the resolved node with an augmented PATH env", async () => {
    const cap: { cmd?: string; opts?: { env: NodeJS.ProcessEnv } } = {};
    const probe = new NodeMcpProbe(
      "/abs/mcp-probe.mjs",
      fakeSpawn(JSON.stringify({ ok: true, tools: [] }), cap),
      stubNode,
      stubPath,
    );
    await probe.probe({ name: "fs", transport: "stdio", command: "x" });
    expect(cap.cmd).toBe("/stub/bin/node");
    expect(cap.opts?.env.PATH).toBe("/stub/bin:/usr/bin");
  });

  it("parses tools from the helper's ok:true JSON line", async () => {
    const probe = new NodeMcpProbe(
      "/abs/mcp-probe.mjs",
      fakeSpawn(JSON.stringify({ ok: true, tools: [{ name: "read_file", annotations: { readOnlyHint: true } }] })),
      stubNode,
      stubPath,
    );
    const tools = await probe.probe({ name: "fs", transport: "stdio", command: "x" });
    expect(tools).toEqual([{ name: "read_file", description: undefined, annotations: { readOnlyHint: true } }]);
  });

  it("throws the helper's error on an ok:false line", async () => {
    const probe = new NodeMcpProbe(
      "/abs/mcp-probe.mjs",
      fakeSpawn(JSON.stringify({ ok: false, error: "spawn nope EACCES" })),
      stubNode,
      stubPath,
    );
    await expect(probe.probe({ name: "bad", transport: "stdio", command: "nope" })).rejects.toThrow("spawn nope EACCES");
  });

  it("throws a clear reason when no node binary is found", async () => {
    const probe = new NodeMcpProbe(
      "/abs/mcp-probe.mjs",
      fakeSpawn("{}"),
      () => null, // resolveNode finds nothing
      stubPath,
    );
    await expect(probe.probe({ name: "x", transport: "stdio", command: "y" })).rejects.toThrow("Could not find a `node` binary");
  });
});
