import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const directory = fs.mkdtempSync("/tmp/home/output-guard-");
const collector = fileURLToPath(new URL("./bounded-output.mjs", import.meta.url));
const results = [];
try {
  for (const [name, code, expectedError] of [
    [
      "large-owned-file",
      "const fs=require('node:fs');const p=process.env.HOME+'/two-megabytes';try{fs.writeFileSync(p,Buffer.alloc(2*1024*1024));require('node:assert/strict').equal(fs.statSync(p).size,2*1024*1024)}finally{fs.rmSync(p,{force:true})}",
      null,
    ],
    [
      "scratch-cap",
      "const fs=require('node:fs'),a=require('node:assert/strict'),p=process.env.HOME+'/over-scratch';try{a.throws(()=>fs.writeFileSync(p,Buffer.alloc(17*1024*1024)),e=>e.code==='ENOSPC')}finally{fs.rmSync(p,{force:true})}",
      null,
    ],
    ["stdout-cap", "process.stdout.write(Buffer.alloc(1024*1024))", "ENOBUFS"],
    ["stderr-cap", "process.stderr.write(Buffer.alloc(1024*1024))", "ENOBUFS"],
    ["hung-child", "setInterval(()=>{},1000)", "ETIMEDOUT"],
  ]) {
    const output = `${directory}/${name}`;
    fs.mkdirSync(output);
    const child = spawnSync(
      process.execPath,
      [collector, output, "1000", process.execPath, "-e", code],
      { timeout: 5000, maxBuffer: 65536 },
    );
    assert.equal(child.error, undefined, name);
    const receipt = JSON.parse(fs.readFileSync(`${output}/collection.json`, "utf8"));
    assert.equal(receipt.error, expectedError, name);
    assert.equal(child.status, expectedError ? 1 : 0, name);
    for (const stream of ["stdout", "stderr"])
      assert(fs.statSync(`${output}/${stream}.txt`).size <= 512 * 1024, name);
    results.push({ name, error: receipt.error, signal: receipt.signal, passed: true });
  }
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}
console.log(
  JSON.stringify({
    scope: "Output-versus-scratch guard correction only; no application imports",
    results,
    cleanup: true,
  }),
);
