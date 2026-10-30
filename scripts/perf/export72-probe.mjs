import { createHash } from "node:crypto";
import { createSocket } from "node:dgram";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import { connect } from "node:net";
import { networkInterfaces, tmpdir } from "node:os";
import process from "node:process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { crc32, deflateRawSync, deflateSync, inflateRawSync, inflateSync } from "node:zlib";
import { Buffer } from "node:buffer";
import { URL, fileURLToPath } from "node:url";

const CLOCK_TITLE = "EXPORT72 FIXTURE";
const PROVENANCE = ["official", "reporting_estimate", "preparedness_context", "private_annotation"];

function fail(code, detail) {
  const error = new Error(detail);
  error.codeName = code;
  throw error;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeFilename(filename) {
  const name = filename.split(/[\\/]/).pop() ?? "vedlegg";
  const sanitized = [...name]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === '"' ? "_" : character;
    })
    .join("");
  return sanitized.slice(0, 180) || "vedlegg";
}

function backingBytes() {
  const parts = [];
  for (let index = 0; index < 65536; index += 1) {
    parts.push(createHash("sha256").update(`export72-v1:${index}`).digest());
  }
  return Buffer.concat(parts);
}

function assertCase(caseFile, raw) {
  if (caseFile.schema !== "nytt-export72-case-v1") fail("malformed", "schema");
  if (caseFile.backing.bytes !== 2097152 || raw.length !== 2097152)
    fail("malformed", "backing length");
  if (sha256(raw) !== caseFile.backing.sha256) fail("digest", "backing digest");
  if (caseFile.maxAttachments.count !== 25) fail("malformed", "attachment count");
  if (caseFile.maxAttachments.logicalBytes !== 25 * raw.length) fail("logical", "logical size");
  if (caseFile.limits.tmpfsBytes !== 16777216) fail("scratch", "tmpfs cap");
  if (caseFile.limits.denyScratchBytes !== 17825792) fail("scratch", "deny size");
  if (caseFile.limits.memoryBytes !== 536870912 || caseFile.limits.outputBytes !== 1048576) {
    fail("malformed", "admitted caps");
  }
  const names = caseFile.maxAttachments.names.map((name) => safeFilename(name));
  if (names.length !== 25 || new Set(names).size !== 25) fail("names", "unique names");
  if (names.some((name, index) => name !== caseFile.maxAttachments.names[index]))
    fail("names", "unsafe name");
  if (deflateRawSync(raw, { level: 9 }).length < raw.length)
    fail("digest", "backing is compressible");
  if (caseFile.fixedMembers.length !== 10) fail("malformed", "fixed members");
}

function readZip(buffer) {
  let eocd = -1;
  const min = Math.max(0, buffer.length - 65557);
  for (let offset = buffer.length - 22; offset >= min; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) fail("zip", "missing directory");
  const count = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail("zip", "bad entry");
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    cursor += 46 + nameLength + extraLength + commentLength;
    let data = Buffer.alloc(0);
    if (!name.endsWith("/")) {
      if (buffer.readUInt32LE(localOffset) !== 0x04034b50) fail("zip", "bad local header");
      const localName = buffer.readUInt16LE(localOffset + 26);
      const localExtra = buffer.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const compressed = buffer.subarray(start, start + compressedSize);
      data =
        method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
      if (!data || data.length !== size || crc32(data) >>> 0 !== checksum)
        fail("zip", `checksum ${name}`);
    }
    entries.push({ name, data });
  }
  return entries;
}

function storedZip(name, data, method = 0) {
  const checksum = crc32(data) >>> 0;
  const nameBytes = Buffer.from(name);
  const payload = method === 8 ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(20, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBytes.length, 28);
  central.writeUInt32LE(0, 42);
  const directory = Buffer.concat([central, nameBytes]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(local.length + nameBytes.length + payload.length, 16);
  return Buffer.concat([local, nameBytes, payload, directory, eocd]);
}

function model(caseFile, attachments) {
  const features = PROVENANCE.map((provenance, index) => ({
    type: "Feature",
    id: `f-${provenance}`,
    geometry: { type: "Point", coordinates: [10 + index, 63.43] },
    properties: { label: provenance, provenance, updatedAt: caseFile.clock },
  }));
  const evidence = [
    {
      id: "e1",
      situationId: "export72",
      source: "nrk",
      sourceLabel: "NRK",
      sourceUrl: "https://example.invalid/export72",
      supportingSnippet: "synthetic",
      claim: "export72 fixture",
      claimType: "status",
      provenance: "official",
      confidence: 1,
      extractedAt: caseFile.clock,
      publishedAt: caseFile.clock,
    },
  ];
  const timeline = [
    {
      id: "t1",
      situationId: "export72",
      timestamp: caseFile.clock,
      title: "Fixture",
      detail: "synthetic baseline",
      sourceLabel: "NRK",
      sourceUrl: "https://example.invalid/export72",
      official: true,
    },
  ];
  const tasks = [
    {
      id: "task-1",
      situationId: "export72",
      text: "check export",
      completed: false,
      createdAt: caseFile.clock,
    },
  ];
  const notes = [
    {
      id: "note-1",
      situationId: "export72",
      text: caseFile.privateWarning,
      createdAt: caseFile.clock,
    },
  ];
  return {
    workspace: {
      situation: {
        id: "export72",
        type: "other",
        title: CLOCK_TITLE,
        summary: "synthetic export72 baseline",
        status: "active",
        verificationStatus: "Foreløpig fra rapportering",
        importance: "normal",
        updatedAt: caseFile.clock,
        createdAt: caseFile.clock,
        locationLabel: "Trondheim",
        relatedArticleIds: [],
        evidence,
        features,
        timeline,
      },
      relatedArticles: [],
      tasks,
      notes,
      attachments,
    },
    evidence,
    timeline,
    tasks,
    notes,
    features,
  };
}

function expectedRegular(caseFile, fixture) {
  const names =
    fixture.attachments === 25
      ? caseFile.maxAttachments.names
      : fixture.attachments === 1
        ? [fixture.name]
        : [];
  return [...caseFile.fixedMembers, ...names.map((name) => `vedlegg/${name}`)];
}

function attachmentNames(caseFile, fixture) {
  if (fixture.attachments === 25) return caseFile.maxAttachments.names;
  if (fixture.attachments === 1) return [fixture.name];
  return [];
}

function expectedManifest(caseFile, fixture, attachmentSha) {
  return {
    situationId: "export72",
    attachmentChecksums: attachmentNames(caseFile, fixture).map((name) => ({
      filename: safeFilename(name),
      sha256: attachmentSha,
      size: fixture.payloadBytes,
    })),
    privateAnalysisWarning: caseFile.privateWarning,
  };
}

function pdfHex(text) {
  let hex = "";
  for (const character of text) {
    const code = character.codePointAt(0);
    hex += (code < 16 ? "0" : "") + code.toString(16);
  }
  return hex;
}

function textFromContent(content) {
  const source = content.toString("latin1");
  let decoded = "";
  for (const match of source.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const digits = match[1].replace(/\s+/g, "");
    if (digits.length < 2 || digits.length % 2 !== 0) continue;
    decoded += Buffer.from(digits, "hex").toString("latin1");
  }
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "(") continue;
    let cursor = index + 1;
    let literal = "";
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "\\") {
        const next = source[cursor + 1] ?? "";
        if (next >= "0" && next <= "7") {
          let octal = next;
          let end = cursor + 2;
          while (end < cursor + 4 && source[end] >= "0" && source[end] <= "7") {
            octal += source[end];
            end += 1;
          }
          literal += String.fromCharCode(Number.parseInt(octal, 8));
          cursor = end;
          continue;
        }
        literal +=
          { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", "(": "(", ")": ")", "\\": "\\" }[next] ??
          next;
        cursor += 2;
        continue;
      }
      if (character === ")") {
        cursor += 1;
        break;
      }
      literal += character;
      cursor += 1;
    }
    const operator = source.slice(cursor).match(/^\s*(Tj|TJ)/);
    if (operator) decoded += literal;
    index = cursor - 1;
  }
  return decoded;
}

function pdfText(pdf) {
  if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) fail("oracle", "pdf header");
  if (!pdf.includes(Buffer.from("%%EOF"))) fail("oracle", "pdf truncated");
  let cursor = 0;
  let decoded = "";
  let textStreams = 0;
  while (cursor < pdf.length) {
    const newline = pdf.indexOf("\nstream\n", cursor);
    const carriage = pdf.indexOf("\nstream\r\n", cursor);
    let marker = -1;
    let start = -1;
    if (newline >= 0 && (carriage < 0 || newline <= carriage)) {
      marker = newline;
      start = newline + 8;
    } else if (carriage >= 0) {
      marker = carriage;
      start = carriage + 9;
    } else {
      break;
    }
    const dictionary = pdf.subarray(Math.max(0, marker - 500), marker + 1).toString("latin1");
    const lengthMatch = /\/Length\s+(\d+)/.exec(dictionary);
    if (!lengthMatch) fail("oracle", "pdf truncated");
    const length = Number(lengthMatch[1]);
    if (start + length > pdf.length) fail("oracle", "pdf truncated");
    if (dictionary.includes("/FlateDecode")) {
      let inflated;
      try {
        inflated = inflateSync(pdf.subarray(start, start + length));
      } catch {
        fail("oracle", "pdf truncated");
      }
      if (inflated.includes(Buffer.from("TJ")) || inflated.includes(Buffer.from("Tj"))) {
        textStreams += 1;
        decoded += textFromContent(inflated);
      }
    }
    cursor = start + length;
  }
  if (textStreams === 0) fail("oracle", "pdf plaintext");
  return decoded;
}

function assertPdf(pdf, caseFile) {
  const decoded = pdfText(pdf);
  const required = [
    CLOCK_TITLE,
    `Sist oppdatert ${caseFile.clock}`,
    "[official] export72 fixture",
    "NRK: https://example.invalid/export72",
    caseFile.privateWarning,
    "Private arbeidsnotater",
    `- ${caseFile.privateWarning}`,
  ];
  for (const phrase of required) {
    if (!decoded.includes(phrase)) fail("oracle", `pdf text ${phrase}`);
  }
}

function assertStableMembers(left, right) {
  if (left.length !== right.length) fail("oracle", "unstable count");
  for (let index = 0; index < left.length; index += 1) {
    const first = left[index];
    const second = right[index];
    if (
      first.name !== second.name ||
      first.size !== second.size ||
      first.sha256 !== second.sha256
    ) {
      fail("oracle", `unstable ${first.name}`);
    }
  }
}

function freezeFixtureClock(caseFile) {
  const fixtureMs = Date.parse(caseFile.clock);
  if (!Number.isFinite(fixtureMs)) fail("malformed", "clock");
  const RealDate = Date;
  class FixtureDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixtureMs] : args));
    }

    static now() {
      return fixtureMs;
    }
  }
  globalThis.Date = FixtureDate;
  return () => {
    globalThis.Date = RealDate;
  };
}

function assertMembers(entries, caseFile, fixture, attachmentSha) {
  const regular = [];
  for (const entry of entries) {
    if (entry.name.endsWith("/")) {
      if (!["privat/", "kartlag/", "vedlegg/"].includes(entry.name))
        fail("oracle", `unexpected ${entry.name}`);
    } else {
      regular.push(entry);
    }
  }
  const wanted = expectedRegular(caseFile, fixture);
  if (regular.length !== wanted.length) fail("oracle", `count ${regular.length}`);
  for (let index = 0; index < wanted.length; index += 1) {
    if (regular[index].name !== wanted[index]) fail("oracle", `order ${regular[index].name}`);
  }
  const byName = new Map(regular.map((entry) => [entry.name, entry.data]));
  const built = model(caseFile, []);
  const pretty = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}`);
  const checks = [
    ["utvikling.json", pretty(built.timeline)],
    ["kilder-og-evidens.json", pretty(built.evidence)],
    ["privat/arbeidsnotater.json", pretty({ tasks: built.tasks, notes: built.notes })],
    ["README.txt", Buffer.from(`${caseFile.privateWarning}\n`)],
  ];
  for (const [name, bytes] of checks) {
    if (!byName.get(name).equals(bytes)) fail("oracle", `content ${name}`);
  }
  const pdf = byName.get("situasjonsbrief.pdf");
  assertPdf(pdf, caseFile);
  for (const provenance of PROVENANCE) {
    const expected = Buffer.from(
      JSON.stringify(
        {
          type: "FeatureCollection",
          features: built.features.filter(
            (feature) => feature.properties.provenance === provenance,
          ),
        },
        null,
        2,
      ),
    );
    if (!byName.get(`kartlag/${provenance}.geojson`).equals(expected))
      fail("oracle", `geojson ${provenance}`);
  }
  const manifest = JSON.parse(byName.get("manifest.json").toString("utf8"));
  const expectedManifestBytes = Buffer.from(
    `${JSON.stringify(expectedManifest(caseFile, fixture, attachmentSha), null, 2)}`,
  );
  if (!byName.get("manifest.json").equals(expectedManifestBytes)) fail("oracle", "manifest");
  if (
    manifest.situationId !== "export72" ||
    manifest.privateAnalysisWarning !== caseFile.privateWarning
  ) {
    fail("oracle", "manifest");
  }
  for (const name of wanted.filter((item) => item.startsWith("vedlegg/"))) {
    const data = byName.get(name);
    if (data.length !== fixture.payloadBytes || sha256(data) !== attachmentSha)
      fail("oracle", `attachment ${name}`);
  }
  return regular.map((entry) => ({
    name: entry.name,
    size: entry.data.length,
    sha256: sha256(entry.data),
  }));
}

function expectError(fn, text) {
  try {
    fn();
  } catch (error) {
    if (!String(error.message).includes(text))
      fail("self-check", `wrong error ${error.message} for ${text}`);
    return;
  }
  fail("self-check", `accepted bad input ${text}`);
}

function witnessDirectory(root, capacity) {
  const files = readdirSync(root)
    .sort()
    .map((name) => {
      const info = statSync(root + "/" + name);
      const type = info.isFile() ? "file" : info.isDirectory() ? "dir" : "other";
      return { name, type, size: info.size };
    });
  const total = files.reduce((sum, file) => sum + (file.type === "file" ? file.size : 0), 0);
  const persistedZip = files.some(
    (file) => file.type === "file" && file.name.toLowerCase().endsWith(".zip"),
  );
  return { files, total, capacity, persistedZip };
}

function assertWitness(witness, allowed) {
  const derived = witness.files.some(
    (file) => file.type === "file" && file.name.toLowerCase().endsWith(".zip"),
  );
  if (witness.persistedZip !== derived) fail("identity", "persisted zip");
  const total = witness.files.reduce(
    (sum, file) => sum + (file.type === "file" ? file.size : 0),
    0,
  );
  if (witness.total !== total) fail("identity", "witness total");
  if (total > witness.capacity) fail("oracle", "persisted capacity");
  for (const file of witness.files) {
    if (!allowed.has(file.name) || file.type !== "file" || file.size > witness.capacity)
      fail("oracle", "persisted " + file.name);
  }
  if (witness.persistedZip) fail("oracle", "persisted zip");
}

function identityRecord(parts) {
  return {
    node: process.version,
    arch: process.arch,
    platform: process.platform,
    packageName: parts.pkg,
    probe: parts.hashes.probe,
    case: parts.hashes.case,
    exportSha256: parts.exportSha,
    storeSha256: parts.storeSha,
  };
}

function assertIdentity(identity) {
  for (const key of [
    "node",
    "arch",
    "platform",
    "packageName",
    "probe",
    "case",
    "exportSha256",
    "storeSha256",
  ]) {
    if (typeof identity[key] !== "string" || identity[key].length === 0) fail("identity", key);
  }
  if (
    identity.node !== process.version ||
    identity.arch !== process.arch ||
    identity.platform !== process.platform
  ) {
    fail("identity", "false identity");
  }
}

function fixturePdf(text) {
  const content = Buffer.from(`BT [<${pdfHex(text)}> 0] TJ ET\n`, "latin1");
  const compressed = deflateSync(content);
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n"),
    Buffer.from(`1 0 obj\n<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),
    compressed,
    Buffer.from("\nendstream\nendobj\n%%EOF\n"),
  ]);
}

function pdfPhrases(caseFile) {
  return [
    CLOCK_TITLE,
    `Sist oppdatert ${caseFile.clock}`,
    "[official] export72 fixture",
    "NRK: https://example.invalid/export72",
    caseFile.privateWarning,
    "Private arbeidsnotater",
    "- " + caseFile.privateWarning,
  ].join("\n");
}

function oracleEntries(caseFile, fixture, raw, pdfBody = pdfPhrases(caseFile)) {
  const payload =
    fixture.payloadBytes === 0 ? Buffer.alloc(0) : raw.subarray(0, fixture.payloadBytes);
  const digest = sha256(payload);
  const built = model(caseFile, []);
  const entries = caseFile.fixedMembers.map((name) => {
    if (name === "situasjonsbrief.pdf") return { name, data: fixturePdf(pdfBody) };
    if (name === "README.txt") return { name, data: Buffer.from(`${caseFile.privateWarning}\n`) };
    if (name.endsWith(".geojson")) {
      const provenance = name.split("/")[1].replace(".geojson", "");
      const body = {
        type: "FeatureCollection",
        features: built.features.filter((feature) => feature.properties.provenance === provenance),
      };
      return { name, data: Buffer.from(JSON.stringify(body, null, 2)) };
    }
    if (name === "manifest.json") {
      return {
        name,
        data: Buffer.from(JSON.stringify(expectedManifest(caseFile, fixture, digest), null, 2)),
      };
    }
    const value =
      name === "utvikling.json"
        ? built.timeline
        : name === "kilder-og-evidens.json"
          ? built.evidence
          : { tasks: built.tasks, notes: built.notes };
    return { name, data: Buffer.from(JSON.stringify(value, null, 2)) };
  });
  for (const name of attachmentNames(caseFile, fixture)) {
    entries.push({ name: `vedlegg/${safeFilename(name)}`, data: Buffer.from(payload) });
  }
  return { entries, digest };
}

async function selfCheck() {
  const validBaseline = {
    productionSha256: "a",
    baselineSha256: "a",
    byteIdentical: true,
    sourceSha256: "963a91bf22ff3bb5f967301fbbf38f2de55ce9301547db386f1176e9e8f70930",
  };
  assertBaselineIdentity(validBaseline, "a", "a");
  expectError(
    () => assertBaselineIdentity(validBaseline, "a", "tampered"),
    "compiled before snapshot",
  );
  expectError(
    () => assertBaselineIdentity({ ...validBaseline, sourceSha256: "wrong" }, "a", "a"),
    "compiled before snapshot",
  );
  expectError(
    () => assertBaselineIdentity({ ...validBaseline, byteIdentical: false }, "a", "a"),
    "compiled before snapshot",
  );
  const casePath = fileURLToPath(new URL("./export72-case.json", import.meta.url));
  const caseFile = JSON.parse(readFileSync(casePath, "utf8"));
  const raw = backingBytes();
  assertCase(caseFile, raw);
  const badDigest = globalThis.structuredClone(caseFile);
  badDigest.backing.sha256 = "0".repeat(64);
  expectError(() => assertCase(badDigest, raw), "backing digest");
  const badNames = globalThis.structuredClone(caseFile);
  badNames.maxAttachments.names = [
    "same.bin",
    "dir/same.bin",
    ...caseFile.maxAttachments.names.slice(2),
  ];
  expectError(() => assertCase(badNames, raw), "unique names");
  const badLogical = globalThis.structuredClone(caseFile);
  badLogical.maxAttachments.logicalBytes = 1;
  expectError(() => assertCase(badLogical, raw), "logical size");
  const badScratch = globalThis.structuredClone(caseFile);
  badScratch.limits.denyScratchBytes = 100;
  expectError(() => assertCase(badScratch, raw), "deny size");
  const badSchema = globalThis.structuredClone(caseFile);
  badSchema.schema = "nope";
  expectError(() => assertCase(badSchema, raw), "schema");
  const hello = Buffer.from("hello");
  const zip = storedZip("README.txt", hello, 8);
  const parsed = readZip(zip);
  if (parsed.length !== 1 || !parsed[0].data.equals(hello)) fail("self-check", "deflate zip");
  const broken = Buffer.from(zip);
  const eocdOffset = broken.length - 22;
  if (broken.readUInt32LE(eocdOffset) !== 0x06054b50) fail("self-check", "fixture eocd");
  const centralOffset = broken.readUInt32LE(eocdOffset + 16);
  broken.writeUInt32LE(
    (broken.readUInt32LE(centralOffset + 16) ^ 0xffffffff) >>> 0,
    centralOffset + 16,
  );
  expectError(() => readZip(broken), "checksum");
  const empty = { attachments: 0, payloadBytes: 0 };
  const built = oracleEntries(caseFile, empty, raw);
  const entries = built.entries;
  const pdf = entries.find((entry) => entry.name === "situasjonsbrief.pdf").data;
  if (pdf.includes(Buffer.from(CLOCK_TITLE))) fail("self-check", "fixture pdf leaked plaintext");
  const literalReadme = Buffer.from(caseFile.privateWarning + "\n");
  const readme = entries.find((entry) => entry.name === "README.txt").data;
  if (!readme.equals(literalReadme)) fail("self-check", "readme literal");
  const literalOfficial = Buffer.from(
    JSON.stringify(
      {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "f-official",
            geometry: { type: "Point", coordinates: [10, 63.43] },
            properties: { label: "official", provenance: "official", updatedAt: caseFile.clock },
          },
        ],
      },
      null,
      2,
    ),
  );
  const official = entries.find((entry) => entry.name === "kartlag/official.geojson").data;
  if (!official.equals(literalOfficial)) fail("self-check", "geojson literal");
  const literalManifest = Buffer.from(
    JSON.stringify(
      {
        situationId: "export72",
        attachmentChecksums: [],
        privateAnalysisWarning: caseFile.privateWarning,
      },
      null,
      2,
    ),
  );
  const manifestBytes = entries.find((entry) => entry.name === "manifest.json").data;
  if (!manifestBytes.equals(literalManifest)) fail("self-check", "manifest literal");
  const members = assertMembers(entries, caseFile, empty, built.digest);
  expectError(
    () => assertMembers(entries.slice(1), caseFile, empty, sha256(Buffer.alloc(0))),
    "count",
  );
  const extra = [...entries, { name: "vedlegg/extra.bin", data: Buffer.from("x") }];
  expectError(() => assertMembers(extra, caseFile, empty, sha256(Buffer.alloc(0))), "count");
  const plain = entries.map((entry) =>
    entry.name === "situasjonsbrief.pdf"
      ? {
          name: entry.name,
          data: Buffer.from(`%PDF-1.4\n${CLOCK_TITLE} ${caseFile.clock}\n%%EOF\n`),
        }
      : entry,
  );
  expectError(() => assertMembers(plain, caseFile, empty, built.digest), "pdf");
  const truncated = entries.map((entry) =>
    entry.name === "situasjonsbrief.pdf"
      ? { name: entry.name, data: entry.data.subarray(0, entry.data.length - 12) }
      : entry,
  );
  expectError(() => assertMembers(truncated, caseFile, empty, built.digest), "pdf");
  const alteredPdf = oracleEntries(
    caseFile,
    empty,
    raw,
    pdfPhrases(caseFile).replace(CLOCK_TITLE, "EXPORT72 ALTERED"),
  ).entries;
  expectError(() => assertMembers(alteredPdf, caseFile, empty, built.digest), "pdf text");
  const moved = entries.map((entry) =>
    entry.name === "kartlag/official.geojson"
      ? {
          name: entry.name,
          data: Buffer.from(entry.data.toString("utf8").replace("63.43", "0.01")),
        }
      : entry,
  );
  expectError(() => assertMembers(moved, caseFile, empty, built.digest), "geojson");
  const relabeled = entries.map((entry) =>
    entry.name === "kartlag/official.geojson"
      ? {
          name: entry.name,
          data: Buffer.from(
            entry.data.toString("utf8").replace('"label": "official"', '"label": "changed"'),
          ),
        }
      : entry,
  );
  expectError(() => assertMembers(relabeled, caseFile, empty, built.digest), "geojson");
  const small = caseFile.fixtures[1];
  const smallBuilt = oracleEntries(caseFile, small, raw);
  assertMembers(smallBuilt.entries, caseFile, small, smallBuilt.digest);
  const renamed = smallBuilt.entries.map((entry) => {
    if (entry.name !== "manifest.json") return entry;
    const manifest = JSON.parse(entry.data.toString("utf8"));
    manifest.attachmentChecksums[0].filename = "not-the-file.bin";
    return { name: entry.name, data: Buffer.from(JSON.stringify(manifest, null, 2)) };
  });
  expectError(() => assertMembers(renamed, caseFile, small, smallBuilt.digest), "manifest");
  const swapped = entries.map((entry) => ({ name: entry.name, data: entry.data }));
  const movedEntry = swapped[0];
  swapped[0] = swapped[1];
  swapped[1] = movedEntry;
  expectError(() => assertMembers(swapped, caseFile, empty, built.digest), "order");
  const attachmentName = "vedlegg/" + small.name;
  const flipped = smallBuilt.entries.map((entry) => {
    if (entry.name !== attachmentName) return entry;
    const data = Buffer.from(entry.data);
    data[0] ^= 255;
    return { name: entry.name, data };
  });
  expectError(() => assertMembers(flipped, caseFile, small, smallBuilt.digest), "attachment");
  const wrongSha = "0".repeat(64);
  const shaMutated = smallBuilt.entries.map((entry) => {
    if (entry.name !== "manifest.json") return entry;
    const manifest = JSON.parse(entry.data.toString("utf8"));
    manifest.attachmentChecksums[0].sha256 = wrongSha;
    return { name: entry.name, data: Buffer.from(JSON.stringify(manifest, null, 2)) };
  });
  expectError(() => assertMembers(shaMutated, caseFile, small, wrongSha), "attachment");
  const shortened = smallBuilt.entries.map((entry) =>
    entry.name === attachmentName
      ? { name: entry.name, data: entry.data.subarray(0, entry.data.length - 1) }
      : entry,
  );
  expectError(() => assertMembers(shortened, caseFile, small, smallBuilt.digest), "attachment");
  const literalSha = "d1e7d52d9a8922ed805601a8f3b8f40fed0e0e535b288b6d968c928c57eaae79";
  const literalMember = { name: "vedlegg/e72-small.bin", size: 13, sha256: literalSha };
  if (sha256(Buffer.from("export72-byte")) !== literalSha) fail("self-check", "literal sha");
  assertStableMembers(
    [literalMember],
    [{ name: "vedlegg/e72-small.bin", size: 13, sha256: literalSha }],
  );
  expectError(
    () =>
      assertStableMembers(
        [literalMember],
        [{ name: literalMember.name, size: 13, sha256: "0".repeat(64) }],
      ),
    "unstable",
  );
  expectError(
    () =>
      assertStableMembers(
        [literalMember],
        [{ name: literalMember.name, size: 12, sha256: literalSha }],
      ),
    "unstable",
  );
  const witnessRoot = mkdtempSync(tmpdir() + "/export72-witness-");
  try {
    writeFileSync(witnessRoot + "/export72-ok", "ok");
    const clean = witnessDirectory(witnessRoot, 16777216);
    assertWitness(clean, new Set(["export72-ok"]));
    if (clean.persistedZip !== false || clean.total !== 2) fail("self-check", "witness");
    writeFileSync(witnessRoot + "/out.zip", "PK");
    expectError(
      () =>
        assertWitness(witnessDirectory(witnessRoot, 16777216), new Set(["export72-ok", "out.zip"])),
      "persisted zip",
    );
    unlinkSync(witnessRoot + "/out.zip");
    writeFileSync(witnessRoot + "/stray.bin", "x");
    expectError(
      () => assertWitness(witnessDirectory(witnessRoot, 16777216), new Set(["export72-ok"])),
      "persisted stray.bin",
    );
    if (releaseCanary(witnessRoot + "/export72-absent")) fail("self-check", "missing canary");
    const canaryPath = witnessRoot + "/export72-canary";
    writeFileSync(canaryPath, "x");
    if (releaseCanary(canaryPath) || statSync(canaryPath, { throwIfNoEntry: false })) {
      fail("self-check", "canary teardown");
    }
    let paired = false;
    try {
      raiseCanary(
        Object.assign(new Error("write-visible"), { code: "EIO" }),
        Object.assign(new Error("cleanup-visible"), { code: "EPERM" }),
      );
    } catch (error) {
      paired =
        error.message === "write-visible" &&
        error.cause &&
        error.cause.message === "cleanup-visible";
    }
    if (!paired) fail("self-check", "canary errors hidden");
    let cleanupOnly = false;
    try {
      raiseCanary(null, Object.assign(new Error("cleanup-only"), { code: "EPERM" }));
    } catch (error) {
      cleanupOnly = error.message === "cleanup-only";
    }
    if (!cleanupOnly) fail("self-check", "cleanup error hidden");
  } finally {
    rmSync(witnessRoot, { recursive: true, force: false });
    if (statSync(witnessRoot, { throwIfNoEntry: false })) fail("self-check", "witness cleanup");
  }
  const recorded = identityRecord({
    pkg: "@nytt/server",
    hashes: { probe: "a".repeat(64), case: "b".repeat(64) },
    exportSha: "c".repeat(64),
    storeSha: "d".repeat(64),
  });
  assertIdentity(recorded);
  expectError(() => assertIdentity({ ...recorded, arch: "not-the-arch" }), "false identity");
  const dropped = { ...recorded };
  delete dropped.platform;
  expectError(() => assertIdentity(dropped), "platform");
  const restoreClock = freezeFixtureClock(caseFile);
  try {
    if (Date.now() !== Date.parse(caseFile.clock) || new Date().toISOString() !== caseFile.clock) {
      fail("self-check", "fixture clock");
    }
    const imported = await import("data:text/javascript,export default Date.now()");
    if (imported.default !== Date.parse(caseFile.clock)) fail("self-check", "clock before import");
  } finally {
    restoreClock();
  }
  if (members[0].name !== "situasjonsbrief.pdf" || members[0].size !== pdf.length)
    fail("self-check", "pdf witness");
  const order = [{ name: "a" }, { name: "b" }];
  persistedOrder(order, ["a", "b"]);
  expectError(() => persistedOrder(order, ["b", "a"]), "persisted member order");
  expectError(() => persistedOrder(order, ["a"]), "persisted member order");
  const idle = { Timeout: 0, TCPServerWrap: 0, TCPSocketWrap: 0 };
  assertLifecycle(idle, ownedResources());
  expectError(() => assertLifecycle(idle, { ...idle, Timeout: 1 }), "lifecycle leaked Timeout");
  expectError(() => assertLifecycle(idle, { ...idle, TCPServerWrap: 1 }), "lifecycle leaked TCP");
  expectError(() => assertLifecycle(idle, { Timeout: 0 }), "lifecycle receipt");
  const handle = setInterval(() => {}, 60000);
  try {
    expectError(() => assertLifecycle(idle, ownedResources()), "lifecycle leaked Timeout");
  } finally {
    clearInterval(handle);
  }
  const seenOnce = { requestsObserved: 1, responseFinished: false, responseClosedEarly: true };
  assertDisconnect({ ...seenOnce, persisted: 1, partials: 0 });
  expectError(() => assertDisconnect({ ...seenOnce, requestsObserved: 0 }), "request not observed");
  expectError(
    () => assertDisconnect({ ...seenOnce, responseClosedEarly: false }),
    "before response finish",
  );
  expectError(
    () => assertDisconnect({ ...seenOnce, responseFinished: true }),
    "before response finish",
  );
  expectError(() => assertDisconnect({ ...seenOnce, persisted: 0 }), "disconnect disposition");
  expectError(() => assertDisconnect({ ...seenOnce, partials: 1 }), "disconnect disposition");
  const note = [{ text: PRIVATE_NOTE }];
  const zipMembers = (overrides = {}) =>
    new Map(
      Object.entries({
        "privat/arbeidsnotater.json": Buffer.from(PRIVATE_NOTE),
        "utvikling.json": Buffer.from("[]"),
        "kartlag/official.geojson": Buffer.from("{}"),
        ...overrides,
      }),
    );
  assertPrivacy(zipMembers(), note, "Private arbeidsnotater - " + PRIVATE_NOTE);
  expectError(() => assertPrivacy(zipMembers(), [], "x"), "not authored");
  expectError(() => assertPrivacy(zipMembers(), note, "no note here"), "missing from private pdf");
  expectError(
    () =>
      assertPrivacy(
        zipMembers({ "privat/arbeidsnotater.json": Buffer.from("[]") }),
        note,
        PRIVATE_NOTE,
      ),
    "missing from privat json",
  );
  expectError(
    () =>
      assertPrivacy(
        zipMembers({ "kartlag/official.geojson": Buffer.from(PRIVATE_NOTE) }),
        note,
        PRIVATE_NOTE,
      ),
    "leaked into kartlag/official.geojson",
  );
  process.stdout.write("probe self-check passed\n");
}

function readLine() {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    const onData = (chunk) => {
      buffer += chunk;
      const index = buffer.indexOf("\n");
      if (index >= 0) {
        process.stdin.off("data", onData);
        process.stdin.pause();
        resolve(buffer.slice(0, index));
      }
    };
    process.stdin.on("data", onData);
    process.stdin.on("end", () => reject(new Error("stdin closed before release")));
  });
}

function expectDenied(path) {
  try {
    writeFileSync(path, "x");
  } catch (error) {
    if (["EROFS", "EACCES", "EPERM"].includes(error.code)) return;
    throw error;
  }
  fail("kernel", `write allowed at ${path}`);
}

async function attempt(host, port) {
  const tcp = await new Promise((resolve) => {
    const socket = connect({ host, port: port.tcp, timeout: 500 });
    const done = (result) => {
      socket.destroy();
      resolve(result);
    };
    socket.once("connect", () => done("connected"));
    socket.once("timeout", () => done("timeout"));
    socket.once("error", () => done("error"));
  });
  if (tcp === "connected") fail("kernel", "tcp canary reachable from namespace");
  const udp = await new Promise((resolve) => {
    const socket = createSocket("udp4");
    socket.once("error", () => {
      socket.close();
      resolve("error");
    });
    socket.send(Buffer.from("export72"), port.udp, host, () => {
      socket.close();
      resolve("sent");
    });
  });
  const query = Buffer.concat([
    Buffer.from([0x72, 0x72, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 7]),
    Buffer.from("export72"),
    Buffer.from([4]),
    Buffer.from("test"),
    Buffer.from([0, 0x00, 0x01, 0x00, 0x01]),
  ]);
  const dns = await new Promise((resolve) => {
    const socket = createSocket("udp4");
    socket.once("error", () => {
      socket.close();
      resolve("error");
    });
    socket.send(query, port.dns, host, () => {
      socket.close();
      resolve("sent");
    });
  });
  return { tcp, udp, dns };
}

function releaseCanary(path) {
  try {
    unlinkSync(path);
    return null;
  } catch (error) {
    return error && error.code === "ENOENT" ? null : error;
  }
}

function raiseCanary(writeError, cleanupError) {
  if (writeError && cleanupError) writeError.cause = cleanupError;
  if (writeError) throw writeError;
  if (cleanupError) throw cleanupError;
}

function kernelControls(caseFile, release, hashes) {
  expectDenied("/app/export72-deny");
  expectDenied("/perf/export72-deny");
  const again = {
    probe: sha256(readFileSync(fileURLToPath(import.meta.url))),
    case: sha256(readFileSync(process.argv[4])),
  };
  if (again.probe !== hashes.probe || again.case !== hashes.case)
    fail("kernel", "source hash changed");
  writeFileSync("/tmp/export72-ok", "ok");
  let denied = false;
  let writeError = null;
  try {
    writeFileSync("/tmp/export72-big", Buffer.alloc(caseFile.limits.denyScratchBytes));
  } catch (error) {
    if (!["ENOSPC", "EIO", "EDQUOT", "EFBIG"].includes(error.code)) writeError = error;
    else denied = true;
  }
  raiseCanary(writeError, releaseCanary("/tmp/export72-big"));
  if (!denied) fail("kernel", "17MiB tmp write was allowed");
  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    if (name !== "lo" && addresses?.some((item) => !item.internal))
      fail("kernel", `non-loopback ${name}`);
  }
  const route = readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
  for (const line of route) {
    if (line.trim().split(/\s+/)[1] === "00000000") fail("kernel", "default route");
  }
  return attempt(release.host, release.ports);
}

async function runFixture(modules, caseFile, fixture, raw) {
  const payload =
    fixture.payloadBytes === 0 ? Buffer.alloc(0) : raw.subarray(0, fixture.payloadBytes);
  const names =
    fixture.attachments === 25
      ? caseFile.maxAttachments.names
      : fixture.attachments === 1
        ? [fixture.name]
        : [];
  const store = new modules.store.MemoryStore();
  const digest = sha256(payload);
  const storagePath = `/tmp/export72-${fixture.id}.bin`;
  if (fixture.payloadBytes > 0) {
    writeFileSync(storagePath, payload);
    const when = Date.parse(caseFile.clock) / 1000;
    utimesSync(storagePath, when, when);
  }
  const attachments = [];
  for (let index = 0; index < names.length; index += 1) {
    const record = {
      id: `export72-${fixture.id}-${index}`,
      situationId: "export72",
      filename: names[index],
      contentType: "application/octet-stream",
      size: payload.length,
      sha256: digest,
      createdAt: caseFile.clock,
      storagePath,
    };
    const added = await store.addAttachment(record);
    const stored = await store.getAttachment(record.id);
    if (
      added.filename !== record.filename ||
      stored?.sha256 !== digest ||
      stored.storagePath !== storagePath
    ) {
      fail("identity", "MemoryStore attachment roundtrip");
    }
    attachments.push({
      id: record.id,
      situationId: record.situationId,
      filename: record.filename,
      contentType: record.contentType,
      size: record.size,
      sha256: record.sha256,
      createdAt: record.createdAt,
    });
  }
  const built = model(caseFile, attachments);
  const zip = await modules.export.buildWorkspaceExport(store, built.workspace);
  if (!Buffer.isBuffer(zip) || zip.length > caseFile.limits.memoryBytes)
    fail("oracle", "zip buffer");
  const members = assertMembers(readZip(zip), caseFile, fixture, digest);
  return { id: fixture.id, regular: members.length, members, zipBytes: zip.length };
}

// ---- Persisted profile (owner-approved 2026-10-30): real createApp POST/GET exports. ----
const OUTPUT_MOUNT = "/export-output";
const OUTPUT_CAP = 67108864;
const SITUATION = "skogbrann-bymarka";
const LOGIN = "Reedtrullz";
// Authored private note: must appear only in the private PDF and privat/ JSON.
const PRIVATE_NOTE = "Privat notat export72 kanarifugl 4d1c9e";
const DISCONNECT_DEADLINE_MS = 20000;

function persistedOrder(entries, expected) {
  const regular = entries.filter((entry) => !entry.name.endsWith("/")).map((entry) => entry.name);
  if (regular.length !== expected.length || regular.some((name, index) => name !== expected[index]))
    fail("oracle", "persisted member order");
}

function assertPrivacy(byName, notes, pdfDecoded) {
  if (notes.length === 0 || notes.some((note) => !note.text))
    fail("oracle", "private note not authored");
  for (const note of notes) {
    if (!pdfDecoded.includes(note.text)) fail("oracle", "private note missing from private pdf");
    if (!byName.get("privat/arbeidsnotater.json")?.includes(note.text))
      fail("oracle", "private note missing from privat json");
    for (const [name, data] of byName) {
      if (name === "situasjonsbrief.pdf" || name === "privat/arbeidsnotater.json") continue;
      if (data.includes(note.text)) fail("oracle", "private note leaked into " + name);
    }
  }
}

const OWNED_RESOURCES = ["Timeout", "TCPServerWrap", "TCPSocketWrap"];

function ownedResources() {
  const counts = Object.fromEntries(OWNED_RESOURCES.map((name) => [name, 0]));
  for (const name of process.getActiveResourcesInfo()) if (name in counts) counts[name] += 1;
  return counts;
}

// Natural termination needs every server, socket and timer the profile opened to be gone.
function assertLifecycle(before, after) {
  for (const name of OWNED_RESOURCES) {
    if (!Number.isInteger(before?.[name]) || !Number.isInteger(after?.[name]))
      fail("oracle", "lifecycle receipt " + name);
    if (after[name] > before[name]) fail("oracle", "lifecycle leaked " + name);
  }
}

// A disconnect is only meaningful if the server saw the request and the client left before
// the response finished; the app has no cancel path, so the export must complete whole.
function assertDisconnect(facts) {
  if (facts.requestsObserved !== 1) fail("oracle", "disconnect request not observed");
  if (facts.responseFinished !== false || facts.responseClosedEarly !== true)
    fail("oracle", "disconnect not observed before response finish");
  if (facts.persisted !== 1 || facts.partials !== 0)
    fail("oracle", "disconnect disposition " + facts.persisted + "/" + facts.partials);
}

function call(port, method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: "127.0.0.1", port, method, path, headers, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

function jar() {
  const cookies = new Map();
  return {
    take(response) {
      for (const line of response.headers["set-cookie"] ?? []) {
        const [pair] = line.split(";");
        const index = pair.indexOf("=");
        cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
    },
    header: () => [...cookies].map(([name, value]) => name + "=" + value).join("; "),
  };
}

async function csrfFor(port, cookies) {
  const response = await call(port, "GET", "/api/session", {
    headers: { cookie: cookies.header() },
  });
  cookies.take(response);
  if (response.status !== 200) return { status: response.status, csrf: undefined };
  return { status: 200, csrf: JSON.parse(response.body.toString("utf8")).csrfToken };
}

async function startApp(appModule, dir, devAuthBypass, extra = {}) {
  const runtime = await appModule.createApp({
    port: 0,
    nodeEnv: "development",
    publicOrigin: "http://localhost",
    seedDemo: true,
    devAuthBypass,
    githubAllowedLogin: LOGIN,
    sessionSecret: "export72-persisted-fixture-secret",
    uploadDir: dir,
    runtimeStatusDir: dir,
    rateLimitEnabled: false,
    ...extra,
  });
  const server = await new Promise((resolve) => {
    const listening = runtime.app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  return { runtime, server, port: server.address().port };
}

async function stopApp(started) {
  const closed = new Promise((resolve) => started.server.close(() => resolve()));
  started.server.closeAllConnections();
  await closed;
  await started.runtime.pool?.end();
}

function dirBytes(dir) {
  return readdirSync(dir).reduce((sum, name) => sum + statSync(join(dir, name)).size, 0);
}

function assertPersistedMembers(entries, caseFile, workspace, names, digest, size, exportId) {
  const expected = [...caseFile.fixedMembers, ...names.map((name) => "vedlegg/" + name)];
  for (const entry of entries) {
    if (entry.name.endsWith("/") && !["privat/", "kartlag/", "vedlegg/"].includes(entry.name))
      fail("oracle", "unexpected " + entry.name);
  }
  persistedOrder(entries, expected);
  const byName = new Map(entries.filter((e) => !e.name.endsWith("/")).map((e) => [e.name, e.data]));
  const pretty = (value) => Buffer.from(JSON.stringify(value, null, 2));
  const { situation } = workspace;
  for (const [name, bytes] of [
    ["utvikling.json", pretty(situation.timeline)],
    ["kilder-og-evidens.json", pretty(situation.evidence)],
    ["privat/arbeidsnotater.json", pretty({ tasks: workspace.tasks, notes: workspace.notes })],
    ["README.txt", Buffer.from(caseFile.privateWarning + "\n")],
  ]) {
    if (!byName.get(name).equals(bytes)) fail("oracle", "content " + name);
  }
  for (const provenance of PROVENANCE) {
    const features = situation.features.filter((f) => f.properties.provenance === provenance);
    const expectedGeo = pretty({ type: "FeatureCollection", features });
    if (!byName.get("kartlag/" + provenance + ".geojson").equals(expectedGeo))
      fail("oracle", "geojson " + provenance);
  }
  const manifest = JSON.parse(byName.get("manifest.json").toString("utf8"));
  const checksums = names.map((filename) => ({ filename, sha256: digest, size }));
  if (
    manifest.exportId !== exportId ||
    manifest.situationId !== SITUATION ||
    manifest.privateAnalysisWarning !== caseFile.privateWarning ||
    JSON.stringify(manifest.attachmentChecksums) !== JSON.stringify(checksums)
  )
    fail("oracle", "manifest");
  const pdf = byName.get("situasjonsbrief.pdf");
  const text = pdfText(pdf);
  if (
    pdf.subarray(0, 5).toString("latin1") !== "%PDF-" ||
    !text.includes("NYTT TRONDHEIM / SITUASJONSROM") ||
    !text.includes("Sist oppdatert " + situation.updatedAt)
  )
    fail("oracle", "pdf");
  // Privacy: the private PDF and privat/ JSON carry the note; nothing else may.
  assertPrivacy(byName, workspace.notes, text);
  for (const name of expected.filter((item) => item.startsWith("vedlegg/"))) {
    const data = byName.get(name);
    if (data.length !== size || sha256(data) !== digest) fail("oracle", "attachment " + name);
  }
  const attached = expected.filter((item) => item.startsWith("vedlegg/"));
  return {
    members: entries.length,
    memberNames: entries.filter((e) => !e.name.endsWith("/")).map((e) => e.name),
    attachmentSizes: attached.map((name) => byName.get(name).length),
    attachmentCrc32: attached.map((name) => crc32(byName.get(name)) >>> 0),
  };
}

async function runPersistedFixture(appModule, caseFile, fixture, raw) {
  const dir = OUTPUT_MOUNT + "/" + fixture.id;
  const started = await startApp(appModule, dir, true);
  try {
    const { store } = started.runtime;
    const payload = raw.subarray(0, fixture.payloadBytes);
    const digest = sha256(payload);
    const names = attachmentNames(caseFile, fixture);
    const storagePath = "/tmp/export72-" + fixture.id + ".bin";
    if (payload.length > 0) writeFileSync(storagePath, payload);
    for (const [index, filename] of names.entries()) {
      await store.addAttachment({
        id: "export72-" + fixture.id + "-" + index,
        situationId: SITUATION,
        filename,
        contentType: "application/octet-stream",
        size: payload.length,
        sha256: digest,
        createdAt: caseFile.clock,
        storagePath,
      });
    }
    const workspace = await store.getWorkspace(SITUATION, LOGIN);
    if (workspace.attachments.length !== names.length) fail("oracle", "attachment setup");
    await store.addNote(SITUATION, PRIVATE_NOTE);
    workspace.notes = (await store.getWorkspace(SITUATION, LOGIN)).notes;
    if (!workspace.notes.some((note) => note.text === PRIVATE_NOTE)) fail("oracle", "note setup");
    const cookies = jar();
    const { csrf } = await csrfFor(started.port, cookies);
    const post = await call(started.port, "POST", "/api/situations/" + SITUATION + "/exports", {
      headers: { cookie: cookies.header(), "x-csrf-token": csrf },
    });
    if (post.status !== 200) fail("oracle", "POST " + post.status);
    const exportId = String(post.headers["x-export-id"]);
    const location = String(post.headers.location);
    if (location !== "/api/situations/" + SITUATION + "/exports/" + exportId)
      fail("oracle", "location");
    const files = readdirSync(dir);
    if (files.length !== 1 || files[0] !== "export-" + exportId + ".zip")
      fail("oracle", "persisted file set");
    if (statSync(join(dir, files[0])).size !== post.body.length) fail("oracle", "persisted size");
    if (!readFileSync(join(dir, files[0])).equals(post.body)) fail("oracle", "persisted bytes");
    const record = await store.getExport(exportId, SITUATION, LOGIN);
    if (record?.storagePath !== join(dir, files[0])) fail("oracle", "export record");
    const get = await call(started.port, "GET", location, {
      headers: { cookie: cookies.header() },
    });
    if (get.status !== 200 || !get.body.equals(post.body)) fail("oracle", "GET bytes");
    const zipBytes = post.body.length;
    const outputPeakBytes = dirBytes(dir);
    const checked = assertPersistedMembers(
      readZip(post.body),
      caseFile,
      workspace,
      names,
      digest,
      payload.length,
      exportId,
    );
    rmSync(dir, { recursive: true });
    return {
      id: fixture.id,
      status: post.status,
      getExact: true,
      zipBytes,
      outputPeakBytes,
      ...checked,
      cleaned: !statSync(dir, { throwIfNoEntry: false }),
    };
  } finally {
    await stopApp(started);
    rmSync(dir, { recursive: true, force: true });
  }
}

function fillOutput(path, limit) {
  const fd = openSync(path, "w");
  let code = null;
  try {
    for (let written = 0; written < limit; written += 1048576) writeSync(fd, Buffer.alloc(1048576));
  } catch (error) {
    code = error.code;
  } finally {
    closeSync(fd);
  }
  return { code, bytes: statSync(path).size };
}

async function persistedControls(appModule, caseFile, raw) {
  // Kernel cap: writes past 64MiB must stop with ENOSPC, with a counted partial file.
  const over = fillOutput(OUTPUT_MOUNT + "/overcap.bin", OUTPUT_CAP + 2 * 1048576);
  rmSync(OUTPUT_MOUNT + "/overcap.bin");
  if (over.code !== "ENOSPC" || over.bytes <= 0 || over.bytes > OUTPUT_CAP)
    fail("kernel", "output cap " + over.code + " " + over.bytes);
  // Denial controls with real session/CSRF/owner checks and devAuthBypass:false.
  const dir = OUTPUT_MOUNT + "/denied";
  const started = await startApp(appModule, dir, false, {
    githubClientId: "export72-fixture",
    githubClientSecret: "export72-fixture",
    emailSender: { async send() {} },
  });
  let anonymous;
  let viewer;
  try {
    const exportPath = "/api/situations/" + SITUATION + "/exports";
    const anon = jar();
    const { csrf } = await csrfFor(started.port, anon);
    anonymous = (
      await call(started.port, "POST", exportPath, {
        headers: { cookie: anon.header(), ...(csrf ? { "x-csrf-token": csrf } : {}) },
      })
    ).status;
    const grant = await started.runtime.store.grantUserAccess(
      { displayName: "Export72 Viewer", email: "export72-viewer@example.test" },
      "owner",
    );
    const token = grant.invite.token;
    const cookies = jar();
    const page = await call(
      started.port,
      "GET",
      "/auth/email/callback?token=" + encodeURIComponent(token),
    );
    cookies.take(page);
    const form = page.body.toString("utf8").match(/name="_csrf" value="([^"]+)"/)?.[1];
    if (!form) fail("oracle", "viewer login form");
    const body = "token=" + encodeURIComponent(token) + "&_csrf=" + encodeURIComponent(form);
    const login = await call(started.port, "POST", "/auth/email/callback", {
      headers: {
        cookie: cookies.header(),
        origin: "http://localhost",
        "content-type": "application/x-www-form-urlencoded",
        "content-length": Buffer.byteLength(body),
      },
      body,
    });
    cookies.take(login);
    if (login.status !== 302) fail("oracle", "viewer login " + login.status);
    const session = await csrfFor(started.port, cookies);
    viewer = (
      await call(started.port, "POST", exportPath, {
        headers: { cookie: cookies.header(), "x-csrf-token": session.csrf },
      })
    ).status;
    if (readdirSync(dir).length !== 0) fail("oracle", "denied request persisted a file");
  } finally {
    await stopApp(started);
    rmSync(dir, { recursive: true, force: true });
  }
  // Visible write error: a max export that cannot fit in the remaining output space.
  const filler = OUTPUT_MOUNT + "/filler.bin";
  fillOutput(filler, OUTPUT_CAP - 1048576);
  const maxFixture = caseFile.fixtures.find((item) => item.id === "max");
  const errDir = OUTPUT_MOUNT + "/writeerr";
  const errApp = await startApp(appModule, errDir, true);
  let writeErrorStatus;
  let writeErrorLeftovers;
  try {
    const storagePath = "/tmp/export72-max.bin";
    for (const [index, filename] of caseFile.maxAttachments.names.entries()) {
      await errApp.runtime.store.addAttachment({
        id: "export72-writeerr-" + index,
        situationId: SITUATION,
        filename,
        contentType: "application/octet-stream",
        size: maxFixture.payloadBytes,
        sha256: sha256(raw),
        createdAt: caseFile.clock,
        storagePath,
      });
    }
    const cookies = jar();
    const { csrf } = await csrfFor(errApp.port, cookies);
    const response = await call(errApp.port, "POST", "/api/situations/" + SITUATION + "/exports", {
      headers: { cookie: cookies.header(), "x-csrf-token": csrf },
    });
    writeErrorStatus = response.status;
    writeErrorLeftovers = readdirSync(errDir).length;
  } finally {
    await stopApp(errApp);
    rmSync(errDir, { recursive: true, force: true });
    rmSync(filler, { force: true });
  }
  // Real client disconnect on the authored max fixture: the client leaves once the server has
  // observed the request, before the response can finish. The app has no cancel path, so a
  // whole recorded export must appear; any partial or missing result fails.
  const dropDir = OUTPUT_MOUNT + "/disconnect";
  const dropApp = await startApp(appModule, dropDir, true);
  let disconnectPartials;
  let disconnectPersisted;
  const seen = { requestsObserved: 0, responseFinished: false, responseClosedEarly: false };
  try {
    for (const [index, filename] of caseFile.maxAttachments.names.entries()) {
      await dropApp.runtime.store.addAttachment({
        id: "export72-drop-" + index,
        situationId: SITUATION,
        filename,
        contentType: "application/octet-stream",
        size: maxFixture.payloadBytes,
        sha256: sha256(raw),
        createdAt: caseFile.clock,
        storagePath: "/tmp/export72-max.bin",
      });
    }
    const cookies = jar();
    const { csrf } = await csrfFor(dropApp.port, cookies);
    const exportPath = "/api/situations/" + SITUATION + "/exports";
    let requestSeen;
    const observed = new Promise((resolve) => (requestSeen = resolve));
    dropApp.server.on("request", (req, res) => {
      if (req.method !== "POST" || req.url !== exportPath) return;
      seen.requestsObserved += 1;
      res.on("finish", () => (seen.responseFinished = true));
      res.on("close", () => (seen.responseClosedEarly = !res.writableFinished));
      requestSeen();
    });
    const client = new Promise((resolve) => {
      const req = httpRequest({
        host: "127.0.0.1",
        port: dropApp.port,
        method: "POST",
        path: exportPath,
        headers: { cookie: cookies.header(), "x-csrf-token": csrf },
        agent: false,
      });
      req.on("error", () => resolve());
      req.end();
      observed.then(() => {
        req.destroy();
        resolve();
      });
    });
    await client;
    const deadline = performance.now() + DISCONNECT_DEADLINE_MS;
    for (;;) {
      disconnectPartials = 0;
      disconnectPersisted = 0;
      for (const name of readdirSync(dropDir)) {
        const id = name.replace(/^export-|\.zip$/g, "");
        const record = await dropApp.runtime.store.getExport(id, SITUATION, LOGIN);
        try {
          const entries = readZip(readFileSync(join(dropDir, name)));
          if (!record || entries.length < caseFile.fixedMembers.length)
            throw new Error("incomplete");
          disconnectPersisted += 1;
        } catch {
          disconnectPartials += 1;
        }
      }
      if (disconnectPersisted > 0 && disconnectPartials === 0) break;
      if (performance.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assertDisconnect({ ...seen, persisted: disconnectPersisted, partials: disconnectPartials });
  } finally {
    await stopApp(dropApp);
    rmSync(dropDir, { recursive: true, force: true });
  }
  return {
    overcapErrno: over.code,
    overcapPartialBytes: over.bytes,
    controls: {
      anonymous,
      viewer,
      writeErrorStatus,
      writeErrorLeftovers,
      disconnectPartials,
      disconnectPersisted,
      disconnectRequestsObserved: seen.requestsObserved,
      disconnectResponseFinished: seen.responseFinished,
      disconnectResponseClosedEarly: seen.responseClosedEarly,
      disconnectOutcome: "completed-after-disconnect",
    },
  };
}

async function runPersisted(appModule, caseFile, raw) {
  const resourcesBefore = ownedResources();
  const fixtures = [];
  for (const fixture of caseFile.fixtures) {
    fixtures.push(await runPersistedFixture(appModule, caseFile, fixture, raw));
  }
  const controls = await persistedControls(appModule, caseFile, raw); // needs /tmp max backing file
  if (readdirSync(OUTPUT_MOUNT).length !== 0) fail("oracle", "output mount not clean");
  await new Promise((resolve) => setImmediate(resolve));
  const lifecycle = { before: resourcesBefore, after: ownedResources() };
  assertLifecycle(lifecycle.before, lifecycle.after);
  return {
    backend: "MemoryStore",
    devAuthBypassLabel: "authored-development-owner-fixture",
    capBytes: OUTPUT_CAP,
    scratchOverRejected: true,
    lifecycle,
    ...controls,
    fixtures,
  };
}

function hwmBytes() {
  const status = readFileSync("/proc/self/status", "utf8");
  const match = status.match(/^VmHWM:\s+(\d+)\s+kB$/m);
  if (!match) fail("kernel", "missing VmHWM");
  return Number(match[1]) * 1024;
}

function assertBaselineIdentity(compiler, productionSha256, baselineSha256) {
  if (
    productionSha256 !== baselineSha256 ||
    compiler.productionSha256 !== productionSha256 ||
    compiler.baselineSha256 !== baselineSha256 ||
    compiler.byteIdentical !== true ||
    compiler.sourceSha256 !== "963a91bf22ff3bb5f967301fbbf38f2de55ce9301547db386f1176e9e8f70930"
  ) {
    fail("identity", "baseline does not match the actual compiled before snapshot");
  }
}

function baselineGraph() {
  const production = "/app/apps/server/dist/export.js";
  const baseline = "/app/apps/server/dist/export.baseline.js";
  const compiler = JSON.parse(
    readFileSync("/app/apps/server/dist/export.baseline.compiler.json", "utf8"),
  );
  const productionSha256 = sha256(readFileSync(production));
  const baselineSha256 = sha256(readFileSync(baseline));
  assertBaselineIdentity(compiler, productionSha256, baselineSha256);
  const dependencies = [];
  for (const name of ["archiver", "pdfkit"]) {
    const resolved = [production, baseline].map((file) => createRequire(file).resolve(name));
    if (resolved[0] !== resolved[1]) fail("identity", "baseline dependency graph differs");
    let directory = dirname(resolved[0]);
    let pkg;
    while (directory.startsWith("/app/")) {
      try {
        const candidate = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
        if (candidate.name === name) {
          pkg = candidate;
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      directory = dirname(directory);
    }
    if (!pkg || typeof pkg.version !== "string") fail("identity", "dependency package metadata");
    dependencies.push({
      name,
      path: resolved[0],
      version: pkg.version,
      sha256: sha256(readFileSync(resolved[0])),
    });
  }
  return { productionSha256, baselineSha256, compiler, dependencies };
}

async function qualify() {
  if (process.argv[3] !== "--case" || !process.argv[4])
    fail("usage", "expected --qualify --case PATH");
  const caseFile = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const raw = backingBytes();
  assertCase(caseFile, raw);
  const hashes = {
    probe: sha256(readFileSync(fileURLToPath(import.meta.url))),
    case: sha256(readFileSync(process.argv[4])),
  };
  process.stdout.write(
    `${JSON.stringify({ kind: "READY", uid: process.getuid(), gid: process.getgid(), pid: process.pid, ...hashes })}\n`,
  );
  const release = JSON.parse(await readLine());
  if (
    release.kind !== "RELEASE" ||
    typeof release.nonce !== "string" ||
    release.nonce.length < 16
  ) {
    fail("protocol", "release");
  }
  const trace = (stage, facts = {}) =>
    process.stdout.write(`${JSON.stringify({ kind: "TRACE", stage, ...facts })}\n`);
  trace("release");
  trace("kernel");
  const network = await kernelControls(caseFile, release, hashes);
  const pkg = JSON.parse(readFileSync("/app/apps/server/package.json", "utf8"));
  if (pkg.name !== caseFile.module.serverPackage) fail("identity", "package");
  const restoreClock = freezeFixtureClock(caseFile);
  try {
    trace("imports");
    const isBaseline = process.argv[5] === "--baseline";
    const isPersisted = process.argv[5] === "--persisted";
    if (
      !isBaseline &&
      readdirSync("/app/apps/server/dist").some((name) => name.startsWith("export.baseline"))
    ) {
      fail("identity", "baseline fixture leaked into the production image");
    }
    const graph = isBaseline ? baselineGraph() : null;
    const exportPath = isBaseline
      ? "/app/apps/server/dist/export.baseline.js"
      : caseFile.module.exportModule;
    const exportModule = await import(exportPath);
    const storeModule = await import(caseFile.module.storeModule);
    if (typeof exportModule[caseFile.module.exportFunction] !== "function")
      fail("identity", "export function");
    if (typeof storeModule[caseFile.module.storeClass] !== "function")
      fail("identity", "MemoryStore");
    const modules = { export: exportModule, store: storeModule };
    const baseline = [];
    let persisted = null;
    if (isPersisted) {
      trace("persisted");
      persisted = await runPersisted(await import("/app/apps/server/dist/app.js"), caseFile, raw);
    }
    for (const fixture of isPersisted ? [] : caseFile.fixtures) {
      trace(`fixture-${fixture.id}`);
      const first = await runFixture(modules, caseFile, fixture, raw);
      const second = await runFixture(modules, caseFile, fixture, raw);
      assertStableMembers(first.members, second.members);
      baseline.push(first, second);
    }
    if (!isPersisted && baseline.length !== 6) fail("oracle", "baseline count");
    const pdfByteStable =
      isPersisted ||
      baseline.every((item, index) => {
        if (index % 2 === 1) return true;
        const left = item.members.find((member) => member.name === "situasjonsbrief.pdf");
        const right = baseline[index + 1].members.find(
          (member) => member.name === "situasjonsbrief.pdf",
        );
        return Boolean(left && right && left.sha256 === right.sha256 && left.size === right.size);
      });
    if (!pdfByteStable) fail("oracle", "pdf bytes differ");
    const peak = hwmBytes();
    if (peak > caseFile.limits.memoryBytes) fail("oracle", "peak memory");
    const allowedScratch = new Set(["export72-ok"]);
    for (const fixture of caseFile.fixtures) {
      if (fixture.payloadBytes > 0) allowedScratch.add("export72-" + fixture.id + ".bin");
    }
    trace("witness");
    const witness = witnessDirectory("/tmp", caseFile.limits.tmpfsBytes);
    assertWitness(witness, allowedScratch);
    const identity = identityRecord({
      pkg: pkg.name,
      hashes,
      exportSha: sha256(readFileSync(exportPath)),
      storeSha: sha256(readFileSync(caseFile.module.storeModule)),
    });
    assertIdentity(identity);
    const receipt = {
      kind: "QUALIFIED",
      nonce: release.nonce,
      uid: process.getuid(),
      network,
      identity,
      witness,
      fixtures: baseline.map(({ id, regular, zipBytes, members }) => ({
        id,
        regular,
        zipBytes,
        members,
      })),
      logicalBytes: caseFile.maxAttachments.logicalBytes,
      persistedZip: witness.persistedZip,
      hwmBytes: peak,
      pdfByteStable,
      ...(graph ? { baseline: graph } : {}),
      ...(persisted ? { persisted } : {}),
    };
    trace("complete");
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } finally {
    restoreClock();
  }
}

const command = process.argv[2];
if (command === "--self-check") {
  selfCheck().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
} else if (command === "--qualify") {
  qualify().catch((error) => {
    process.stdout.write(`${JSON.stringify({ kind: "FAILED", error: String(error.message) })}\n`);
    process.exitCode = 1;
  });
} else {
  process.stderr.write("expected --self-check or --qualify --case PATH\n");
  process.exitCode = 2;
}
