import { sampleSituation, type SituationWorkspace } from "@nytt/shared";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import { expect, it, vi } from "vitest";
import { buildWorkspaceExport } from "../src/export.js";
import { MemoryStore } from "../src/store.js";

vi.mock("archiver", { spy: true });

it("rejects the export when the PDF document emits an error", async () => {
  const store = new MemoryStore();
  const attachment = await store.addAttachment({
    id: "pdf-failure-attachment",
    situationId: sampleSituation.id,
    filename: "not-exported.txt",
    storagePath: "/not-exported.txt",
    contentType: "text/plain",
    size: 1,
    sha256: "0".repeat(64),
    createdAt: sampleSituation.updatedAt,
  });
  const workspace: SituationWorkspace = {
    situation: sampleSituation,
    relatedArticles: [],
    tasks: [],
    notes: [],
    attachments: [attachment],
  };
  const getAttachment = vi.spyOn(store, "getAttachment");
  const pdfError = new Error("synthetic PDF failure");
  const originalEnd = PDFDocument.prototype.end;
  let emitPdfError: (() => void) | undefined;
  const end = vi.spyOn(PDFDocument.prototype, "end").mockImplementation(function (
    this: PDFDocument,
    ...args: Parameters<PDFDocument["end"]>
  ) {
    // Keep the unchanged baseline from crashing Vitest; only the product promise can reject.
    this.once("error", () => undefined);
    emitPdfError = () => this.emit("error", pdfError);
    setImmediate(() => Reflect.apply(originalEnd, this, args));
    return this;
  });

  try {
    const result = buildWorkspaceExport(store, workspace);
    if (!emitPdfError) throw new Error("PDF document did not reach end");
    const rejection = expect(result).rejects.toBe(pdfError);
    queueMicrotask(emitPdfError);
    await rejection;
    expect(archiver).not.toHaveBeenCalled();
    expect(getAttachment).not.toHaveBeenCalled();
  } finally {
    getAttachment.mockRestore();
    end.mockRestore();
  }
});
