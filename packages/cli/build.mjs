// Bundles the CLI into one file (no runtime deps) and copies the house set + golden fixtures into the package.
import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
rmSync("dist", { recursive: true, force: true });
await build({
  entryPoints: ["src/cli.ts"], bundle: true, platform: "node", format: "esm", target: "node20", outfile: "dist/semalam.mjs",
  banner: { js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  legalComments: "none",
});
cpSync("../../house/house-set.json", "house-set.json");
mkdirSync("fixtures", { recursive: true });
cpSync("../../fixtures/golden", "fixtures/golden", { recursive: true });
console.log("built dist/semalam.mjs");
