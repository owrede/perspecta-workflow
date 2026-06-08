import { describe, it, expect } from "vitest";
import { mcpLints } from "../../src/pflow/validate.js";
import type { PflowDocument } from "../../src/pflow/schema.js";
import type { McpRegistry } from "../../src/pflow/mcp-registry.js";

function docWith(config: Record<string, unknown>): PflowDocument {
  return {
    pflowFormatVersion: 1,
    workflow: { name: "w", description: "d" },
    nodes: [{ id: "m", kind: "mcp", label: "M", prompt: "p", inputs: [], outputs: [], config }],
    wires: [],
  } as PflowDocument;
}

const figmaHot: McpRegistry = {
  figma: { whitelisted: true, probe: { status: "hot" }, tools: {
    create_file: { group: "write", groupSource: "heuristic", permission: "allow" },
  } },
};

describe("mcpLints", () => {
  it("flags mcp-server-missing when no server is bound", () => {
    const errs = mcpLints(docWith({}), {});
    expect(errs.map((e) => e.rule)).toContain("mcp-server-missing");
  });
  it("flags mcp-server-not-whitelisted", () => {
    const errs = mcpLints(docWith({ mcpServer: "figma" }), {});
    expect(errs.map((e) => e.rule)).toContain("mcp-server-not-whitelisted");
  });
  it("flags mcp-server-cold when whitelisted but not hot", () => {
    const reg: McpRegistry = { figma: { whitelisted: true, probe: { status: "cold" }, tools: {} } };
    expect(mcpLints(docWith({ mcpServer: "figma" }), reg).map((e) => e.rule)).toContain("mcp-server-cold");
  });
  it("flags mcp-policy-stricter when local blocks an expected-allow tool", () => {
    const local: McpRegistry = { figma: { whitelisted: true, probe: { status: "hot" }, tools: {
      create_file: { group: "write", groupSource: "heuristic", permission: "blocked" },
    } } };
    const errs = mcpLints(docWith({ mcpServer: "figma", expectedGrants: { create_file: "allow" } }), local);
    expect(errs.map((e) => e.rule)).toContain("mcp-policy-stricter");
  });
  it("is clean for a whitelisted hot server with no stricter policy", () => {
    expect(mcpLints(docWith({ mcpServer: "figma" }), figmaHot)).toEqual([]);
  });
  it("ignores non-mcp nodes", () => {
    const doc = {
      pflowFormatVersion: 1, workflow: { name: "w", description: "d" },
      nodes: [{ id: "a", kind: "agent", label: "A", prompt: "p", inputs: [], outputs: [] }],
      wires: [],
    } as unknown as PflowDocument;
    expect(mcpLints(doc, {})).toEqual([]);
  });
  it("reports a failed probe with its error in the cold lint message", () => {
    const reg: McpRegistry = { figma: { whitelisted: true, probe: { status: "failed", error: "spawn ENOENT" }, tools: {} } };
    const errs = mcpLints(docWith({ mcpServer: "figma" }), reg);
    const cold = errs.find((e) => e.rule === "mcp-server-cold");
    expect(cold).toBeDefined();
    expect(cold!.message).toContain("probe failed");
    expect(cold!.message).toContain("spawn ENOENT");
  });
  it("accumulates lints independently across multiple mcp nodes", () => {
    const doc = {
      pflowFormatVersion: 1, workflow: { name: "w", description: "d" },
      nodes: [
        { id: "a", kind: "mcp", label: "A", prompt: "p", inputs: [], outputs: [], config: {} },                 // missing
        { id: "b", kind: "mcp", label: "B", prompt: "p", inputs: [], outputs: [], config: { mcpServer: "figma" } }, // ok
      ],
      wires: [],
    } as unknown as PflowDocument;
    const reg: McpRegistry = { figma: { whitelisted: true, probe: { status: "hot" }, tools: {} } };
    const errs = mcpLints(doc, reg);
    expect(errs.map((e) => e.rule)).toEqual(["mcp-server-missing"]); // only node a flagged; node b clean
    expect(errs[0].nodeId).toBe("a");
  });
});
