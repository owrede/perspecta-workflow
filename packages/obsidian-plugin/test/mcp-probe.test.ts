import { describe, it, expect } from "vitest";
import { probedToolsToRegistry, NodeMcpProbe } from "../src/mcp/probe.js";

describe("probedToolsToRegistry", () => {
  it("maps probed tools into registry tools with classified groups + ask default", () => {
    const reg = probedToolsToRegistry([
      { name: "get_design", description: "Fetch", annotations: { readOnlyHint: true } },
      { name: "create_file", description: "Make" },
    ]);
    expect(reg.get_design).toMatchObject({ group: "read", groupSource: "annotation", permission: "ask" });
    expect(reg.create_file).toMatchObject({ group: "write", groupSource: "heuristic", permission: "ask" });
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
  // fires 'close'. Exercises the spawn→parse path without a real process.
  function fakeSpawn(stdoutLine: string) {
    return () => {
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

  it("parses tools from the helper's ok:true JSON line", async () => {
    const probe = new NodeMcpProbe(
      "/abs/mcp-probe.mjs",
      fakeSpawn(JSON.stringify({ ok: true, tools: [{ name: "read_file", annotations: { readOnlyHint: true } }] })),
    );
    const tools = await probe.probe({ name: "fs", transport: "stdio", command: "x" });
    expect(tools).toEqual([{ name: "read_file", description: undefined, annotations: { readOnlyHint: true } }]);
  });

  it("throws the helper's error on an ok:false line", async () => {
    const probe = new NodeMcpProbe(
      "/abs/mcp-probe.mjs",
      fakeSpawn(JSON.stringify({ ok: false, error: "spawn nope EACCES" })),
    );
    await expect(probe.probe({ name: "bad", transport: "stdio", command: "nope" })).rejects.toThrow("spawn nope EACCES");
  });
});
