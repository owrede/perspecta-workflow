import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// The built server entry (bin). The plugin bundles this same module, so the
// process-entry guard exercised here is the one shipped to users.
const DIST_SERVER = fileURLToPath(new URL("../dist/server.js", import.meta.url));

/**
 * Spawn `node <entryPath>` and send an MCP `initialize` request. Resolves to the
 * server's JSON-RPC response line, or rejects on timeout (which is exactly the
 * silent-dead-server symptom the entry guard must avoid).
 */
function initializeViaSpawn(entryPath: string, timeoutMs = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entryPath], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`no initialize response within ${timeoutMs}ms (stderr: ${err.slice(0, 300)})`));
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      out += d.toString();
      if (out.includes('"serverInfo"')) {
        clearTimeout(timer);
        child.kill();
        resolve(out);
      }
    });
    child.stderr.on("data", (d) => { err += d.toString(); });
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } },
      }) + "\n",
    );
  });
}

describe("server process-entry guard (spawned)", () => {
  let tmp: string | undefined;
  afterEach(() => {
    if (tmp) { rmSync(tmp, { recursive: true, force: true }); tmp = undefined; }
  });

  it("connects when spawned directly", async () => {
    const res = await initializeViaSpawn(DIST_SERVER);
    expect(res).toContain('"serverInfo"');
    expect(res).toContain("perspecta-workflow");
  });

  it("connects when spawned via a path containing a space and a symlink", async () => {
    // import.meta.url percent-encodes the space and resolves the symlink;
    // process.argv[1] does neither. A naive string compare guard fails here and
    // the server connects to nothing (exit 0, no output). The realpath-based
    // guard must hold. The symlink avoids copying the entry's node_modules.
    tmp = mkdtempSync(join(tmpdir(), "pflow mcp ")); // note the spaces
    const linkDir = join(tmp, "link dir");
    mkdirSync(linkDir);
    const linkedEntry = join(linkDir, "server.js");
    symlinkSync(DIST_SERVER, linkedEntry);

    const res = await initializeViaSpawn(linkedEntry);
    expect(res).toContain('"serverInfo"');
  });
});
