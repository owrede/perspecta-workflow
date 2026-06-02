import { describe, it, expect } from "vitest";
import { NODE_TYPES, NODE_COLORS } from "../src/types.js";

describe("node type constants", () => {
  it("defines all eight workflow node types", () => {
    expect(NODE_TYPES).toEqual([
      "start", "end", "prompt", "tool", "data", "contract", "loop", "config",
    ]);
  });

  it("maps every node type to a canvas color string", () => {
    for (const t of NODE_TYPES) {
      expect(typeof NODE_COLORS[t]).toBe("string");
    }
  });
});
