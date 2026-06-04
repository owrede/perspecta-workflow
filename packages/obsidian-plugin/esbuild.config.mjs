import esbuild from "esbuild";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const watch = process.argv.includes("--watch");
const require = createRequire(import.meta.url);

// Concatenate perspecta-ui's shared CSS into the plugin's styles.css so the
// shared `perspecta-ui-*` classes ship with the plugin and stay in sync.
// The plugin's own styles live in styles.base.css; styles.css is generated.
function buildStyles() {
  const here = fileURLToPath(new URL(".", import.meta.url));
  // Resolve perspecta-ui regardless of where npm hoisted the symlink.
  const uiPkg = require.resolve("perspecta-ui/package.json");
  const sharedPath = join(dirname(uiPkg), "styles", "perspecta-ui.css");
  const basePath = `${here}styles.base.css`;
  const outPath = `${here}styles.css`;
  const shared = existsSync(sharedPath) ? readFileSync(sharedPath, "utf8") : "";
  const base = existsSync(basePath) ? readFileSync(basePath, "utf8") : "";
  writeFileSync(
    outPath,
    `/* GENERATED — edit styles.base.css; perspecta-ui CSS is concatenated below. */\n` +
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
  external: ["obsidian", "electron"],
  outfile: "main.js",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});

if (watch) { await ctx.watch(); } else { await ctx.rebuild(); await ctx.dispose(); }
