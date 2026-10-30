import "server-only";

import PDFDocument from "pdfkit";
import { ATTESTATIONS } from "@/lib/attestations";

/*
 * The inspection record as a self-contained PDF — the damage-liability
 * document. Layout only: the route loads the data and the image blobs; this
 * renders them. Read-only by construction (it never sees a writable client).
 *
 * Printable first: A4, Helvetica, near-black text, one navy accent rule.
 * Every timestamp is rendered in the building's timezone and says so.
 */

const TZ = "America/Chicago";
const NAVY = "#16264a";
const INK = "#11141b";
const MUTED = "#5c6577";
const LINE = "#d7dbe4";
/** The one red on the page: damaged/missing items and "resident did not
    sign" — the facts a dispute turns on. Print-safe, not the screen's orange. */
const ALERT = "#8a1f11";
const PAGE_W = 595.28; // A4 pt
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;

export type PdfSignature = {
  role: "resident" | "ra";
  signedAt: string;
  signerName: string;
  png: Buffer | null; // null = image missing/undecodable; render a note
};

export type PdfPhoto = {
  itemName: string;
  jpeg: Buffer | null;
};

export type PdfWaiver = { reason: string; recordedBy: string; recordedAt: string };

export type InspectionPdfData = {
  type: "move_in" | "move_out";
  residentName: string;
  studentId: string;
  roomNumber: string;
  hallwayName: string;
  term: string;
  inspectedAt: string;
  inspectorName: string;
  items: { name: string; condition: string; note: string | null }[];
  inspectionNote: string | null;
  photos: PdfPhoto[];
  signatures: PdfSignature[];
  waiver: PdfWaiver | null;
};

function stamp(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", {
    timeZone: TZ,
    dateStyle: "medium",
    timeStyle: "short",
  })} (Central Time)`;
}

type Doc = InstanceType<typeof PDFDocument>;

/** Open an A4 document with the record's page geometry and collect its bytes. */
function openDocument(title: string): { doc: Doc; done: Promise<Buffer> } {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: MARGIN, bottom: MARGIN + 18, left: MARGIN, right: MARGIN },
    bufferPages: true,
    info: { Title: title, Author: "Tudor Hall" },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on("end", () => resolve(Buffer.concat(chunks))),
  );
  return { doc, done };
}

/** What a page's footer says about the record it belongs to. */
type PageOwner = Pick<InspectionPdfData, "hallwayName" | "roomNumber" | "type">;

/**
 * Every page of one record, from the title block to the signature boxes —
 * everything except opening the document and stamping footers. The single
 * export and the hallway packet both draw through THIS, so there is one
 * template and one layout; the packet only decides where records start.
 */
function drawRecord(doc: Doc, data: InspectionPdfData): void {
  const ensureRoom = (needed: number) => {
    if (doc.y + needed > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };

  // ---- Title block ---------------------------------------------------------
  doc
    .fillColor(NAVY)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text("TUDOR HALL", { characterSpacing: 2 });
  doc
    .fontSize(20)
    .text(data.type === "move_in" ? "Move-in inspection record" : "Move-out inspection record");
  doc.moveDown(0.4);
  doc
    .moveTo(MARGIN, doc.y)
    .lineTo(MARGIN + CONTENT_W, doc.y)
    .lineWidth(2)
    .strokeColor(NAVY)
    .stroke();
  doc.moveDown(0.8);

  // ---- Meta grid -----------------------------------------------------------
  const meta: [string, string][] = [
    ["Resident", data.residentName],
    ["Student ID", data.studentId],
    ["Room", `${data.hallwayName} · Room ${data.roomNumber}`],
    ["Term", data.term],
    ["Inspected", stamp(data.inspectedAt)],
    ["Conducted by", data.inspectorName],
  ];
  const colW = CONTENT_W / 2;
  const rowH = 30;
  const gridTop = doc.y;
  meta.forEach(([label, value], i) => {
    const x = MARGIN + (i % 2) * colW;
    const y = gridTop + Math.floor(i / 2) * rowH;
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x, y, { characterSpacing: 1 });
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text(value, x, y + 10, { width: colW - 12 });
  });
  doc.x = MARGIN;
  doc.y = gridTop + Math.ceil(meta.length / 2) * rowH + 6;

  // ---- Items table ---------------------------------------------------------
  doc.font("Helvetica-Bold").fontSize(12).fillColor(NAVY).text("Condition by item");
  doc.moveDown(0.3);
  for (const item of data.items) {
    const noteHeight = item.note
      ? doc.font("Helvetica").fontSize(9).heightOfString(item.note, { width: CONTENT_W - 110 })
      : 0;
    ensureRoom(22 + noteHeight);
    const y = doc.y;
    doc.font("Helvetica").fontSize(10.5).fillColor(INK).text(item.name, MARGIN, y, { width: CONTENT_W - 110 });
    const bad = item.condition === "damaged" || item.condition === "missing";
    doc
      .font(bad ? "Helvetica-Bold" : "Helvetica")
      .fontSize(10.5)
      .fillColor(bad ? ALERT : INK)
      .text(item.condition.toUpperCase(), MARGIN + CONTENT_W - 100, y, { width: 100, align: "right" });
    if (item.note) {
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(item.note, MARGIN + 12, doc.y + 1, { width: CONTENT_W - 110 });
    }
    doc.y += 5;
    doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT_W, doc.y).lineWidth(0.5).strokeColor(LINE).stroke();
    doc.y += 5;
    doc.x = MARGIN;
  }

  if (data.inspectionNote) {
    ensureRoom(50);
    doc.moveDown(0.4);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(INK).text("Inspection notes");
    doc.font("Helvetica").fontSize(10).fillColor(INK).text(data.inspectionNote, { width: CONTENT_W });
  }

  // ---- Photos --------------------------------------------------------------
  if (data.photos.length > 0) {
    ensureRoom(60);
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(NAVY).text("Photos");
    doc.moveDown(0.3);
    for (const photo of data.photos) {
      ensureRoom(200);
      doc.font("Helvetica").fontSize(9).fillColor(MUTED).text(photo.itemName, MARGIN, doc.y);
      doc.y += 2;
      if (photo.jpeg) {
        try {
          doc.image(photo.jpeg, MARGIN, doc.y, { fit: [260, 180] });
          doc.y += 186;
        } catch {
          doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED)
            .text("[Photo could not be embedded — stored image is available in the app.]");
          doc.y += 6;
        }
      } else {
        doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED)
          .text("[Photo could not be retrieved from storage.]");
        doc.y += 6;
      }
      doc.x = MARGIN;
    }
  }

  drawSignatures(doc, data, ensureRoom);
}

/** A box's placement on the page. */
type Box = { x: number; top: number; w: number; h: number };

const BOX_PAD = 10;
const SIGNATURE_BOX_H = 150;

/** How tall a waiver box must be to hold its reason without overflowing;
    never shorter than a signature box so a side-by-side pair lines up. */
function waiverBoxHeight(doc: Doc, waiver: PdfWaiver, w: number): number {
  const reasonH = doc
    .font("Helvetica-Oblique")
    .fontSize(9.5)
    .heightOfString(`“${waiver.reason}”`, { width: w - BOX_PAD * 2 });
  // Title + intro line above the reason, the "Recorded by" line below it.
  return Math.max(SIGNATURE_BOX_H, BOX_PAD + 40 + reasonH + 8 + 26);
}

function drawSignatureBox(doc: Doc, data: InspectionPdfData, box: Box, sig: PdfSignature): void {
  const { x, top, w, h } = box;
  doc.rect(x, top, w, h).lineWidth(0.75).strokeColor(LINE).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(INK)
    .text(`${sig.role === "resident" ? "Resident" : "RA"} — ${sig.signerName}`, x + BOX_PAD, top + BOX_PAD, { width: w - BOX_PAD * 2 });
  doc.font("Helvetica-Oblique").fontSize(8).fillColor(MUTED)
    .text(`“${ATTESTATIONS[data.type][sig.role]}”`, x + BOX_PAD, top + BOX_PAD + 13, { width: w - BOX_PAD * 2 });
  if (sig.png) {
    try {
      doc.image(sig.png, x + BOX_PAD, top + 44, { fit: [w - BOX_PAD * 2, 70] });
    } catch {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED)
        .text("[Signature image could not be embedded.]", x + BOX_PAD, top + 70, { width: w - BOX_PAD * 2 });
    }
  } else {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(MUTED)
      .text("[Signature image could not be retrieved.]", x + BOX_PAD, top + 70, { width: w - BOX_PAD * 2 });
  }
  doc.font("Helvetica").fontSize(8).fillColor(MUTED)
    .text(`Signed ${stamp(sig.signedAt)}`, x + BOX_PAD, top + h - 18, { width: w - BOX_PAD * 2 });
}

function drawWaiverBox(doc: Doc, box: Box, waiver: PdfWaiver): void {
  const { x, top, w, h } = box;
  doc.rect(x, top, w, h).lineWidth(0.75).strokeColor(LINE).stroke();
  doc.font("Helvetica-Bold").fontSize(9).fillColor(ALERT)
    .text("Resident did not sign", x + BOX_PAD, top + BOX_PAD, { width: w - BOX_PAD * 2 });
  doc.font("Helvetica").fontSize(9).fillColor(INK)
    .text("Recorded as unavailable / declined to sign. Reason:", x + BOX_PAD, top + BOX_PAD + 14, { width: w - BOX_PAD * 2 });
  doc.font("Helvetica-Oblique").fontSize(9.5).fillColor(INK)
    .text(`“${waiver.reason}”`, x + BOX_PAD, top + BOX_PAD + 40, { width: w - BOX_PAD * 2 });
  doc.font("Helvetica").fontSize(8).fillColor(MUTED)
    .text(`Recorded by ${waiver.recordedBy}, ${stamp(waiver.recordedAt)}`, x + BOX_PAD, top + h - 26, { width: w - BOX_PAD * 2 });
}

/**
 * The attestation boxes. Resident half on the left, RA on the right; the
 * resident half is the signature when there is one, else the waiver. When
 * BOTH exist (a resident who signed after the RA had already recorded them
 * as unavailable) the waiver is still part of the record and prints below,
 * full width — the document never quietly drops something that was recorded.
 */
function drawSignatures(
  doc: Doc,
  data: InspectionPdfData,
  ensureRoom: (needed: number) => void,
): void {
  const halfW = (CONTENT_W - 16) / 2;
  const resident = data.signatures.find((s) => s.role === "resident");
  const ra = data.signatures.find((s) => s.role === "ra");
  const waiverBeside = !resident && data.waiver ? data.waiver : null;
  const waiverBelow = resident && data.waiver ? data.waiver : null;

  const row1H = waiverBeside
    ? waiverBoxHeight(doc, waiverBeside, halfW)
    : SIGNATURE_BOX_H;
  ensureRoom(40 + row1H);
  doc.moveDown(0.8);
  doc.font("Helvetica-Bold").fontSize(12).fillColor(NAVY).text("Signatures", MARGIN, doc.y);
  doc.moveDown(0.3);

  const top = doc.y;
  const left: Box = { x: MARGIN, top, w: halfW, h: row1H };
  const right: Box = { x: MARGIN + halfW + 16, top, w: halfW, h: row1H };
  if (resident) drawSignatureBox(doc, data, left, resident);
  else if (waiverBeside) drawWaiverBox(doc, left, waiverBeside);
  if (ra) drawSignatureBox(doc, data, right, ra);
  doc.y = top + row1H + 10;
  doc.x = MARGIN;

  if (waiverBelow) {
    const h = waiverBoxHeight(doc, waiverBelow, CONTENT_W);
    ensureRoom(h + 10);
    drawWaiverBox(doc, { x: MARGIN, top: doc.y, w: CONTENT_W, h }, waiverBelow);
    doc.y += h + 10;
    doc.x = MARGIN;
  }
}

/**
 * Footers, after all drawing is done — page numbers can't be known before
 * then. `owners[i]` names the record page i belongs to, which is what lets a
 * packet keep each page labelled with its own room instead of the packet's.
 */
function stampFooters(doc: Doc, owners: PageOwner[]): void {
  const generated = new Date().toISOString();
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin normally triggers an automatic page
    // break — zero it out while stamping the footer.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - MARGIN;
    const owner = owners[i] ?? owners[owners.length - 1];
    doc.font("Helvetica").fontSize(7.5).fillColor(MUTED);
    doc.text(
      `${owner.hallwayName} · Room ${owner.roomNumber} · ${owner.type === "move_in" ? "Move-in" : "Move-out"} inspection — generated ${stamp(generated)} from the Tudor Hall app`,
      MARGIN,
      y,
      { width: CONTENT_W - 60, lineBreak: false },
    );
    doc.text(`Page ${i + 1} of ${range.count}`, MARGIN + CONTENT_W - 60, y, {
      width: 60,
      align: "right",
      lineBreak: false,
    });
  }
}

/** One resident's record — the per-resident export, unchanged. */
export async function renderInspectionPdf(data: InspectionPdfData): Promise<Buffer> {
  const { doc, done } = openDocument(
    `Tudor Hall ${data.type === "move_in" ? "move-in" : "move-out"} inspection — Room ${data.roomNumber}`,
  );
  drawRecord(doc, data);
  stampFooters(doc, pageOwners(doc, [data], [0]));
  doc.end();
  return done;
}

/** Map every page drawn so far to the record it came from. */
function pageOwners(
  doc: Doc,
  records: PageOwner[],
  firstPageOf: number[],
): PageOwner[] {
  const total = doc.bufferedPageRange().count;
  const owners: PageOwner[] = [];
  for (let page = 0; page < total; page++) {
    let index = 0;
    while (index + 1 < firstPageOf.length && firstPageOf[index + 1] <= page) {
      index += 1;
    }
    owners.push(records[index]);
  }
  return owners;
}

/** Thrown when a packet is asked for and nothing printable arrives. */
export class EmptyPacketError extends Error {
  constructor() {
    super("renderInspectionPacket called with no records");
    this.name = "EmptyPacketError";
  }
}

/**
 * A whole hallway's records in one document, each starting on a fresh page.
 * No second template: this loops over the same drawRecord the single export
 * uses, so a packet's pages are the per-resident pages, concatenated.
 *
 * Takes any iterable — an array, or an async generator that loads each
 * record (images included) only when its turn comes — so a packet never
 * needs every room's photos in memory at once; once a record is drawn, its
 * image buffers are free to go.
 */
export async function renderInspectionPacket(
  records: Iterable<InspectionPdfData> | AsyncIterable<InspectionPdfData>,
  title: string,
): Promise<Buffer> {
  const { doc, done } = openDocument(title);

  const owners: PageOwner[] = [];
  const firstPageOf: number[] = [];
  for await (const record of records) {
    // Record 1 opens the document's first page; every later one starts on a
    // new page of its own.
    if (owners.length > 0) doc.addPage();
    firstPageOf.push(doc.bufferedPageRange().count - 1);
    drawRecord(doc, record);
    // Keep only what the footer needs, not the record's images.
    owners.push({ hallwayName: record.hallwayName, roomNumber: record.roomNumber, type: record.type });
  }
  if (owners.length === 0) throw new EmptyPacketError();

  stampFooters(doc, pageOwners(doc, owners, firstPageOf));
  doc.end();
  return done;
}
