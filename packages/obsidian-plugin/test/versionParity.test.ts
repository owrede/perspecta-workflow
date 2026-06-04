import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { VERSION } from "@perspecta/core";

/**
 * The generic skill's `perspecta_version` stamp is generated from the core
 * `VERSION` constant (see reconcileGenericSkill / renderGenericSkill), but the
 * plugin ships its version in `manifest.json`. If those drift, the Tier-1
 * "update-if-newer" reconcile compares against a stale version and silently
 * stops upgrading the installed generic skill in every vault.
 *
 * This guard fails the build the moment the two diverge, forcing a version bump
 * to update BOTH places together.
 */
describe("version parity", () => {
  it("core VERSION matches the plugin manifest version", () => {
    const manifestPath = fileURLToPath(new URL("../manifest.json", import.meta.url));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
    expect(VERSION).toBe(manifest.version);
  });
});
