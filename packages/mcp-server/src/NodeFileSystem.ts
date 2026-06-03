import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { WorkflowFileSystem } from "@perspecta/core";

export class NodeFileSystem implements WorkflowFileSystem {
  readText(path: string): string { return readFileSync(path, "utf8"); }
  writeText(path: string, data: string): void { writeFileSync(path, data, "utf8"); }
  exists(path: string): boolean { return existsSync(path); }
  resolve(canvasDir: string, file: string): string { return resolve(canvasDir, file); }
}
