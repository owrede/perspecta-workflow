import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { contractsFromProbe, NodeMcpProbe } from "../src/mcp/probe.js";
import { NodeContractDescriber, toContractSnapshot, type RawContractDescription } from "../src/mcp/describeContract.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as RawContractDescription;

describe("contractsFromProbe", () => {
  it("filters to vm_* tools, strips the prefix, sorts unique", () => {
    const out = contractsFromProbe([
      { name: "vm_meeting_prep" },
      { name: "search_hybrid" },
      { name: "vm_code_review_brief" },
      { name: "describe_contract" },
      { name: "vm_meeting_prep" }, // dupe
    ]);
    expect(out).toEqual(["code_review_brief", "meeting_prep"]);
  });
  it("returns [] when no vm_ tools are present (non-vault-memory server)", () => {
    expect(contractsFromProbe([{ name: "get_design" }, { name: "create_file" }])).toEqual([]);
  });
  it("drops a bare 'vm_' name", () => {
    expect(contractsFromProbe([{ name: "vm_" }])).toEqual([]);
  });
});

describe("toContractSnapshot (real captured describe_contract fixtures)", () => {
  it("meeting-prep: 3 required typed inputs, steps output, default sink badge", () => {
    const snap = toContractSnapshot(fixture("describe-meeting-prep.json"), "2026-06-09T00:00:00Z");
    expect(snap.inputs.map((i) => i.name)).toEqual(["vault", "meeting_path", "context_doc_ids"]);
    expect(snap.inputs.every((i) => i.required)).toBe(true);
    expect(snap.inputs[2].schema).toEqual({ type: "array", items: { type: "string" } });
    // output_shape: {steps:{compiled:{ok,doc_id}}} — compiled is object-typed,
    // so only the top-level steps port is emitted (no deep projection).
    expect(snap.outputs.map((o) => o.name)).toEqual(["steps"]);
    expect(snap.outputs[0].projection).toBe("steps");
    expect(snap.writesTo).toEqual(["default"]);
    expect(snap.describedAt).toBe("2026-06-09T00:00:00Z");
  });
  it("code-review-brief: write_back.doc_id projects to a doc_id port", () => {
    const snap = toContractSnapshot(fixture("describe-code-review-brief.json"));
    expect(snap.outputs.map((o) => o.name)).toContain("doc_id");
    expect(snap.outputs.find((o) => o.name === "doc_id")?.projection).toBe("write_back.doc_id");
    expect(snap.writesTo).toContain("_memory/_briefs");
  });
  it("degrades a legacy describe result (no output_shape/writes_to) to the bundle port", () => {
    const legacy: RawContractDescription = { ok: true, json_schema: fixture("describe-meeting-prep.json").json_schema };
    const snap = toContractSnapshot(legacy);
    expect(snap.outputs).toEqual([{ name: "bundle", schema: { type: "any" }, projection: "" }]);
    expect(snap.writesTo).toEqual([]);
  });
});

// Minimal fake child mirroring mcp-probe.test.ts: captures the stdin request,
// emits one stdout line, then closes.
function fakeSpawn(stdoutLine: string, captured?: { request?: string }) {
  return ((_cmd: string, _args: string[], _opts: { env: NodeJS.ProcessEnv }) => {
    const handlers: Record<string, (arg?: unknown) => void> = {};
    const child = {
      stdout: { on: (ev: string, cb: (d: Buffer) => void) => { if (ev === "data") setTimeout(() => cb(Buffer.from(stdoutLine)), 0); } },
      stderr: { on: () => {} },
      stdin: {
        write: (data: string) => { if (captured) captured.request = data; },
        end: () => { setTimeout(() => handlers.close?.(), 0); },
      },
      on: (ev: string, cb: (arg?: unknown) => void) => { handlers[ev] = cb; },
    };
    return child as unknown as import("node:child_process").ChildProcessWithoutNullStreams;
  });
}

const stubNode = () => "/stub/bin/node";
const stubPath = () => "/stub/bin:/usr/bin";

describe("NodeContractDescriber", () => {
  const SERVER = {
    name: "vault-memory", transport: "stdio" as const, command: "vault-memory", args: ["serve"],
    env: { VAULT_MEMORY_ACTIVE_VAULT: "inim" },
  };

  it("sends a describe_contract call with the active vault from .mcp.json env", async () => {
    const cap: { request?: string } = {};
    const ok = JSON.stringify({ ok: true, tools: [], result: { ok: true, name: "meeting-prep", json_schema: {} } });
    const d = new NodeContractDescriber("/abs/mcp-probe.mjs", fakeSpawn(ok, cap), stubNode, stubPath);
    const raw = await d.describe(SERVER, "meeting_prep");
    expect(raw.name).toBe("meeting-prep");
    const req = JSON.parse(cap.request!);
    expect(req.call).toEqual({ tool: "describe_contract", arguments: { name: "meeting_prep", vault: "inim" } });
  });

  it("omits the vault argument when the entry has no active-vault env", async () => {
    const cap: { request?: string } = {};
    const ok = JSON.stringify({ ok: true, tools: [], result: { ok: true, name: "x", json_schema: {} } });
    const d = new NodeContractDescriber("/abs/mcp-probe.mjs", fakeSpawn(ok, cap), stubNode, stubPath);
    await d.describe({ name: "vault-memory", transport: "stdio", command: "vault-memory" }, "x");
    expect(JSON.parse(cap.request!).call.arguments).toEqual({ name: "x" });
  });

  it("throws on an unknown contract (ok:false envelope)", async () => {
    const fail = JSON.stringify({ ok: true, tools: [], result: { ok: false, reason: "unknown_contract", name: "nope" } });
    const d = new NodeContractDescriber("/abs/mcp-probe.mjs", fakeSpawn(fail), stubNode, stubPath);
    await expect(d.describe(SERVER, "nope")).rejects.toThrow(/unknown_contract/);
  });

  it("rejects a non-stdio server without spawning", async () => {
    const d = new NodeContractDescriber("/abs/mcp-probe.mjs", fakeSpawn("{}"), stubNode, stubPath);
    await expect(d.describe({ name: "vault-memory", transport: "http", url: "http://x" }, "c")).rejects.toThrow("Only stdio");
  });
});

describe("NodeMcpProbe vault-memory warm-up", () => {
  it("sends a register_contracts_as_tools preCall scoped to the active vault", async () => {
    const cap: { request?: string } = {};
    const probe = new NodeMcpProbe(
      "/abs/mcp-probe.mjs",
      fakeSpawn(JSON.stringify({ ok: true, tools: [{ name: "vm_meeting_prep" }] }), cap),
      stubNode, stubPath,
    );
    const tools = await probe.probe({
      name: "vault-memory", transport: "stdio", command: "vault-memory",
      env: { VAULT_MEMORY_ACTIVE_VAULT: "inim" },
    });
    expect(tools.map((t) => t.name)).toEqual(["vm_meeting_prep"]);
    const req = JSON.parse(cap.request!);
    expect(req.preCalls).toEqual([{ tool: "register_contracts_as_tools", arguments: { vault: "inim" } }]);
  });
  it("sends NO preCalls for other servers", async () => {
    const cap: { request?: string } = {};
    const probe = new NodeMcpProbe("/abs/mcp-probe.mjs", fakeSpawn(JSON.stringify({ ok: true, tools: [] }), cap), stubNode, stubPath);
    await probe.probe({ name: "figma", transport: "stdio", command: "figma-mcp" });
    expect(JSON.parse(cap.request!).preCalls).toBeUndefined();
  });
});
