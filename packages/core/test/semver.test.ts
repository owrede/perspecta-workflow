import { describe, it, expect } from "vitest";
import { compareSemver } from "../src/semver.js";

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
  });
  it("returns negative when a < b", () => {
    expect(compareSemver("0.1.0", "0.2.0")).toBeLessThan(0);
    expect(compareSemver("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareSemver("1.0.0", "2.0.0")).toBeLessThan(0);
  });
  it("returns positive when a > b", () => {
    expect(compareSemver("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareSemver("1.2.3", "1.2.0")).toBeGreaterThan(0);
  });
  it("tolerates missing patch/minor as 0", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.2", "1.2.0")).toBe(0);
  });
  it("treats unparseable input as 0.0.0", () => {
    expect(compareSemver("garbage", "0.0.1")).toBeLessThan(0);
    expect(compareSemver("garbage", "garbage")).toBe(0);
  });
});
