import { describe, it, expect } from "vitest";
import { classifyToolGroup, resolveServerGrants, applyGroupPermission, serverGroupDefaults, DEFAULT_GROUP_DEFAULTS, resolveToolPermission } from "../../src/pflow/mcp-registry.js";
import type { McpRegistryServer } from "../../src/pflow/mcp-registry.js";

describe("classifyToolGroup", () => {
  it("uses readOnlyHint annotation when present", () => {
    expect(classifyToolGroup("create_thing", { readOnlyHint: true })).toBe("read");
  });
  it("uses destructiveHint annotation when present", () => {
    expect(classifyToolGroup("get_thing", { destructiveHint: true })).toBe("write");
  });
  it("falls back to a read verb heuristic", () => {
    expect(classifyToolGroup("get_design")).toBe("read");
    expect(classifyToolGroup("list_files")).toBe("read");
    expect(classifyToolGroup("search_docs")).toBe("read");
  });
  it("falls back to a write verb heuristic", () => {
    expect(classifyToolGroup("create_file")).toBe("write");
    expect(classifyToolGroup("delete_node")).toBe("write");
    expect(classifyToolGroup("update_row")).toBe("write");
  });
  it("classifies a neutral/unknown verb as interactive (the middle bucket)", () => {
    expect(classifyToolGroup("frobnicate")).toBe("interactive");
    expect(classifyToolGroup("move_file")).toBe("interactive");
  });
  it("treats both-hints-false (no decisive verb) as interactive", () => {
    expect(classifyToolGroup("create_directory", { readOnlyHint: false, destructiveHint: false })).toBe("interactive");
  });
  it("classifies a write verb with an underscore suffix as write (not read)", () => {
    expect(classifyToolGroup("create_view")).toBe("write");
    expect(classifyToolGroup("set_readonly_flag")).toBe("write");
    expect(classifyToolGroup("update_design")).toBe("write");
  });
});

describe("serverGroupDefaults", () => {
  it("returns the server's groupDefaults when present", () => {
    const s = { whitelisted: true, probe: { status: "hot" as const }, groupDefaults: { read: "allow" as const, interactive: "ask" as const, write: "blocked" as const }, tools: {} };
    expect(serverGroupDefaults(s).read).toBe("allow");
  });
  it("falls back to all-ask for a pre-existing server without the field", () => {
    const legacy = { whitelisted: true, probe: { status: "hot" as const }, tools: {} } as unknown as import("../../src/pflow/mcp-registry.js").McpRegistryServer;
    expect(serverGroupDefaults(legacy)).toEqual(DEFAULT_GROUP_DEFAULTS);
  });
});

describe("resolveToolPermission", () => {
  const s: McpRegistryServer = {
    whitelisted: true, probe: { status: "hot" },
    groupDefaults: { read: "allow", interactive: "ask", write: "blocked" },
    tools: {
      concrete: { group: "read", groupSource: "heuristic", permission: "ask" },
      follows:  { group: "read", groupSource: "heuristic", permission: "default" },
      writish:  { group: "write", groupSource: "heuristic", permission: "default" },
    },
  };
  it("returns a concrete permission as-is", () => { expect(resolveToolPermission(s, "concrete")).toBe("ask"); });
  it("resolves 'default' to the tool's group default", () => {
    expect(resolveToolPermission(s, "follows")).toBe("allow");
    expect(resolveToolPermission(s, "writish")).toBe("blocked");
  });
});

const server: McpRegistryServer = {
  whitelisted: true,
  probe: { status: "hot" },
  groupDefaults: { read: "ask", interactive: "ask", write: "ask" },
  tools: {
    get_design:    { group: "read",  groupSource: "heuristic", permission: "allow" },
    get_screenshot:{ group: "read",  groupSource: "heuristic", permission: "ask" },
    create_file:   { group: "write", groupSource: "heuristic", permission: "blocked" },
  },
};

describe("resolveServerGrants", () => {
  it("partitions tools by permission", () => {
    const g = resolveServerGrants(server);
    expect(g.allow).toEqual(["get_design"]);
    expect(g.ask).toEqual(["get_screenshot"]);
    expect(g.blocked).toEqual(["create_file"]);
  });

  it("sorts multiple tools within each bucket (deterministic order)", () => {
    const multi: McpRegistryServer = {
      whitelisted: true, probe: { status: "hot" },
      groupDefaults: DEFAULT_GROUP_DEFAULTS,
      tools: {
        zebra: { group: "read", groupSource: "heuristic", permission: "allow" },
        alpha: { group: "read", groupSource: "heuristic", permission: "allow" },
        mike:  { group: "read", groupSource: "heuristic", permission: "ask" },
        bravo: { group: "read", groupSource: "heuristic", permission: "ask" },
      },
    };
    const g = resolveServerGrants(multi);
    expect(g.allow).toEqual(["alpha", "zebra"]);
    expect(g.ask).toEqual(["bravo", "mike"]);
  });
});

describe("applyGroupPermission (sets the group default + collapses that group)", () => {
  it("sets groupDefaults[group] and collapses the group's tools to 'default'", () => {
    const next = applyGroupPermission(server, "write", "allow");
    expect(next.groupDefaults.write).toBe("allow");
    expect(next.tools.create_file.permission).toBe("default");
    expect(next.tools.get_design.permission).toBe("allow");
    expect(next.tools.get_screenshot.permission).toBe("ask");
    expect(resolveToolPermission(next, "create_file")).toBe("allow");
  });
  it("does not mutate the input server (immutable)", () => {
    applyGroupPermission(server, "write", "allow");
    expect(server.tools.create_file.permission).toBe("blocked");
    expect(server.groupDefaults.write).toBe("ask");
  });
});

import { snapshotGrants, isPolicyStricter } from "../../src/pflow/mcp-registry.js";
import { summarizeWorkflowResources } from "../../src/pflow/mcp-registry.js";
import type { PflowDocument } from "../../src/pflow/schema.js";

describe("snapshotGrants / isPolicyStricter", () => {
  const hot: McpRegistryServer = {
    whitelisted: true, probe: { status: "hot" },
    groupDefaults: DEFAULT_GROUP_DEFAULTS,
    tools: {
      a: { group: "read", groupSource: "heuristic", permission: "allow" },
      b: { group: "write", groupSource: "heuristic", permission: "ask" },
    },
  };
  it("snapshots tool→permission", () => {
    expect(snapshotGrants(hot)).toEqual({ a: "allow", b: "ask" });
  });
  it("flags a tool downgraded vs the snapshot as stricter", () => {
    // snapshot expected a=allow; local now blocks a → stricter
    const local = { ...hot, tools: { ...hot.tools, a: { ...hot.tools.a, permission: "blocked" as const } } };
    expect(isPolicyStricter({ a: "allow", b: "ask" }, local)).toEqual(["a"]);
  });
  it("returns [] when local is equal or looser", () => {
    const looser = { ...hot, tools: { ...hot.tools, b: { ...hot.tools.b, permission: "allow" as const } } };
    expect(isPolicyStricter({ a: "allow", b: "ask" }, looser)).toEqual([]);
  });
  it("treats a tool absent from the local registry as blocked (strictest)", () => {
    const empty: McpRegistryServer = { whitelisted: true, probe: { status: "hot" }, groupDefaults: DEFAULT_GROUP_DEFAULTS, tools: {} };
    // expected a=allow, but local has no `a` at all → absent = blocked = stricter
    expect(isPolicyStricter({ a: "allow" }, empty)).toEqual(["a"]);
  });
});

describe("grant functions resolve the 'default' sentinel", () => {
  const s: McpRegistryServer = {
    whitelisted: true, probe: { status: "hot" },
    groupDefaults: { read: "allow", interactive: "ask", write: "blocked" },
    tools: {
      r: { group: "read", groupSource: "heuristic", permission: "default" },
      w: { group: "write", groupSource: "heuristic", permission: "default" },
      pinned: { group: "read", groupSource: "heuristic", permission: "ask" },
    },
  };
  it("resolveServerGrants partitions by resolved permission", () => {
    const g = resolveServerGrants(s);
    expect(g.allow).toEqual(["r"]); expect(g.ask).toEqual(["pinned"]); expect(g.blocked).toEqual(["w"]);
  });
  it("snapshotGrants emits resolved concrete values", () => {
    expect(snapshotGrants(s)).toEqual({ r: "allow", w: "blocked", pinned: "ask" });
  });
  it("isPolicyStricter compares resolved values", () => {
    expect(isPolicyStricter({ r: "allow", w: "ask" }, s)).toEqual(["w"]);
  });
});

describe("summarizeWorkflowResources", () => {
  const doc = {
    pflowFormatVersion: 1, workflow: { name: "w", description: "d" },
    nodes: [
      { id: "a", kind: "mcp", label: "A", inputs: [], outputs: [], config: { mcpServer: "figma" } },
      { id: "b", kind: "mcp", label: "B", inputs: [], outputs: [], config: { mcpServer: "figma" } },
      { id: "c", kind: "mcp", label: "C", inputs: [], outputs: [], config: { mcpServer: "ghost" } },
      { id: "d", kind: "agent", label: "D", inputs: [], outputs: [] },
    ], wires: [],
  } as unknown as PflowDocument;
  const reg = { figma: { whitelisted: true, probe: { status: "hot" as const }, groupDefaults: DEFAULT_GROUP_DEFAULTS, tools: {
    get: { group: "read" as const, groupSource: "heuristic" as const, permission: "allow" as const },
  } } };
  it("rolls up per service with node counts and met/not-met", () => {
    const s = summarizeWorkflowResources(doc, reg);
    const figma = s.services.find((x) => x.server === "figma")!;
    expect(figma.nodeCount).toBe(2);
    expect(figma.available).toBe(true);
    expect(figma.allow).toBe(1);
    const ghost = s.services.find((x) => x.server === "ghost")!;
    expect(ghost.available).toBe(false);
    expect(s.allMet).toBe(false);
    expect(figma.ask).toBe(0);
    expect(figma.blocked).toBe(0);
    expect(ghost.allow).toBe(0);
    expect(ghost.ask).toBe(0);
    expect(ghost.blocked).toBe(0);
  });
  it("buckets an mcp node with no server under (none) as unavailable", () => {
    const unconfigured = {
      pflowFormatVersion: 1, workflow: { name: "w", description: "d" },
      nodes: [{ id: "x", kind: "mcp", label: "X", inputs: [], outputs: [], config: {} }],
      wires: [],
    } as unknown as PflowDocument;
    const s = summarizeWorkflowResources(unconfigured, {});
    const none = s.services.find((x) => x.server === "(none)")!;
    expect(none).toBeDefined();
    expect(none.nodeCount).toBe(1);
    expect(none.available).toBe(false);
    expect(s.allMet).toBe(false);
  });
  it("reports allMet true when every used service is available", () => {
    const onlyFigma = { ...doc, nodes: doc.nodes.filter((n) => n.id !== "c") } as PflowDocument;
    expect(summarizeWorkflowResources(onlyFigma, reg).allMet).toBe(true);
  });
  it("has no services for a workflow with no mcp nodes", () => {
    const plain = { ...doc, nodes: [doc.nodes[3]] } as PflowDocument;
    const s = summarizeWorkflowResources(plain, reg);
    expect(s.services).toEqual([]);
    expect(s.allMet).toBe(true);
  });
});
