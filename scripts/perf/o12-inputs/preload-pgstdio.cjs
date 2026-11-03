// QA transport adapter: replaces ONLY pg's socket (pg/lib/stream.js getStream) with a duplex over `docker exec -i CONTAINER bash`
// relaying raw PostgreSQL wire bytes to the container's own loopback :5432 (NetworkMode=none, no host port).
// The real pg driver, pg.Pool, auth and wire protocol run unchanged. Egress from the node process is blocked (QA_OFFLINE=1).
const path = require("node:path");
const { Duplex } = require("node:stream");
const { spawn } = require("node:child_process");
const pgRoot = process.env.QA_PG_ROOT;
const cname = process.env.QA_CNAME;
class DockerStdioSocket extends Duplex {
  constructor() { super(); this.child = null; this.remoteAddress = "docker-exec-stdio"; }
  setNoDelay() { return this; } setKeepAlive() { return this; } setTimeout() { return this; } ref() { return this; } unref() { return this; }
  connect() {
    this.child = spawn("docker", ["exec", "-i", cname, "bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/5432; (cat <&3; kill $$) & cat >&3"], { stdio: ["pipe", "pipe", "pipe"] });
    this.child.stdout.on("data", (d) => this.push(d));
    this.child.stdout.on("end", () => this.push(null));
    this.child.on("error", (e) => this.destroy(e));
    this.child.stdin.on("error", () => {});
    setImmediate(() => this.emit("connect"));
    return this;
  }
  _read() {}
  _write(chunk, enc, cb) { this.child.stdin.write(chunk, cb); }
  _final(cb) { this.child.stdin.end(); cb(); }
  _destroy(err, cb) { try { this.child && this.child.kill(); } catch {} cb(err); }
}
if (pgRoot && cname) require(path.join(pgRoot, "lib/stream.js")).getStream = () => new DockerStdioSocket();
if (process.env.QA_OFFLINE === "1") {
  const net = require("node:net");
  const block = (what) => () => { throw new Error("QA offline: " + what + " blocked"); };
  net.Socket.prototype.connect = block("net.Socket.connect");
  require("node:http").request = block("http.request");
  require("node:https").request = block("https.request");
  globalThis.fetch = async (input) => { throw new TypeError("fetch failed (QA offline stub): " + String(input)); };
}
