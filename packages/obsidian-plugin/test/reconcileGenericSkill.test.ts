import { describe, it, expect } from "vitest";
import { decideGenericSkill } from "../src/skills/reconcileGenericSkill.js";
import { renderGenericSkill } from "@perspecta/core";

describe("decideGenericSkill", () => {
  it("installs when no file exists", () => {
    expect(decideGenericSkill(null, "0.1.0")).toBe("write");
  });
  it("upgrades when installed version is older", () => {
    const installed = renderGenericSkill("0.1.0");
    expect(decideGenericSkill(installed, "0.2.0")).toBe("write");
  });
  it("leaves alone when installed version equals bundled", () => {
    const installed = renderGenericSkill("0.2.0");
    expect(decideGenericSkill(installed, "0.2.0")).toBe("skip");
  });
  it("never downgrades when installed version is newer", () => {
    const installed = renderGenericSkill("0.3.0");
    expect(decideGenericSkill(installed, "0.2.0")).toBe("skip");
  });
  it("overwrites when installed stamp is unparseable/missing (self-heal)", () => {
    expect(decideGenericSkill("---\nname: perspecta-workflow\n---\nbody", "0.1.0")).toBe("write");
  });
});
