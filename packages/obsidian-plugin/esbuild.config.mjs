import esbuild from "esbuild";
import sveltePlugin from "esbuild-svelte";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const watch = process.argv.includes("--watch");
const require = createRequire(import.meta.url);

// Concatenate the @xyflow/svelte stylesheet + perspecta-ui's shared CSS into
// the plugin's styles.css so they ship with the plugin (Obsidian auto-loads
// styles.css). The xyflow CSS must be loaded here, NOT via a `import
// "@xyflow/svelte/dist/style.css"` side-effect in a .svelte file: esbuild
// routes that import to a SEPARATE main.css that Obsidian never loads, leaving
// the canvas completely unstyled (no node sizing, no handle placement, light
// background). The plugin's own styles live in styles.base.css; styles.css is
// generated.
function buildStyles() {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // Resolve perspecta-ui regardless of where npm hoisted the symlink.
  const uiPkg = require.resolve("perspecta-ui/package.json");
  const sharedPath = join(dirname(uiPkg), "styles", "perspecta-ui.css");
  const xyflowPath = require.resolve("@xyflow/svelte/dist/style.css");
  const basePath = `${here}styles.base.css`;
  const outPath = `${here}styles.css`;
  const xyflow = existsSync(xyflowPath) ? readFileSync(xyflowPath, "utf8") : "";
  const shared = existsSync(sharedPath) ? readFileSync(sharedPath, "utf8") : "";
  const base = existsSync(basePath) ? readFileSync(basePath, "utf8") : "";
  writeFileSync(
    outPath,
    `/* GENERATED — edit styles.base.css; xyflow + perspecta-ui CSS concatenated below. */\n` +
      "\n/* ---- @xyflow/svelte base styles ---- */\n" +
      xyflow +
      "\n/* ---- plugin styles (styles.base.css) ---- */\n" +
      base +
      "\n/* ---- perspecta-ui shared styles ---- */\n" +
      shared,
  );
}

buildStyles();

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  // child_process (unprefixed) is externalized so esbuild emits a CommonJS
  // require("child_process") that Electron's renderer resolves at load time.
  // probe.ts statically imports spawn from it to launch the bundled
  // mcp-probe.mjs. NOTE: a dynamic import("node:child_process") does NOT work in
  // the renderer (its ESM loader tries to fetch the bare specifier and fails);
  // must be a static import of the unprefixed name. The SDK stays external
  // because the probe runs it in that spawned Node child, never in the renderer.
  external: ["obsidian", "electron", "@modelcontextprotocol/sdk", "child_process", "fs"],
  outfile: "main.js",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  conditions: ["svelte", "browser"],
  mainFields: ["svelte", "browser", "module", "main"],
  plugins: [
    // No svelte-preprocess: components use plain `lang="ts"` (no SCSS/Less), and
    // esbuild-svelte compiles TypeScript natively. svelte-preprocess additionally
    // type-checks, which fails on third-party .svelte files under node_modules
    // (TS6059 rootDir) — esbuild bundling + the separate `tsc` gate cover us.
    sveltePlugin({
      compilerOptions: { css: "injected" },
    }),
  ],
});

if (watch) { await ctx.watch(); } else { await ctx.rebuild(); await ctx.dispose(); }

// ---- Node-side bundles shipped INSIDE the plugin folder, spawned by the plugin
// as their own Node child processes (NOT loaded into Obsidian's renderer):
//   - mcp-server.mjs : the workflow MCP server the user's agent connects to.
//   - mcp-probe.mjs  : connects to another MCP server and lists its tools, so
//                      the MCP settings tab can probe servers. The renderer must
//                      NOT import the MCP SDK directly — it has no module
//                      resolver for it and the SDK's stdio client needs Node.
// Both target platform:node and INLINE all deps (opposite of the browser main
// bundle, which keeps @modelcontextprotocol/sdk external) so they run with only
// the user's system `node`. ESM (.mjs): the entries use top-level await and/or
// import.meta.url, which CJS cannot host; Node runs .mjs as ESM regardless of
// the nearest package.json "type". The banner polyfills `require` for bundled
// CJS deps (e.g. yaml) whose dynamic require() would otherwise throw under ESM.
async function nodeBundle(entryPoint, outfile) {
  const ctx = await esbuild.context({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile,
    sourcemap: watch ? "inline" : false,
    logLevel: "info",
    banner: { js: `import { createRequire } from "module"; const require = createRequire(import.meta.url);` },
    // No externals: must run with only the user's system `node`.
  });
  if (watch) { await ctx.watch(); } else { await ctx.rebuild(); await ctx.dispose(); }
}

await nodeBundle("../mcp-server/src/server.ts", "mcp-server.mjs");
await nodeBundle("../mcp-server/src/probe-cli.ts", "mcp-probe.mjs");
