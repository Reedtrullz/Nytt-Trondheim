import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

const [output, rawTimeout, command, ...args] = process.argv.slice(2);
const timeout = Number(rawTimeout);
assert(output && command && Number.isInteger(timeout) && timeout > 0 && timeout <= 110000);
const limit = 512 * 1024;
const result = spawnSync(command, args, { timeout, maxBuffer: limit, killSignal: "SIGKILL" });
fs.writeFileSync(`${output}/stdout.txt`, (result.stdout ?? Buffer.alloc(0)).subarray(0, limit));
fs.writeFileSync(`${output}/stderr.txt`, (result.stderr ?? Buffer.alloc(0)).subarray(0, limit));
fs.writeFileSync(
  `${output}/collection.json`,
  JSON.stringify({
    status: result.status,
    signal: result.signal,
    error: result.error?.code ?? null,
    perStreamBytes: limit,
    timeoutMs: timeout,
  }) + "\n",
);
process.exit(result.error ? 1 : (result.status ?? 1));
