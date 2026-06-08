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
});
