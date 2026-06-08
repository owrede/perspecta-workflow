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
  external: ["obsidian", "electron", "@modelcontextprotocol/sdk"],
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

// ---- Bundle the MCP server into a self-contained file shipped in the plugin
// folder. The agent (Claude Code) spawns this as its own Node child process
// over stdio — it is NOT loaded into Obsidian's renderer — so it targets
// platform:node and INLINES all deps (opposite of the main bundle, which keeps
// @modelcontextprotocol/sdk external). Output sits next to main.js so it ships
// with the plugin and the "Copy setup prompt" button can point node at it.
const serverCtx = await esbuild.context({
  entryPoints: ["../mcp-server/src/server.ts"],
  bundle: true,
  // The server entry uses top-level await and import.meta.url, which require
  // ESM format. CJS does not support either. We emit .mjs so Node treats the
  // file as ESM regardless of the nearest package.json's "type" field.
  // The banner polyfills `require` for bundled CJS deps (e.g. yaml) whose
  // dynamic require() calls would otherwise throw in an ESM context.
  format: "esm",
  platform: "node",
  target: "node18",
  outfile: "mcp-server.mjs",
  sourcemap: false,
  logLevel: "info",
  banner: {
    js: `import { createRequire } from "module"; const require = createRequire(import.meta.url);`,
  },
  // No externals: the server must run with only the user's system `node`.
});

if (watch) { await serverCtx.watch(); } else { await serverCtx.rebuild(); await serverCtx.dispose(); }
