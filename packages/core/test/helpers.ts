import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkflowFileSystem } from "../src/fs.js";

/** A real-disk fs for tests that use fixture files. */
export const diskFs: WorkflowFileSystem = {
  readText: (p) => readFileSync(p, "utf8"),
  writeText: (p, d) => writeFileSync(p, d, "utf8"),
  exists: (p) => existsSync(p),
  resolve: (dir, file) => resolve(dir, file),
};
