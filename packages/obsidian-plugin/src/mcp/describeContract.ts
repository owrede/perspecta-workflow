import { contractSnapshotFromDescribe, type ContractSnapshot } from "@perspecta/core";
import type { McpJsonServer } from "./mcpJson.js";
import {
  runMcpHelper,
  type HelperSpawnFn,
} from "./probe.js";
import { spawn } from "child_process";
import { resolveNodePath, augmentedPath } from "./nodeResolver.js";

/** vault-memory's describe_contract result, as the plugin consumes it.
 *  `json_schema` + `summary` exist on every vault-memory version; `name`
 *  (canonical), `output_shape`, and `writes_to` are the structured fields newer
 *  versions add — absent fields degrade to the bundle port / empty badge. */
export interface RawContractDescription {
  ok: boolean;
  name?: string;
  json_schema?: unknown;
  output_shape?: unknown;
  writes_to?: string[];
  summary?: string;
  reason?: string;
}

/** Host-agnostic describe_contract adapter, mirroring McpProbe: the editor
 *  depends on this interface; the concrete impl is chosen per host. */
export interface ContractDescriber {
  describe(server: McpJsonServer, contract: string): Promise<RawContractDescription>;
}

/** Node-side describer. Reuses the probe's child-process plumbing (the bundled
 *  mcp-probe.mjs helper with the SDK inlined — the renderer cannot host the SDK,
 *  see probe.ts) and issues one describe_contract call. The contract may be a
 *  canonical name ("meeting-prep") or a probed slug ("meeting_prep" /
 *  "vm_meeting_prep") — vault-memory resolves all three. When the .mcp.json
 *  entry pins VAULT_MEMORY_ACTIVE_VAULT, it is passed as the describe `vault`
 *  so multi-vault configs resolve deterministically instead of ambiguous_vault. */
export class NodeContractDescriber implements ContractDescriber {
  constructor(
    private readonly probeHelperPath: string,
    private readonly spawnFn: HelperSpawnFn = spawn,
    private readonly resolveNode: () => string | null = () => resolveNodePath(),
    private readonly buildPath: () => string = () => augmentedPath(),
  ) {}

  async describe(server: McpJsonServer, contract: string): Promise<RawContractDescription> {
    const args: Record<string, unknown> = { name: contract };
    const activeVault = server.env?.VAULT_MEMORY_ACTIVE_VAULT;
    if (activeVault) args.vault = activeVault;
    const res = await runMcpHelper(
      this.probeHelperPath, this.spawnFn, this.resolveNode, this.buildPath,
      server, { call: { tool: "describe_contract", arguments: args } },
    );
    const raw = res.result as RawContractDescription | undefined;
    if (!raw || typeof raw !== "object") {
      throw new Error(`describe_contract returned no parseable result for "${contract}"`);
    }
    if (raw.ok !== true) {
      throw new Error(`describe_contract failed for "${contract}": ${raw.reason ?? "unknown error"}`);
    }
    return raw;
  }
}

/** Map a describe result onto the core contract snapshot (typed input/output
 *  port defs + write-back badge). `describedAt` is the caller's timestamp —
 *  injected so this stays pure. */
export function toContractSnapshot(raw: RawContractDescription, describedAt?: string): ContractSnapshot {
  return contractSnapshotFromDescribe(
    { json_schema: raw.json_schema, output_shape: raw.output_shape, writes_to: raw.writes_to },
    describedAt,
  );
}
