import { describe, it, expect } from "vitest";
import { mcpLints } from "../../src/pflow/validate.js";
import { buildWorkflowArtifacts } from "../../src/codegen/scriptgen.js";
import { parsePflow, type PflowDocument } from "../../src/pflow/schema.js";
import type { McpRegistry } from "../../src/pflow/mcp-registry.js";

const SNAPSHOT = {
  inputs: [
    { name: "vault", schema: { type: "string" }, required: true },
    { name: "meeting_path", schema: { type: "string" }, required: true },
    { name: "notes", schema: { type: "string" }, required: false },
  ],
  outputs: [{ name: "bundle", schema: { type: "any" }, projection: "" }],
  writesTo: ["default"],
};

/** A doc with one vault-memory mcp node; configurable contract config. */
function docWith(config: Record<string, unknown>, opts?: { wireMeetingPath?: boolean }): PflowDocument {
  const wires: unknown[] = [
    { from: { nodeId: "mem", portId: "out:bundle" }, to: { nodeId: "end", portId: "in" } },
  ];
  if (opts?.wireMeetingPath !== false) {
    wires.unshift({ from: { nodeId: "in", portId: "p" }, to: { nodeId: "mem", portId: "in:meeting_path" } });
  }
  return parsePflow(JSON.stringify({
    pflowFormatVersion: 1,
    workflow: { name: "wf", description: "d" },
    nodes: [
      { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "p", name: "meeting_path", schema: { type: "string" } }] },
      { id: "mem", kind: "mcp", label: "Memory",
        inputs: [
          { id: "in:vault", name: "vault", schema: { type: "string" }, required: false },
          { id: "in:meeting_path", name: "meeting_path", schema: { type: "string" }, required: opts?.wireMeetingPath !== false },
          { id: "in:notes", name: "notes", schema: { type: "string" }, required: false },
        ],
        outputs: [{ id: "out:bundle", name: "bundle", schema: { type: "any" }, projection: "" }],
        config },
      { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "bundle", schema: { type: "any" }, required: true }], outputs: [] },
    ],
    wires,
  }));
}

const HOT_WITH_TOOL: McpRegistry = {
  "vault-memory": {
    whitelisted: true, probe: { status: "hot" },
    groupDefaults: { read: "ask", interactive: "ask", write: "ask" },
    tools: { vm_meeting_prep: { group: "interactive", groupSource: "heuristic", permission: "allow" } },
  },
};

const rules = (doc: PflowDocument, reg: McpRegistry) => mcpLints(doc, reg).map((e) => e.rule);

describe("memory-contract-missing", () => {
  it("fires for a vault-memory node without a contract", () => {
    const doc = docWith({ mcpServer: "vault-memory" });
    expect(rules(doc, HOT_WITH_TOOL)).toContain("memory-contract-missing");
  });
  it("does not fire when a contract is selected", () => {
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractInputs: { vault: "inim" }, contractSnapshot: SNAPSHOT });
    expect(rules(doc, HOT_WITH_TOOL)).not.toContain("memory-contract-missing");
  });
  it("does not fire for a non-vault-memory server", () => {
    const doc = docWith({ mcpServer: "figma" });
    expect(rules(doc, { figma: HOT_WITH_TOOL["vault-memory"] })).not.toContain("memory-contract-missing");
  });
});

describe("memory-input-unbound", () => {
  it("fires when a required snapshot input is neither wired nor pinned", () => {
    // vault required in snapshot, not pinned, not wired
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractSnapshot: SNAPSHOT });
    const errs = mcpLints(doc, HOT_WITH_TOOL).filter((e) => e.rule === "memory-input-unbound");
    expect(errs).toHaveLength(1);
    expect(errs[0].message).toContain("vault");
  });
  it("does not fire when the input is pinned", () => {
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractInputs: { vault: "inim" }, contractSnapshot: SNAPSHOT });
    expect(rules(doc, HOT_WITH_TOOL)).not.toContain("memory-input-unbound");
  });
  it("does not fire for an optional unbound input", () => {
    // notes is optional and unbound throughout — only vault should be reported
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractInputs: { vault: "inim" }, contractSnapshot: SNAPSHOT });
    const errs = mcpLints(doc, HOT_WITH_TOOL).filter((e) => e.rule === "memory-input-unbound");
    expect(errs).toHaveLength(0);
  });
  it("does not fire without a snapshot (nothing to check against)", () => {
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractInputs: { vault: "inim" } });
    expect(rules(doc, HOT_WITH_TOOL)).not.toContain("memory-input-unbound");
  });
});

describe("memory-contract-stale", () => {
  it("fires when the hot registry no longer lists the contract's vm_ tool", () => {
    const doc = docWith({ mcpServer: "vault-memory", contract: "project-status", contractInputs: { vault: "inim" }, contractSnapshot: SNAPSHOT });
    expect(rules(doc, HOT_WITH_TOOL)).toContain("memory-contract-stale");
  });
  it("does not fire when the vm_ tool is present", () => {
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractInputs: { vault: "inim" }, contractSnapshot: SNAPSHOT });
    expect(rules(doc, HOT_WITH_TOOL)).not.toContain("memory-contract-stale");
  });
  it("does not fire when the registry is cold (cannot know)", () => {
    const cold: McpRegistry = {
      "vault-memory": { whitelisted: true, probe: { status: "cold" }, groupDefaults: { read: "ask", interactive: "ask", write: "ask" }, tools: {} },
    };
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractInputs: { vault: "inim" }, contractSnapshot: SNAPSHOT });
    expect(rules(doc, cold)).not.toContain("memory-contract-stale");
  });
});

describe("fully-bound contract node", () => {
  it("produces zero memory lints and exports", () => {
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractInputs: { vault: "inim" }, contractSnapshot: SNAPSHOT });
    const memoryRules = rules(doc, HOT_WITH_TOOL).filter((r) => r.startsWith("memory-"));
    expect(memoryRules).toEqual([]);
    const artifacts = buildWorkflowArtifacts(doc, HOT_WITH_TOOL);
    expect(artifacts.workflowJs).toContain("vm_meeting_prep");
    expect(artifacts.subagents).toHaveLength(1);
  });
});

describe("export blocking (buildWorkflowArtifacts throws like mcp-server-missing)", () => {
  it("throws on a vault-memory node without a contract", () => {
    const doc = docWith({ mcpServer: "vault-memory" });
    expect(() => buildWorkflowArtifacts(doc, HOT_WITH_TOOL)).toThrow(/contract/i);
  });
  it("throws on a required snapshot input that is neither wired nor pinned", () => {
    const doc = docWith({ mcpServer: "vault-memory", contract: "meeting-prep", contractSnapshot: SNAPSHOT });
    expect(() => buildWorkflowArtifacts(doc, HOT_WITH_TOOL)).toThrow(/vault/);
  });
});
