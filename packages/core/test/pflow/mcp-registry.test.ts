import { describe, it, expect } from "vitest";
import { classifyToolGroup } from "../../src/pflow/mcp-registry.js";

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
