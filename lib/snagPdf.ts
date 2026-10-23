import { snagNumber } from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { SNAG_SIGN_OFF_DISCLAIMER, outstandingHeading, outstandingLine } from '@/lib/snagWording';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { SNAG_PDF_SANS, SNAG_PDF_SANS_BOLD } from '@/lib/snagPdfFonts';

export const SNAG_PDF_PAGE_W = 595;
export const SNAG_PDF_PAGE_H = 842;
/** A put-right photo never draws narrower than this, and never at a negative size. */
export const SNAG_PDF_MIN_PHOTO = 160;
export const SNAG_PDF_UNSHOWN_NOTE = 'Some characters could not be shown; see the app record.';
const PAGE_W = SNAG_PDF_PAGE_W;
const PAGE_H = SNAG_PDF_PAGE_H;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 800;
const BOTTOM = 48;
/** Content stays above the page number. The disclaimer is drawn in the flow, not in this band. */
export const SNAG_PDF_SIGN_BOTTOM = 64;
const SIGN_BOTTOM = SNAG_PDF_SIGN_BOTTOM;
const GAP = 8;
const CAPTION_BLOCK = 18;
/** A continued outstanding page should not be left holding only a handful of rows. */
const MIN_OUTSTANDING_ROWS = 8;

export type SnagPdfPhoto = {
  bytes: Uint8Array | null;
  contentType: string;
  kind: 'before' | 'after';
};

export type SnagPdfSignature = {
  signerName: string;
  signerRole: string;
  signerCompany: string;
  signedAt: string;
  signaturePng: Uint8Array | null;
};

export type SnagPdfSnag = {
  snagSeq: number;
  note: string;
  levelArea: string | null;
  tradeLabel: string;
  status: string;
  raisedByName: string;
  raisedAt: string;
  fixedAt: string | null;
  photos: SnagPdfPhoto[];
  signature: SnagPdfSignature | null;
};

export type SnagPdfInput = {
  reportId: string;
  companyName: string;
  siteName: string;
  generatedAt: string;
  filterLabel: string;
  snags: SnagPdfSnag[];
};

export type SnagSignoffPdfInput = {
  reportId: string;
  kind: 'internal' | 'contractor';
  companyName: string;
  siteName: string;
  generatedAt: string;
  confirmationText: string;
  signerName: string;
  signerRole: string;
  signerCompany: string;
  signedAt: string;
  signaturePng: Uint8Array | null;
  covered: SnagPdfSnag[];
  outstanding: Array<{ snagSeq: number; note: string; levelArea: string | null }>;
};

export type SnagPdfTrace = {
  page: number;
  kind: 'header' | 'heading' | 'detail' | 'photo' | 'missing' | 'signature' | 'outstanding' | 'disclaimer' | 'footer';
  snagSeq?: number;
  width?: number;
  height?: number;
  /** Image box, PDF points from the bottom-left of the page. */
  x?: number;
  y?: number;
  pair?: boolean;
  /** Baseline of the drawn text. Content baselines stay at or above the page bottom. */
  baseline?: number;
};

type Face = PDFFont;

export function snagPhotoCaption(snagSeq: number, index: number, total: number, kind: 'before' | 'after'): string {
  const label = kind === 'before' ? 'Before' : 'After';
  return `${snagNumber(snagSeq)} ${label}, photo ${index + 1} of ${total}`;
}

export function snagPhotoMissing(index: number, total: number, kind: 'before' | 'after'): string {
  const label = kind === 'before' ? 'Before' : 'After';
  return `Photo ${index + 1} of ${total} (${label}) could not be loaded`;
}

function pdfFontBytes(encoded: string): Uint8Array {
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Keep letters, including accents. Drop bidi overrides, control characters, and a pound sign. */
function pdfText(value: string): string {
  return value
    .replace(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/£/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

function wrap(text: string, face: Face, size: number, max: number, prepare: Prepare = pdfText): string[] {
  const words = prepare(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words.length > 0 ? words : ['']) {
    const next = current ? `${current} ${word}` : word;
    if (face.widthOfTextAtSize(next, size) > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function snagReportId(iso: string): string {
  const formatted = formatUkDateTime(iso);
  const date = formatted.split(',')[0]?.replace(/\s+/g, '') ?? 'undated';
  return `SR-${date}`;
}

export function snagSignoffReportId(iso: string): string {
  const formatted = formatUkDateTime(iso);
  const date = formatted.split(',')[0]?.replace(/\s+/g, '') ?? 'undated';
  return `SO-${date}`;
}

export function snagPdfFilename(reportId: string): string {
  return `Snag report ${reportId}.pdf`;
}

export function snagSignoffFilename(reportId: string, kind: 'internal' | 'contractor'): string {
  const title = kind === 'internal' ? 'Internal check' : 'Snag sign-off';
  return `${title} ${reportId}.pdf`;
}

function signedLine(iso: string): string {
  return `Signed ${formatUkDateTime(iso)}`;
}

type Placed = { image: PDFImage; caption: string; landscape: boolean };
type Visual =
  | { type: 'photos'; items: Placed[] }
  | { type: 'missing'; text: string };

type LineSpec = {
  text: string;
  size: number;
  weight: 'bold' | 'regular';
  mark?: SnagPdfTrace['kind'];
  snagSeq?: number;
};
type Prepare = (value: string) => string;

function expanded(lines: LineSpec[], font: Face, bold: Face, prepare: Prepare = pdfText): LineSpec[] {
  const out: LineSpec[] = [];
  for (const line of lines) {
    const face = line.weight === 'bold' ? bold : font;
    for (const text of wrap(line.text, face, line.size, CONTENT_W, prepare)) out.push({ ...line, text });
  }
  return out;
}

function linesHeight(lines: LineSpec[]): number {
  return lines.reduce((sum, line) => sum + line.size + 4, 0);
}

export async function buildSnagPdf(input: SnagPdfInput): Promise<{ bytes: Uint8Array; trace: SnagPdfTrace[] }> {
  return drawReport(input, { disclaimer: false, bottom: BOTTOM, title: 'Snag report' });
}

export async function buildSnagSignoffPdf(input: SnagSignoffPdfInput): Promise<{ bytes: Uint8Array; trace: SnagPdfTrace[] }> {
  const covered = input.covered.map((snag) => ({ ...snag, signature: null }));
  const title = input.kind === 'internal' ? 'Internal check' : 'Snag sign-off';
  return drawReport(
    {
      reportId: input.reportId,
      companyName: input.companyName,
      siteName: input.siteName,
      generatedAt: input.generatedAt,
      filterLabel: input.kind === 'internal' ? 'Internal check' : 'Main contractor sign-off',
      snags: covered,
    },
    {
      disclaimer: true,
      bottom: SIGN_BOTTOM,
      title,
      signoff: input,
    }
  );
}

async function drawReport(
  input: SnagPdfInput,
  options: { disclaimer: boolean; bottom: number; title: string; signoff?: SnagSignoffPdfInput }
): Promise<{ bytes: Uint8Array; trace: SnagPdfTrace[] }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS), { subset: true });
  const bold = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS_BOLD), { subset: true });
  const boldChars = new Set(bold.getCharacterSet());
  const drawable = new Set(font.getCharacterSet().filter((code) => boldChars.has(code)));
  let unshown = false;
  function showText(value: string): string {
    let out = '';
    for (const char of pdfText(value)) {
      const code = char.codePointAt(0) ?? 0;
      if (drawable.has(code)) out += char;
      else {
        out += '?';
        unshown = true;
      }
    }
    return out;
  }
  doc.setTitle(showText(input.reportId));
  const trace: SnagPdfTrace[] = [];
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = TOP;
  let pageNo = 1;
  const bottom = options.bottom;

  function mark(kind: SnagPdfTrace['kind'], extra: Partial<SnagPdfTrace> = {}) {
    trace.push({ page: pageNo, kind, ...extra });
  }

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = TOP;
    pageNo += 1;
  }

  function paint(lines: LineSpec[], snagSeq?: number) {
    for (const line of lines) {
      const baseline = y - line.size;
      const face = line.weight === 'bold' ? bold : font;
      page.drawText(line.text, { x: MARGIN, y: baseline, size: line.size, font: face, color: rgb(0.1, 0.1, 0.1) });
      y -= line.size + 4;
      const seq = line.snagSeq ?? snagSeq;
      if (line.mark) mark(line.mark, seq === undefined ? { baseline } : { snagSeq: seq, baseline });
    }
  }

  function drawWrapped(text: string, size: number, weight: 'bold' | 'regular', markKind?: SnagPdfTrace['kind'], snagSeq?: number) {
    const lines = expanded([{ text, size, weight, mark: markKind }], font, bold, showText);
    if (y - linesHeight(lines) < bottom) newPage();
    paint(lines, snagSeq);
  }

  async function embed(photo: SnagPdfPhoto): Promise<PDFImage | null> {
    if (!photo.bytes) return null;
    try {
      if (photo.contentType.includes('png')) return await doc.embedPng(photo.bytes);
      return await doc.embedJpg(photo.bytes);
    } catch {
      return null;
    }
  }

  function rowHeight(items: Placed[], width: number): number {
    return Math.max(...items.map((item) => (item.image.height / item.image.width) * width));
  }

  type RowPlan = { visual: Visual; width: number; height: number; block: number };

  function layoutVisuals(visuals: Visual[], maxStack: number): { rows: RowPlan[]; total: number } {
    const natural: RowPlan[] = visuals.map((visual) => {
      if (visual.type === 'missing') {
        const block = linesHeight(expanded([{ text: visual.text, size: 11, weight: 'regular' }], font, bold, showText));
        return { visual, width: 0, height: 0, block };
      }
      const pair = visual.items.length === 2;
      const width = pair ? (CONTENT_W - GAP) / 2 : CONTENT_W;
      const height = rowHeight(visual.items, width);
      return { visual, width, height, block: height + CAPTION_BLOCK };
    });
    const naturalTotal = natural.reduce((sum, row) => sum + row.block, 0);
    if (naturalTotal <= maxStack || naturalTotal === 0) return { rows: natural, total: naturalTotal };
    const photoRows = natural.filter((row) => row.visual.type === 'photos');
    const fixed = naturalTotal - photoRows.reduce((sum, row) => sum + row.block, 0) + photoRows.length * CAPTION_BLOCK;
    const imageBudget = Math.max(0, maxStack - fixed);
    const naturalImages = photoRows.reduce((sum, row) => sum + row.height, 0);
    const scale = naturalImages > 0 ? imageBudget / naturalImages : 1;
    const rows = natural.map((row) => {
      if (row.visual.type !== 'photos') return row;
      const naturalW = row.width;
      let width = naturalW * scale;
      if (width < SNAG_PDF_MIN_PHOTO) width = Math.min(naturalW, SNAG_PDF_MIN_PHOTO);
      if (width > naturalW) width = naturalW;
      const height = Math.max(1, rowHeight(row.visual.items, width));
      return { visual: row.visual, width, height, block: height + CAPTION_BLOCK };
    });
    return { rows, total: rows.reduce((sum, row) => sum + row.block, 0) };
  }

  function drawPlannedRow(row: RowPlan, snagSeq: number) {
    if (row.visual.type === 'missing') {
      paint(expanded([{ text: row.visual.text, size: 11, weight: 'regular', mark: 'missing' }], font, bold, showText), snagSeq);
      return;
    }
    const items = row.visual.items;
    const pair = items.length === 2;
    const gap = pair ? GAP : 0;
    const top = y;
    items.forEach((item, index) => {
      const itemH = Math.max(1, (item.image.height / item.image.width) * row.width);
      const x = MARGIN + index * ((CONTENT_W - gap) / 2 + gap);
      const imageY = top - (row.height - itemH) - itemH;
      page.drawImage(item.image, { x, y: imageY, width: row.width, height: itemH });
      const captionBaseline = imageY - 12;
      page.drawText(showText(item.caption), { x, y: captionBaseline, size: 9, font: bold, color: rgb(0.15, 0.15, 0.15) });
      mark('photo', { snagSeq, width: row.width, height: itemH, pair, baseline: captionBaseline, x, y: imageY });
    });
    y = top - row.block;
  }

  async function visualsFor(snag: SnagPdfSnag): Promise<Visual[]> {
    const total = snag.photos.length;
    const visuals: Visual[] = [];
    let index = 0;
    const prepared: Array<{ image: PDFImage | null; caption: string; missing: string }> = [];
    for (const photo of snag.photos) {
      const caption = snagPhotoCaption(snag.snagSeq, index, total, photo.kind);
      prepared.push({ image: await embed(photo), caption, missing: snagPhotoMissing(index, total, photo.kind) });
      index += 1;
    }
    let cursor = 0;
    while (cursor < prepared.length) {
      const current = prepared[cursor];
      if (!current) break;
      if (!current.image) {
        visuals.push({ type: 'missing', text: current.missing });
        cursor += 1;
        continue;
      }
      const next = prepared[cursor + 1];
      const landscape = current.image.width >= current.image.height;
      const nextLandscape = Boolean(next?.image && next.image.width >= next.image.height);
      if (next?.image && landscape && nextLandscape) {
        visuals.push({
          type: 'photos',
          items: [
            { image: current.image, caption: current.caption, landscape: true },
            { image: next.image, caption: next.caption, landscape: true },
          ],
        });
        cursor += 2;
      } else {
        visuals.push({
          type: 'photos',
          items: [{ image: current.image, caption: current.caption, landscape }],
        });
        cursor += 1;
      }
    }
    return visuals;
  }

  drawWrapped(options.title, 20, 'bold', 'header');
  y -= 2;
  drawWrapped(input.companyName, 12, 'bold', 'header');
  drawWrapped(input.siteName, 12, 'regular', 'header');
  drawWrapped(formatUkDateTime(input.generatedAt), 12, 'regular', 'header');
  drawWrapped(input.filterLabel, 12, 'regular', 'header');
  y -= 8;

  const signerLines = options.signoff ? signerBlock(options.signoff, font, bold, showText) : [];
  const outstanding = options.signoff ? outstandingParts(options.signoff, font, bold, showText) : null;
  let signoffImage: PDFImage | null = null;
  if (options.signoff?.signaturePng) {
    try {
      signoffImage = await doc.embedPng(options.signoff.signaturePng);
    } catch {
      signoffImage = null;
    }
  }
  function signatureImageHeight(image: PDFImage | null): number {
    if (!image) return 0;
    const scale = Math.min(220 / image.width, 64 / image.height, 1);
    return image.height * scale + 8;
  }

  const disclaimerLines = options.disclaimer
    ? expanded([{ text: SNAG_SIGN_OFF_DISCLAIMER, size: 8, weight: 'regular', mark: 'disclaimer' }], font, bold, showText)
    : [];
  const continuedLines = expanded(
    [{ text: 'Outstanding (continued)', size: 12, weight: 'bold', mark: 'outstanding' }],
    font,
    bold,
    showText
  );
  const closingH = linesHeight(signerLines) + signatureImageHeight(signoffImage) + linesHeight(disclaimerLines);
  const outstandingItems = outstanding?.items ?? [];
  const rowsHeight = (rows: LineSpec[][]) => rows.reduce((sum, row) => sum + linesHeight(row), 0);
  const outstandingHeadingH = outstanding ? linesHeight(outstanding.heading) : 0;
  const pageBudget = TOP - bottom;
  const wholeFitsPage = Boolean(
    outstanding && outstandingHeadingH + rowsHeight(outstandingItems) + closingH <= pageBudget
  );
  // Keep a short outstanding list with the last snag when the photos can stay at least 160pt.
  // A long list is drawn after the snags, and its last rows share the signer page.
  const closeH =
    options.signoff && outstanding && wholeFitsPage
      ? 10 + outstandingHeadingH + rowsHeight(outstandingItems) + closingH
      : 0;

  function paintSignoffClose() {
    paint(signerLines);
    if (signoffImage) {
      const h = signatureImageHeight(signoffImage) - 8;
      const scale = h / signoffImage.height;
      const w = signoffImage.width * scale;
      const imageBottom = y - h;
      page.drawImage(signoffImage, { x: MARGIN, y: imageBottom, width: w, height: h });
      y -= h + 8;
      mark('signature', { baseline: imageBottom });
    }
    if (disclaimerLines.length > 0) paint(disclaimerLines);
  }

  for (const snag of input.snags) {
    const detail = expanded(detailLines(snag), font, bold, showText);
    const visuals = await visualsFor(snag);
    let signatureImage: PDFImage | null = null;
    if (snag.signature?.signaturePng) {
      try {
        signatureImage = await doc.embedPng(snag.signature.signaturePng);
      } catch {
        signatureImage = null;
      }
    }
    const sigLines = snag.signature
      ? expanded(
          [
            { text: snag.signature.signerName, size: 12, weight: 'bold', mark: 'signature' },
            { text: snag.signature.signerRole, size: 12, weight: 'regular', mark: 'signature' },
            { text: snag.signature.signerCompany, size: 12, weight: 'regular', mark: 'signature' },
            { text: signedLine(snag.signature.signedAt), size: 12, weight: 'regular', mark: 'signature' },
          ],
          font,
          bold,
          showText
        )
      : [];
    const sigImage = signatureImage ? signatureImageHeight(signatureImage) : 0;
    const detailH = linesHeight(detail) + 4;
    const chrome = detailH + linesHeight(sigLines) + sigImage + 10;
    const reserve = snag === input.snags[input.snags.length - 1] ? closeH : 0;
    const fresh = TOP - bottom;

    function plan(room: number, hold: number): { rows: RowPlan[]; height: number } | null {
      const stackLimit = room - chrome - hold;
      if (stackLimit < 0) return null;
      const laid = layoutVisuals(visuals, stackLimit);
      if (laid.rows.some((row) => row.visual.type === 'photos' && row.width < SNAG_PDF_MIN_PHOTO - 0.01)) return null;
      const height = chrome + laid.total + hold;
      if (height > room + 0.5) return null;
      return { rows: laid.rows, height };
    }

    let laid = reserve > 0 ? plan(y - bottom, reserve) : null;
    if (!laid && reserve > 0 && plan(fresh, reserve)) {
      newPage();
      laid = plan(fresh, reserve);
    }
    if (!laid) laid = plan(y - bottom, 0);
    if (!laid) {
      newPage();
      laid = plan(fresh, 0);
    }
    if (!laid) {
      const fallback = layoutVisuals(visuals, 0);
      laid = { rows: fallback.rows, height: chrome + fallback.total };
    }

    paint(detail, snag.snagSeq);
    y -= 4;
    for (const row of laid.rows) drawPlannedRow(row, snag.snagSeq);
    if (sigLines.length > 0) paint(sigLines, snag.snagSeq);
    if (signatureImage) {
      const h = signatureImageHeight(signatureImage) - 8;
      const scale = h / signatureImage.height;
      page.drawImage(signatureImage, { x: MARGIN, y: y - h, width: signatureImage.width * scale, height: h });
      y -= h + 8;
      mark('signature', { snagSeq: snag.snagSeq });
    }
    y -= 10;
  }

  if (input.snags.length === 0) drawWrapped('No snags in this report.', 12, 'regular');

  if (options.signoff && outstanding) {
    const itemH = outstandingItems.map((row) => linesHeight(row));
    const headH = linesHeight(outstanding.heading);
    const contH = linesHeight(continuedLines);
    const closeRoom = pageBudget - contH - closingH;
    let maxKeep = 0;
    {
      let used = 0;
      for (let index = itemH.length - 1; index >= 0; index -= 1) {
        const height = itemH[index] ?? 0;
        if (maxKeep > 0 && used + height > closeRoom) break;
        used += height;
        maxKeep += 1;
        if (maxKeep === 1 && height > closeRoom) break;
      }
    }
    function prefixOrphan(prefixLen: number): number {
      if (prefixLen <= 0) return 0;
      let index = 0;
      let pageRows = 0;
      let used = headH;
      while (index < prefixLen) {
        const height = itemH[index] ?? 0;
        if (pageRows > 0 && used + height > pageBudget) {
          pageRows = 0;
          used = contH;
          continue;
        }
        used += height;
        pageRows += 1;
        index += 1;
      }
      return pageRows < MIN_OUTSTANDING_ROWS ? pageRows : 0;
    }
    let keep = Math.min(maxKeep, itemH.length);
    if (itemH.length > keep) {
      const floor = Math.min(MIN_OUTSTANDING_ROWS, Math.max(maxKeep, 1));
      let guard = 0;
      while (guard < itemH.length) {
        guard += 1;
        const orphan = prefixOrphan(itemH.length - keep);
        if (orphan === 0) break;
        const need = MIN_OUTSTANDING_ROWS - orphan;
        if (keep - need < floor) break;
        keep -= need;
      }
    }
    const allH = headH + itemH.reduce((sum, height) => sum + height, 0) + closingH;
    if (itemH.length <= keep && allH <= pageBudget) {
      if (y - allH < bottom) newPage();
      paint(outstanding.heading);
      for (const item of outstandingItems) paint(item);
      paintSignoffClose();
    } else {
      if (keep < 1) keep = Math.min(1, itemH.length);
      const prefix = outstandingItems.slice(0, outstandingItems.length - keep);
      const suffix = outstandingItems.slice(outstandingItems.length - keep);
      if (y < TOP - 0.5) newPage();
      if (prefix.length > 0) {
        paint(outstanding.heading);
        for (const item of prefix) {
          if (y - linesHeight(item) < bottom) {
            newPage();
            paint(continuedLines);
          }
          paint(item);
        }
      }
      const suffixHead = prefix.length > 0 ? continuedLines : outstanding.heading;
      const suffixH = linesHeight(suffixHead) + rowsHeight(suffix) + closingH;
      const pageBefore = pageNo;
      if (y - suffixH < bottom) newPage();
      const headingAlreadyHere =
        pageNo === pageBefore && trace.some((item) => item.page === pageNo && item.kind === 'outstanding');
      if (!headingAlreadyHere) paint(suffixHead);
      for (const item of suffix) paint(item);
      paintSignoffClose();
    }
  }

  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((sheet, index) => {
    drawSheetFooter(sheet, showText(input.reportId), showText(input.companyName), index + 1, total, font);
    trace.push({ page: index + 1, kind: 'footer', baseline: 26 });
    if (unshown && index === total - 1) {
      sheet.drawText(SNAG_PDF_UNSHOWN_NOTE, {
        x: MARGIN,
        y: 40,
        size: 8,
        font,
        color: rgb(0.25, 0.25, 0.25),
      });
    }
  });

  return { bytes: await doc.save(), trace };
}

function detailLines(snag: SnagPdfSnag): LineSpec[] {
  const lines: LineSpec[] = [
    { text: `${snagNumber(snag.snagSeq)} · ${snag.tradeLabel} · ${snag.status}`, size: 14, weight: 'bold', mark: 'heading' },
    { text: snag.note, size: 11, weight: 'regular', mark: 'detail' },
  ];
  if (snag.levelArea) lines.push({ text: `Level or area: ${snag.levelArea}`, size: 11, weight: 'regular', mark: 'detail' });
  lines.push({ text: `Raised by ${snag.raisedByName} · ${formatUkDateTime(snag.raisedAt)}`, size: 11, weight: 'regular', mark: 'detail' });
  if (snag.fixedAt) lines.push({ text: `Fixed ${formatUkDateTime(snag.fixedAt)}`, size: 11, weight: 'regular', mark: 'detail' });
  return lines;
}

function signerBlock(input: SnagSignoffPdfInput, font: Face, bold: Face, prepare: Prepare): LineSpec[] {
  return expanded(
    [
      { text: input.confirmationText, size: 11, weight: 'regular', mark: 'signature' },
      { text: input.signerName, size: 12, weight: 'bold', mark: 'signature' },
      { text: input.signerRole, size: 12, weight: 'regular', mark: 'signature' },
      { text: input.signerCompany, size: 12, weight: 'regular', mark: 'signature' },
      { text: signedLine(input.signedAt), size: 12, weight: 'regular', mark: 'signature' },
    ],
    font,
    bold,
    prepare
  );
}

function outstandingParts(
  input: SnagSignoffPdfInput,
  font: Face,
  bold: Face,
  prepare: Prepare
): { heading: LineSpec[]; items: LineSpec[][] } {
  const heading = expanded(
    [
      {
        text: input.outstanding.length === 0 ? 'No snags are outstanding.' : outstandingHeading(input.outstanding.length),
        size: 12,
        weight: input.outstanding.length === 0 ? 'regular' : 'bold',
        mark: 'outstanding',
      },
    ],
    font,
    bold,
    prepare
  );
  const items = input.outstanding.map((row) =>
    expanded(
      [
        {
          text: outstandingLine(row.snagSeq, row.note, row.levelArea),
          size: 11,
          weight: 'regular',
          mark: 'outstanding',
          snagSeq: row.snagSeq,
        },
      ],
      font,
      bold,
      prepare
    )
  );
  return { heading, items };
}

function drawSheetFooter(sheet: PDFPage, reportId: string, company: string, page: number, total: number, font: Face) {
  sheet.drawText(footerLabel(reportId, company, page, total, font), {
    x: MARGIN,
    y: 26,
    size: 9,
    font,
    color: rgb(0.25, 0.25, 0.25),
  });
}

function footerLabel(reportId: string, company: string, page: number, total: number, font: Face): string {
  const tail = ` · ${reportId} · Page ${page} of ${total}`;
  if (font.widthOfTextAtSize(company + tail, 9) <= CONTENT_W) return `${company}${tail}`;
  const dots = '\u2026';
  const chars = Array.from(company);
  while (chars.length > 0 && font.widthOfTextAtSize(`${chars.join('')}${dots}${tail}`, 9) > CONTENT_W) chars.pop();
  return `${chars.join('')}${dots}${tail}`;
}

export function signatureStaysWithSnag(trace: SnagPdfTrace[], snagSeq: number): boolean {
  const pages = trace.filter((item) => item.kind === 'signature' && item.snagSeq === snagSeq).map((item) => item.page);
  if (pages.length === 0) return false;
  return pages.every((page) =>
    trace.some((item) => item.page === page && item.snagSeq === snagSeq && (item.kind === 'photo' || item.kind === 'heading' || item.kind === 'missing'))
  );
}

export function headingStaysWithFirstPhoto(trace: SnagPdfTrace[], snagSeq: number): boolean {
  const heading = trace.find((item) => item.kind === 'heading' && item.snagSeq === snagSeq);
  const first = trace.find((item) => (item.kind === 'photo' || item.kind === 'missing') && item.snagSeq === snagSeq);
  if (!heading || !first) return false;
  return heading.page === first.page;
}

export function detailsStayWithHeading(trace: SnagPdfTrace[], snagSeq: number): boolean {
  const pages = new Set(
    trace.filter((item) => item.snagSeq === snagSeq && (item.kind === 'heading' || item.kind === 'detail')).map((item) => item.page)
  );
  return pages.size === 1;
}
