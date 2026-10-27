import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { sampleSituation, type SituationWorkspace } from "@nytt/shared";
import { expect, it, vi } from "vitest";
import { buildWorkspaceExport } from "../src/export.js";
import { MemoryStore } from "../src/store.js";

const execFileAsync = promisify(execFile);

it("keeps ZIP members and payloads in workspace order when concurrent stats finish backwards", async () => {
  const directory = await mkdtemp(path.join(process.cwd(), ".export-order-"));
  const originalLstat = fs.lstat;
  const statSpy = vi.spyOn(fs, "lstat");
  try {
    const store = new MemoryStore();
    const workspace: SituationWorkspace = {
      situation: sampleSituation,
      relatedArticles: [],
      tasks: [],
      notes: [],
      attachments: [],
    };
    const names = ["third.bin", "first.bin", "second.bin"];
    const payloads = names.map((name, index) => Buffer.from(`${index}\0${name}\n`));
    const stats = new Map<string, fs.Stats>();
    for (const [index, filename] of names.entries()) {
      const payload = payloads[index]!;
      const storagePath = path.join(directory, filename);
      await writeFile(storagePath, payload);
      stats.set(storagePath, await lstat(storagePath));
      workspace.attachments.push(
        await store.addAttachment({
          id: filename,
          situationId: sampleSituation.id,
          filename,
          storagePath,
          contentType: "application/octet-stream",
          size: payload.length,
          sha256: createHash("sha256").update(payload).digest("hex"),
          createdAt: sampleSituation.updatedAt,
        }),
      );
    }

    const pending: Array<() => void> = [];
    const completedStats: string[] = [];
    statSpy.mockImplementation((...args: Parameters<typeof fs.lstat>) => {
      const stat = stats.get(String(args[0]));
      const callback = args.find((arg) => typeof arg === "function");
      if (!stat || !callback) return Reflect.apply(originalLstat, fs, args);
      pending.push(() => {
        completedStats.push(String(args[0]));
        callback(null, stat);
      });
      // Reverse every admitted batch without waiting for a second stat in the serial case.
      if (pending.length === 1) {
        setImmediate(() => {
          for (const complete of pending.splice(0).reverse()) complete();
        });
      }
    });

    const zip = await buildWorkspaceExport(store, workspace);
    expect(completedStats).toHaveLength(names.length);
    const zipPath = path.join(directory, "workspace.zip");
    await writeFile(zipPath, zip);
    const { stdout } = await execFileAsync("unzip", ["-Z1", zipPath]);
    expect(stdout.trim().split("\n")).toEqual([
      "situasjonsbrief.pdf",
      "utvikling.json",
      "kilder-og-evidens.json",
      "privat/arbeidsnotater.json",
      "manifest.json",
      "README.txt",
      "kartlag/official.geojson",
      "kartlag/reporting_estimate.geojson",
      "kartlag/preparedness_context.geojson",
      "kartlag/private_annotation.geojson",
      ...names.map((name) => `vedlegg/${name}`),
    ]);
    await execFileAsync("unzip", ["-t", zipPath]);
    for (const [index, name] of names.entries()) {
      const { stdout: payload } = await execFileAsync("unzip", ["-p", zipPath, `vedlegg/${name}`], {
        encoding: "buffer",
      });
      expect(payload).toEqual(payloads[index]);
    }
  } finally {
    statSpy.mockRestore();
    await rm(directory, { recursive: true, force: true });
  }
});
