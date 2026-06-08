import { describe, it, expect } from "vitest";
import { parseMcpJsonServers } from "../src/mcp/mcpJson.js";

describe("parseMcpJsonServers", () => {
  it("lists server names + their stdio launch params", () => {
    const text = JSON.stringify({ mcpServers: {
      "vault-memory": { type: "stdio", command: "vault-memory", args: ["serve"], env: { X: "1" } },
      "remote": { type: "http", url: "https://x" },
    } });
    const servers = parseMcpJsonServers(text);
    expect(servers.map((s) => s.name).sort()).toEqual(["remote", "vault-memory"]);
    const vm = servers.find((s) => s.name === "vault-memory")!;
    expect(vm.transport).toBe("stdio");
    expect(vm.command).toBe("vault-memory");
    expect(vm.args).toEqual(["serve"]);
  });
  it("infers stdio transport from a command when type is absent", () => {
    const servers = parseMcpJsonServers(JSON.stringify({ mcpServers: { a: { command: "foo", args: [] } } }));
    expect(servers[0].transport).toBe("stdio");
  });
  it("infers http transport from a url when type is absent", () => {
    const servers = parseMcpJsonServers(JSON.stringify({ mcpServers: { a: { url: "https://x" } } }));
    expect(servers[0].transport).toBe("http");
  });
  it("returns [] for missing/empty/invalid input", () => {
    expect(parseMcpJsonServers("")).toEqual([]);
    expect(parseMcpJsonServers("{}")).toEqual([]);
    expect(parseMcpJsonServers("not json")).toEqual([]);
    expect(parseMcpJsonServers(JSON.stringify({ mcpServers: null }))).toEqual([]);
  });
});
