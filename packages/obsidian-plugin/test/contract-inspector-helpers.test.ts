import { describe, it, expect } from "vitest";
import { parsePflow, type PflowDocument, type ContractSnapshot } from "@perspecta/core";
import {
  portsFromContractSnapshot,
  applyContract,
  applyPinContractInput,
  applyMcpServer,
  contractsFromRegistry,
} from "../src/views/pflow-editor/flow-map.js";
import { coerceContractLiteral, formatContractLiteral, contractSlug } from "../src/views/pflow-editor/contract-ui.js";

const SNAPSHOT: ContractSnapshot = {
  inputs: [
    { name: "vault", schema: { type: "string" }, required: true },
    { name: "context_doc_ids", schema: { type: "array", items: { type: "string" } }, required: true },
    { name: "notes", schema: { type: "string" }, required: false },
  ],
  outputs: [
    { name: "steps", schema: { type: "object" }, projection: "steps" },
    { name: "doc_id", schema: { type: "string" }, projection: "write_back.doc_id" },
  ],
  writesTo: ["default"],
  describedAt: "2026-06-09T00:00:00Z",
};

function baseDoc(): PflowDocument {
  return parsePflow(JSON.stringify({
    pflowFormatVersion: 1,
    workflow: { name: "wf", description: "d" },
    nodes: [
      { id: "in", kind: "input", label: "In", inputs: [], outputs: [{ id: "p", name: "p", schema: { type: "string" } }] },
      { id: "mem", kind: "mcp", label: "Memory",
        inputs: [{ id: "in", name: "in", schema: { type: "any" }, required: true }],
        outputs: [{ id: "out", name: "out", schema: { type: "any" } }],
        config: { mcpServer: "vault-memory" } },
      { id: "end", kind: "output", label: "Out", inputs: [{ id: "in", name: "in", schema: { type: "any" }, required: true }], outputs: [] },
    ],
    wires: [
      { from: { nodeId: "in", portId: "p" }, to: { nodeId: "mem", portId: "in" } },
      { from: { nodeId: "mem", portId: "out" }, to: { nodeId: "end", portId: "in" } },
    ],
  }));
}

describe("portsFromContractSnapshot", () => {
  it("maps inputs/outputs to ports; output ports carry the projection", () => {
    const { inputs, outputs } = portsFromContractSnapshot(SNAPSHOT, {});
    expect(inputs.map((p) => p.id)).toEqual(["in:vault", "in:context_doc_ids", "in:notes"]);
    expect(inputs[0].required).toBe(true);
    expect(inputs[2].required).toBe(false);
    expect(outputs.map((p) => p.id)).toEqual(["out:steps", "out:doc_id"]);
    expect(outputs[1].projection).toBe("write_back.doc_id");
  });
  it("a pinned required input renders as not-required (the pin satisfies it)", () => {
    const { inputs } = portsFromContractSnapshot(SNAPSHOT, { vault: "inim" });
    expect(inputs.find((p) => p.name === "vault")?.required).toBe(false);
    expect(inputs.find((p) => p.name === "context_doc_ids")?.required).toBe(true);
  });
});

describe("applyContract", () => {
  it("stamps contract + snapshot, regenerates ports, drops wires to vanished ports", () => {
    const doc = applyContract(baseDoc(), "mem", "meeting-prep", SNAPSHOT);
    const mem = doc.nodes.find((n) => n.id === "mem")!;
    expect(mem.config?.contract).toBe("meeting-prep");
    expect(mem.config?.contractSnapshot).toEqual(SNAPSHOT);
    expect(mem.inputs.map((p) => p.id)).toEqual(["in:vault", "in:context_doc_ids", "in:notes"]);
    // the old generic "in"/"out" ports are gone, so both wires were pruned
    expect(doc.wires).toHaveLength(0);
  });
  it("prunes pins of inputs the new contract does not have", () => {
    const seeded = applyPinContractInput(applyContract(baseDoc(), "mem", "meeting-prep", SNAPSHOT), "mem", "vault", "inim");
    const next = applyContract(seeded, "mem", "other", {
      inputs: [{ name: "query", schema: { type: "string" }, required: true }],
      outputs: [{ name: "bundle", schema: { type: "any" }, projection: "" }],
      writesTo: [],
    });
    const mem = next.nodes.find((n) => n.id === "mem")!;
    expect(mem.config?.contractInputs).toEqual({});
  });
  it("round-trips through parsePflow (snapshot + projection survive serialization)", () => {
    const doc = applyContract(baseDoc(), "mem", "meeting-prep", SNAPSHOT);
    const again = parsePflow(JSON.stringify(doc));
    const mem = again.nodes.find((n) => n.id === "mem")!;
    expect(mem.outputs.find((p) => p.name === "doc_id")?.projection).toBe("write_back.doc_id");
    expect((mem.config?.contractSnapshot as ContractSnapshot).writesTo).toEqual(["default"]);
  });
});

describe("applyPinContractInput", () => {
  const withContract = () => applyContract(baseDoc(), "mem", "meeting-prep", SNAPSHOT);
  it("pins a literal immutably and clears the port's required flag", () => {
    const before = withContract();
    const after = applyPinContractInput(before, "mem", "vault", "inim");
    expect(before.nodes.find((n) => n.id === "mem")!.config?.contractInputs).toEqual({});
    const mem = after.nodes.find((n) => n.id === "mem")!;
    expect(mem.config?.contractInputs).toEqual({ vault: "inim" });
    expect(mem.inputs.find((p) => p.name === "vault")?.required).toBe(false);
  });
  it("unpinning restores the snapshot's required flag", () => {
    const pinned = applyPinContractInput(withContract(), "mem", "vault", "inim");
    const unpinned = applyPinContractInput(pinned, "mem", "vault", undefined);
    const mem = unpinned.nodes.find((n) => n.id === "mem")!;
    expect(mem.config?.contractInputs).toEqual({});
    expect(mem.inputs.find((p) => p.name === "vault")?.required).toBe(true);
  });
  it("pins typed literals (array) as-is", () => {
    const after = applyPinContractInput(withContract(), "mem", "context_doc_ids", ["a", "b"]);
    expect(after.nodes.find((n) => n.id === "mem")!.config?.contractInputs).toEqual({ context_doc_ids: ["a", "b"] });
  });
});

describe("applyMcpServer drops contract state on rebind", () => {
  it("clears contract, snapshot, and pins when the server changes", () => {
    const bound = applyPinContractInput(applyContract(baseDoc(), "mem", "meeting-prep", SNAPSHOT), "mem", "vault", "inim");
    const rebound = applyMcpServer(bound, "mem", "figma");
    const mem = rebound.nodes.find((n) => n.id === "mem")!;
    expect(mem.config?.mcpServer).toBe("figma");
    expect(mem.config?.contract).toBeUndefined();
    expect(mem.config?.contractSnapshot).toBeUndefined();
    expect(mem.config?.contractInputs).toBeUndefined();
  });
});

describe("contractsFromRegistry", () => {
  it("lists vm_* slugs from the vault-memory registry entry, sorted", () => {
    const reg = {
      "vault-memory": {
        whitelisted: true, probe: { status: "hot" as const },
        groupDefaults: { read: "ask" as const, interactive: "ask" as const, write: "ask" as const },
        tools: {
          vm_meeting_prep: { group: "interactive" as const, groupSource: "heuristic" as const, permission: "default" as const },
          describe_contract: { group: "read" as const, groupSource: "heuristic" as const, permission: "default" as const },
          vm_code_review_brief: { group: "interactive" as const, groupSource: "heuristic" as const, permission: "default" as const },
        },
      },
    };
    expect(contractsFromRegistry(reg)).toEqual(["code_review_brief", "meeting_prep"]);
  });
  it("returns [] without a vault-memory entry", () => {
    expect(contractsFromRegistry({})).toEqual([]);
  });
});

describe("coerceContractLiteral / formatContractLiteral", () => {
  it("string passes through", () => {
    expect(coerceContractLiteral("inim", { type: "string" })).toEqual({ ok: true, value: "inim" });
  });
  it("number coerces or errors", () => {
    expect(coerceContractLiteral("42", { type: "number" })).toEqual({ ok: true, value: 42 });
    expect(coerceContractLiteral("x", { type: "number" }).ok).toBe(false);
    expect(coerceContractLiteral("", { type: "number" }).ok).toBe(false);
  });
  it("boolean accepts true/false only", () => {
    expect(coerceContractLiteral("true", { type: "boolean" })).toEqual({ ok: true, value: true });
    expect(coerceContractLiteral("nope", { type: "boolean" }).ok).toBe(false);
  });
  it("array parses JSON or errors", () => {
    expect(coerceContractLiteral('["a","b"]', { type: "array", items: { type: "string" } })).toEqual({ ok: true, value: ["a", "b"] });
    expect(coerceContractLiteral("a, b", { type: "array" }).ok).toBe(false);
  });
  it("any falls back to raw text when not JSON", () => {
    expect(coerceContractLiteral("plain text", { type: "any" })).toEqual({ ok: true, value: "plain text" });
    expect(coerceContractLiteral('{"k":1}', { type: "any" })).toEqual({ ok: true, value: { k: 1 } });
  });
  it("formats stored literals back to editor text", () => {
    expect(formatContractLiteral("inim")).toBe("inim");
    expect(formatContractLiteral(["a"])).toBe('["a"]');
    expect(formatContractLiteral(undefined)).toBe("");
  });
  it("contractSlug mirrors vault-memory slugify", () => {
    expect(contractSlug("meeting-prep")).toBe("meeting_prep");
  });
});
