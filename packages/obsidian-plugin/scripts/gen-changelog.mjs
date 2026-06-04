#!/usr/bin/env node
/**
 * Generate src/changelog.generated.ts from CHANGELOG.md.
 *
 * CHANGELOG.md (Keep a Changelog style) is the SOURCE OF TRUTH. This build step
 * parses it with perspecta-ui's parseChangelog and emits a typed constant the
 * settings Changelog tab imports — so there is no hand-maintained parallel
 * TypeScript changelog (Suite Convention Catalog §5.6).
 *
 *   node scripts/gen-changelog.mjs          # write src/changelog.generated.ts
 *   node scripts/gen-changelog.mjs --check  # fail if it would change (CI)
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseChangelog } from "../vendor/perspecta-ui/dist/shared/changelog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const checkOnly = process.argv.includes("--check");

const md = readFileSync(join(rootDir, "CHANGELOG.md"), "utf-8");
const entries = parseChangelog(md);

if (entries.length === 0) {
  console.error("No changelog entries parsed from CHANGELOG.md");
  process.exit(1);
}

const out =
  "// GENERATED FROM CHANGELOG.md by scripts/gen-changelog.mjs — do not edit.\n" +
  "// CHANGELOG.md is the source of truth; run `npm run changelog` to regenerate.\n" +
  'import type { ChangelogModel } from "perspecta-ui";\n\n' +
  `export const CHANGELOG: ChangelogModel = ${JSON.stringify(entries, null, 2)};\n`;

const outPath = join(rootDir, "src", "changelog.generated.ts");

if (checkOnly) {
  let current = "";
  try {
    current = readFileSync(outPath, "utf-8");
  } catch {
    current = "";
  }
  if (current !== out) {
    console.error("src/changelog.generated.ts is out of date. Run: npm run changelog");
    process.exit(1);
  }
  console.log(`changelog.generated.ts is up to date (${entries.length} versions)`);
} else {
  writeFileSync(outPath, out);
  console.log(`Generated src/changelog.generated.ts with ${entries.length} versions`);
}
