import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const source = readFileSync("src/export.ts");
assert.equal(hash(source), "963a91bf22ff3bb5f967301fbbf38f2de55ce9301547db386f1176e9e8f70930");
const production = readFileSync("dist/export.js");
writeFileSync("/baseline/production-export.js", production, { flag: "wx" });
const require = createRequire("/app/apps/server/package.json");
const compiler = require.resolve("typescript/bin/tsc");
const invoke = (args) =>
  execFileSync(process.execPath, [compiler, ...args], {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 1048576,
  });
const version = invoke(["--version"]).trim();
const config = JSON.parse(invoke(["-p", "export-baseline.tsconfig.json", "--showConfig"]));
const productionConfig = JSON.parse(invoke(["-p", "tsconfig.json", "--showConfig"]));
assert.deepEqual(config.compilerOptions, productionConfig.compilerOptions);
const declaredProject = JSON.parse(readFileSync("export-baseline.tsconfig.json", "utf8"));
assert.deepEqual(declaredProject, {
  extends: "./tsconfig.json",
  files: ["src/export.ts"],
  include: [],
});
const loadedFiles = invoke(["-p", "export-baseline.tsconfig.json", "--listFilesOnly"])
  .trim()
  .split("\n");
assert(loadedFiles.includes("/app/apps/server/src/export.ts"));
invoke(["-p", "export-baseline.tsconfig.json"]);
const emitted = readFileSync("dist/export.js");
assert.deepEqual(
  emitted,
  production,
  "entry-only compilation differs from the actual production build",
);
const receipt = {
  source: "6722beceda30a82afe7229414f68865b138d623f",
  sourceSha256: hash(source),
  productionSha256: hash(production),
  baselineSha256: hash(emitted),
  compiler,
  compilerSha256: hash(readFileSync(compiler)),
  version,
  config,
  declaredProject,
  loadedFiles,
  lockSha256: hash(readFileSync("/app/pnpm-lock.yaml")),
  byteIdentical: true,
};
writeFileSync("/baseline/compiler.json", JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify(receipt) + "\n");
