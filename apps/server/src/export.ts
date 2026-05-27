import { PassThrough } from "node:stream";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import type { SituationWorkspace } from "@nytt/shared";
import type { Store } from "./store.js";

export function safeFilename(filename: string): string {
  const name = filename.split(/[\\/]/).pop() ?? "vedlegg";
  const sanitized = [...name]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === '"' ? "_" : character;
    })
    .join("");
  return sanitized.slice(0, 180) || "vedlegg";
}

function renderBrief(workspace: SituationWorkspace): Promise<Buffer> {
  return new Promise((resolve) => {
    const buffers: Buffer[] = [];
    const doc = new PDFDocument({ margin: 48, size: "A4" });
    doc.on("data", (chunk: Buffer) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.fontSize(11).fillColor("#37536a").text("NYTT TRONDHEIM / SITUASJONSROM");
    doc.moveDown(0.5).fontSize(26).fillColor("#141b1e").text(workspace.situation.title);
    doc
      .moveDown(0.4)
      .fontSize(11)
      .fillColor("#586671")
      .text(
        `${workspace.situation.verificationStatus}  |  Sist oppdatert ${workspace.situation.updatedAt}`,
      );
    doc.moveDown(1.2).fontSize(15).fillColor("#141b1e").text("Dette vet vi nå");
    workspace.situation.evidence.forEach((evidence) => {
      doc.moveDown(0.5).fontSize(11).text(`- [${evidence.provenance}] ${evidence.claim}`);
      doc.fontSize(9).fillColor("#586671").text(`${evidence.sourceLabel}: ${evidence.sourceUrl}`);
      doc.fillColor("#141b1e");
    });
    doc.moveDown(1).fontSize(15).text("Utvikling");
    workspace.situation.timeline.forEach((entry) => {
      doc
        .moveDown(0.4)
        .fontSize(10)
        .fillColor("#586671")
        .text(`${entry.timestamp} / ${entry.sourceLabel}`);
      doc.fontSize(11).fillColor("#141b1e").text(`${entry.title}: ${entry.detail}`);
    });
    doc.moveDown(1).fontSize(15).fillColor("#141b1e").text("Kartlag og proveniens");
    doc
      .moveDown(0.4)
      .fontSize(10)
      .text(
        "- Offentlig oppgitt / Farevarsel: publisert offentlig kontekst, ikke bekreftelse på innsats.",
      );
    doc.text(
      "- Anslag fra rapportering: geokodet omtale fra publiserte saker, ikke presis avgrensning.",
    );
    doc.text(
      "- DSB beredskap: ressurser i området, ikke aktive responspersonell eller plasseringer.",
    );
    doc.text("- Mine markeringer: privat arbeidsmateriale og aldri offentlig evidens.");
    doc.moveDown(1).fontSize(15).text("Private arbeidsnotater");
    if (workspace.notes.length === 0) {
      doc.fontSize(10).fillColor("#586671").text("Ingen private notater.");
    } else {
      workspace.notes.forEach((note) =>
        doc.fontSize(10).fillColor("#141b1e").text(`- ${note.text}`),
      );
    }
    doc
      .moveDown(1)
      .fontSize(9)
      .fillColor("#586671")
      .text("Privat eksport. Kartlag har ulik proveniens og må ikke blandes.");
    doc.end();
  });
}

export async function buildWorkspaceExport(
  store: Store,
  workspace: SituationWorkspace,
  manifest?: unknown,
): Promise<Buffer> {
  const pdf = await renderBrief(workspace);
  const archive = archiver("zip", { zlib: { level: 9 } });
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    output.on("data", (chunk: Buffer) => chunks.push(chunk));
    output.on("end", () => resolve(Buffer.concat(chunks)));
    output.on("error", reject);
    archive.on("error", reject);
  });
  archive.pipe(output);
  archive.append(pdf, { name: "situasjonsbrief.pdf" });
  archive.append(JSON.stringify(workspace.situation.timeline, null, 2), { name: "utvikling.json" });
  archive.append(JSON.stringify(workspace.situation.evidence, null, 2), {
    name: "kilder-og-evidens.json",
  });
  archive.append(JSON.stringify({ tasks: workspace.tasks, notes: workspace.notes }, null, 2), {
    name: "privat/arbeidsnotater.json",
  });
  archive.append(
    JSON.stringify(
      manifest ?? {
        situationId: workspace.situation.id,
        attachmentChecksums: workspace.attachments.map(({ filename, sha256, size }) => ({
          filename: safeFilename(filename),
          sha256,
          size,
        })),
      },
      null,
      2,
    ),
    { name: "manifest.json" },
  );
  for (const provenance of [
    "official",
    "reporting_estimate",
    "preparedness_context",
    "private_annotation",
  ]) {
    const features = workspace.situation.features.filter(
      (feature) => feature.properties.provenance === provenance,
    );
    archive.append(JSON.stringify({ type: "FeatureCollection", features }, null, 2), {
      name: `kartlag/${provenance}.geojson`,
    });
  }
  for (const attachment of workspace.attachments) {
    const stored = await store.getAttachment(attachment.id);
    if (stored)
      archive.file(stored.storagePath, { name: `vedlegg/${safeFilename(stored.filename)}` });
  }
  await archive.finalize();
  return finished;
}
