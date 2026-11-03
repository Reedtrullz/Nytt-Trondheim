import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import process from "node:process";
import console from "node:console";
import { Buffer } from "node:buffer";

assert.equal(process.getuid(), 65534);
assert.equal(process.env.HOME, "/tmp/home");
assert.equal(process.platform, "linux");
const mounts = fs.readFileSync("/proc/self/mountinfo", "utf8").split("\n");
assert(
  mounts.some((line) => line.split(" ")[4] === "/" && line.split(" ")[5].split(",").includes("ro")),
);
assert(mounts.some((line) => line.split(" ")[4] === "/tmp" && line.includes("tmpfs")));
const scratch = fs.statfsSync("/tmp");
assert(scratch.blocks * scratch.bsize <= 16 * 1024 * 1024);
for (const [label, operation] of [
  ["privateRead", () => fs.readFileSync("/tmp/private/canary")],
  ["outsideWrite", () => fs.writeFileSync("/etc/portfolio-admission-must-deny", "authored")],
]) {
  assert.throws(operation, (error) => ["EACCES", "EPERM", "EROFS"].includes(error.code), label);
}
fs.writeFileSync("/tmp/home/owned", "authored");
assert.equal(fs.readFileSync("/tmp/home/owned", "utf8"), "authored");
fs.unlinkSync("/tmp/home/owned");

const server = net.createServer((socket) => socket.end("authored"));
server.listen(0, "127.0.0.1");
await once(server, "listening");
try {
  const address = server.address();
  assert(address && typeof address === "object");
  const client = net.connect(address.port, "127.0.0.1");
  const chunks = [];
  client.on("data", (value) => chunks.push(value));
  await once(client, "end");
  assert.equal(Buffer.concat(chunks).toString(), "authored");
} finally {
  server.close();
  await once(server, "close");
}
const denied = await new Promise((resolve, reject) => {
  const socket = net.connect({ host: "203.0.113.1", port: 9 });
  socket.setTimeout(1000, () => {
    socket.destroy();
    reject(new Error("Egress failed to reject immediately"));
  });
  socket.once("connect", () => {
    socket.destroy();
    reject(new Error("Unexpected external connection"));
  });
  socket.once("error", (error) => {
    socket.destroy();
    resolve(error.code);
  });
});
assert(["ENETUNREACH", "EHOSTUNREACH"].includes(denied));
const fromVitest = createRequire(import.meta.resolve("vitest/package.json"));
const fromVite = createRequire(fromVitest.resolve("vite/package.json"));
assert.equal(fromVite("rollup/parseAst").parseAst("const authored = 1;").body.length, 1);
const fromTsx = createRequire(import.meta.resolve("tsx/package.json"));
assert(
  fromTsx("esbuild")
    .transformSync("const authored: number = 1;", { loader: "ts" })
    .code.includes("authored"),
);
const hashes = Object.fromEntries(
  ["pnpm-lock.yaml", "package.json", "apps/server/src/store.ts"].map((path) => [
    path,
    createHash("sha256").update(fs.readFileSync(path)).digest("hex"),
  ]),
);
console.log(
  JSON.stringify({
    scope:
      "Kernel/private-file/native-addon capability only; no application or performance acceptance",
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    uid: process.getuid(),
    readOnlyRoot: true,
    privateReadDenied: true,
    outsideWriteDenied: true,
    ownedWritePassed: true,
    loopbackPassed: true,
    externalConnectDenied: denied,
    rollupNativeParser: true,
    esbuildNativeTransform: true,
    hashes,
    applicationImported: false,
    serversClosed: true,
  }),
);
