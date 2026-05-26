import type { Response } from "express";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import type { SituationWorkspace } from "@nytt/shared";
import type { Store } from "./store.js";

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
      doc.moveDown(0.5).fontSize(11).text(`- ${evidence.claim}`);
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

export async function streamWorkspaceExport(
  res: Response,
  store: Store,
  workspace: SituationWorkspace,
): Promise<void> {
  const pdf = await renderBrief(workspace);
  const archive = archiver("zip", { zlib: { level: 9 } });
  res.attachment(`${workspace.situation.id}-arbeidsmappe.zip`);
  archive.pipe(res);
  archive.append(pdf, { name: "situasjonsbrief.pdf" });
  archive.append(JSON.stringify(workspace.situation.timeline, null, 2), { name: "utvikling.json" });
  archive.append(JSON.stringify(workspace.situation.evidence, null, 2), {
    name: "kilder-og-evidens.json",
  });
  archive.append(JSON.stringify({ tasks: workspace.tasks, notes: workspace.notes }, null, 2), {
    name: "privat/arbeidsnotater.json",
  });
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
    if (stored) archive.file(stored.storagePath, { name: `vedlegg/${stored.filename}` });
  }
  await archive.finalize();
}
