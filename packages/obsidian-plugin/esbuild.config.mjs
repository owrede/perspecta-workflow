import esbuild from "esbuild";
import builtins from "builtin-modules";

const watch = process.argv.includes("--watch");
const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: [
    "obsidian",
    "electron",
    ...builtins,
    ...builtins.map((m) => `node:${m}`),
  ],
  outfile: "main.js",
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
});

if (watch) { await ctx.watch(); } else { await ctx.rebuild(); await ctx.dispose(); }
