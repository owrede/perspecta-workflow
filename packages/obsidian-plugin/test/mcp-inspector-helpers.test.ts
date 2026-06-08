import { describe, it, expect } from "vitest";
import { applyMcpServer, grantSummary } from "../src/views/pflow-editor/flow-map.js";
import type { PflowDocument } from "@perspecta/core";
import type { McpRegistry } from "@perspecta/core";

const doc = {
  pflowFormatVersion: 1, workflow: { name: "w", description: "d" },
  nodes: [{ id: "m", kind: "mcp", label: "M", prompt: "p", inputs: [], outputs: [], config: {} }],
  wires: [],
} as unknown as PflowDocument;

describe("applyMcpServer", () => {
  it("sets config.mcpServer immutably", () => {
    const next = applyMcpServer(doc, "m", "figma");
    expect(next.nodes[0].config?.mcpServer).toBe("figma");
    expect(doc.nodes[0].config?.mcpServer).toBeUndefined();
  });
  it("removes the key when the server is empty (no empty-string noise)", () => {
    const withServer = applyMcpServer(doc, "m", "figma");
    const cleared = applyMcpServer(withServer, "m", "");
    expect(cleared.nodes[0].config?.mcpServer).toBeUndefined();
    expect("mcpServer" in (cleared.nodes[0].config ?? {})).toBe(false);
  });
});

describe("grantSummary", () => {
  const reg: McpRegistry = { figma: { whitelisted: true, probe: { status: "hot" }, tools: {
    a: { group: "read", groupSource: "heuristic", permission: "allow" },
    b: { group: "write", groupSource: "heuristic", permission: "ask" },
    c: { group: "write", groupSource: "heuristic", permission: "blocked" },
  } } };
  it("summarizes a hot server's grants", () => {
    expect(grantSummary(reg, "figma")).toBe("3 tools — 1 always · 1 ask · 1 blocked");
  });
  it("reports not-whitelisted for an unknown server", () => {
    expect(grantSummary({}, "ghost")).toBe("not whitelisted in this vault");
  });
  it("reports a cold/failed status", () => {
    expect(grantSummary({ x: { whitelisted: true, probe: { status: "failed", error: "boom" }, tools: {} } }, "x")).toBe("failed: boom");
  });
});
