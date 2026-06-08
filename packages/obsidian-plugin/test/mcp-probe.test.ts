import { describe, it, expect } from "vitest";
import { probedToolsToRegistry } from "../src/mcp/probe.js";

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
