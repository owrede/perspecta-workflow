import { describe, it, expect } from "vitest";
import { classifyToolGroup, resolveServerGrants, applyGroupPermission } from "../../src/pflow/mcp-registry.js";
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
  it("classifies an unknown verb as write (safe side)", () => {
    expect(classifyToolGroup("frobnicate")).toBe("write");
  });
  it("classifies a write verb with an underscore suffix as write (not read)", () => {
    // `\b` regression: create_view must be write, not read (the trailing _view
    // must not pull it into the read group).
    expect(classifyToolGroup("create_view")).toBe("write");
    expect(classifyToolGroup("set_readonly_flag")).toBe("write");
    expect(classifyToolGroup("update_design")).toBe("write");
  });
});

const server: McpRegistryServer = {
  whitelisted: true,
  probe: { status: "hot" },
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

describe("applyGroupPermission", () => {
  it("sets every tool in a group to the new permission (returns a new server)", () => {
    // create_file starts "blocked"; apply "allow" to the write group → it flips.
    const next = applyGroupPermission(server, "write", "allow");
    expect(next.tools.create_file.permission).toBe("allow"); // write tool changed
    expect(next.tools.get_design.permission).toBe("allow");   // read tool untouched
    expect(next.tools.get_screenshot.permission).toBe("ask"); // read tool untouched
  });
  it("does not mutate the input server (immutable)", () => {
    // Applying a DIFFERENT permission than the fixture has must leave the input intact.
    applyGroupPermission(server, "write", "allow");
    expect(server.tools.create_file.permission).toBe("blocked"); // original preserved
  });
});

import { snapshotGrants, isPolicyStricter } from "../../src/pflow/mcp-registry.js";

describe("snapshotGrants / isPolicyStricter", () => {
  const hot: McpRegistryServer = {
    whitelisted: true, probe: { status: "hot" },
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
    const empty: McpRegistryServer = { whitelisted: true, probe: { status: "hot" }, tools: {} };
    // expected a=allow, but local has no `a` at all → absent = blocked = stricter
    expect(isPolicyStricter({ a: "allow" }, empty)).toEqual(["a"]);
  });
});
