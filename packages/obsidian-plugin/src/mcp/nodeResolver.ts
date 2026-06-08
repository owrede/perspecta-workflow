// Resolve a usable `node` binary from inside the Obsidian renderer.
//
// Why this exists: a macOS app launched from Finder/Dock inherits a minimal PATH
// (/usr/bin:/bin:...) that does NOT include nvm, Homebrew, or Volta node installs.
// So `spawn("node", ...)` throws ENOENT even though `node` works in the user's
// terminal. We probe known install locations (and PATH, in case Obsidian was
// launched from a shell) and return the first node that exists.
//
// `fs` is imported unprefixed + marked external so esbuild emits a CommonJS
// require("fs") that the renderer resolves at load time (a dynamic
// import("node:fs") would fail to fetch in the renderer — same trap as
// child_process; see probe.ts).
import { existsSync, readdirSync } from "fs";

/** nvm installs live at ~/.nvm/versions/node/<version>/bin/node. Enumerate them
 *  newest-first (by directory name, reverse-sorted) so a probe prefers a recent
 *  Node. Returns [] if nvm isn't present. */
function nvmNodePaths(home: string, readdir: (p: string) => string[]): string[] {
  if (!home) return [];
  const versionsDir = `${home}/.nvm/versions/node`;
  try {
    return readdir(versionsDir)
      .sort()
      .reverse()
      .map((v) => `${versionsDir}/${v}/bin/node`);
  } catch {
    return []; // dir missing / unreadable → no nvm
  }
}

/** Candidate absolute node paths, in preference order. Covers PATH (if Obsidian
 *  was launched from a shell), Apple-silicon + Intel Homebrew, nvm (enumerated),
 *  Volta, and the system path. */
function candidateNodePaths(env: NodeJS.ProcessEnv, readdir: (p: string) => string[]): string[] {
  const home = env.HOME ?? "";
  const fromPath = (env.PATH ?? "")
    .split(":")
    .filter(Boolean)
    .map((dir) => `${dir}/node`);
  return [
    // PATH first: if Obsidian was launched from a terminal, honor the user's choice.
    ...fromPath,
    "/opt/homebrew/bin/node", // Apple-silicon Homebrew
    "/usr/local/bin/node", // Intel Homebrew / manual installs
    ...nvmNodePaths(home, readdir), // nvm installs, newest first
    home ? `${home}/.volta/bin/node` : "", // Volta shim
    "/usr/bin/node", // system (rare on macOS, common on Linux)
  ].filter(Boolean);
}

/**
 * Return the first existing `node` binary path, or null if none is found.
 *
 * @param env  process environment (injectable for tests)
 * @param exists  fs.existsSync (injectable for tests)
 * @param readdir  fs.readdirSync (injectable for tests; used to enumerate nvm)
 */
export function resolveNodePath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (p: string) => boolean = existsSync,
  readdir: (p: string) => string[] = (p) => readdirSync(p),
): string | null {
  for (const candidate of candidateNodePaths(env, readdir)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

/** Human-readable reason shown when no node is found, listing where we looked. */
export const NO_NODE_REASON =
  "Could not find a `node` binary. Obsidian (launched from the Dock) does not see " +
  "nvm/Homebrew installs. Install Node, or launch Obsidian from a terminal so it " +
  "inherits your PATH.";

/**
 * Build a PATH that includes the common user/tool bin directories a GUI-launched
 * Obsidian is missing, so a spawned probe helper can find target server commands
 * (npx, uvx, vault-memory, etc.) — not just node. The existing PATH is kept first
 * (honored when Obsidian was launched from a shell), then the well-known dirs are
 * appended (deduped). Covers Homebrew (both arches), uv/pipx (~/.local/bin),
 * Cargo (~/.cargo/bin), all nvm node bins, Volta, and /usr/local.
 *
 * @param env  process environment (injectable for tests)
 * @param readdir  fs.readdirSync (injectable; used to enumerate nvm bins)
 */
export function augmentedPath(
  env: NodeJS.ProcessEnv = process.env,
  readdir: (p: string) => string[] = (p) => readdirSync(p),
): string {
  const home = env.HOME ?? "";
  const existing = (env.PATH ?? "").split(":").filter(Boolean);
  const nvmBins = nvmNodePaths(home, readdir).map((p) => p.replace(/\/node$/, ""));
  const wellKnown = [
    home ? `${home}/.local/bin` : "", // uv / uvx / pipx
    "/opt/homebrew/bin", // Apple-silicon Homebrew
    "/usr/local/bin", // Intel Homebrew / manual
    ...nvmBins, // nvm node bins (npx, vault-memory, …)
    home ? `${home}/.volta/bin` : "", // Volta
    home ? `${home}/.cargo/bin` : "", // Cargo
    "/usr/bin",
    "/bin",
  ].filter(Boolean);
  // Dedupe, preserving order (existing PATH wins).
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const dir of [...existing, ...wellKnown]) {
    if (!seen.has(dir)) { seen.add(dir); merged.push(dir); }
  }
  return merged.join(":");
}
