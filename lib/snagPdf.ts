import { snagNumber } from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { SNAG_SIGN_OFF_DISCLAIMER, outstandingHeading, outstandingLine } from '@/lib/snagWording';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { SNAG_PDF_SANS, SNAG_PDF_SANS_BOLD } from '@/lib/snagPdfFonts';

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 800;
const BOTTOM = 48;
/** Content stays above the page number. The disclaimer is drawn in the flow, not in this band. */
export const SNAG_PDF_SIGN_BOTTOM = 64;
const SIGN_BOTTOM = SNAG_PDF_SIGN_BOTTOM;
const GAP = 8;

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
  pair?: boolean;
  /** Baseline of the drawn text. Content baselines stay at or above the page bottom. */
  baseline?: number;
};

type Face = PDFFont;

export function snagPhotoCaption(index: number, total: number, kind: 'before' | 'after'): string {
  const label = kind === 'before' ? 'Before' : 'After';
  return `${label} · Photo ${index + 1} of ${total}`;
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

/** Keep letters, including accents. A pound sign is not part of a snag report. */
function pdfText(value: string): string {
  return value
    .replace(/£/g, '')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
}

function wrap(text: string, face: Face, size: number, max: number): string[] {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
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

type LineSpec = { text: string; size: number; weight: 'bold' | 'regular'; mark?: SnagPdfTrace['kind'] };

function expanded(lines: LineSpec[], font: Face, bold: Face): Array<LineSpec & { text: string }> {
  const out: LineSpec[] = [];
  for (const line of lines) {
    const face = line.weight === 'bold' ? bold : font;
    for (const text of wrap(line.text, face, line.size, CONTENT_W)) out.push({ ...line, text });
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
  doc.setTitle(input.reportId);
  const font = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS), { subset: true });
  const bold = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS_BOLD), { subset: true });
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
      if (line.mark) mark(line.mark, snagSeq === undefined ? { baseline } : { snagSeq, baseline });
    }
  }

  function drawWrapped(text: string, size: number, weight: 'bold' | 'regular', markKind?: SnagPdfTrace['kind'], snagSeq?: number) {
    const face = weight === 'bold' ? bold : font;
    const lines = expanded([{ text, size, weight, mark: markKind }], font, bold);
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

  function drawPhotoRow(items: Placed[], snagSeq: number, reserve: number, stay: boolean) {
    const pair = items.length === 2;
    const gap = pair ? GAP : 0;
    let width = pair ? (CONTENT_W - gap) / 2 : CONTENT_W;
    let height = rowHeight(items, width);
    const captionH = 14;
    const maxH = TOP - bottom - captionH - reserve - 4;
    const room = y - bottom - captionH - reserve - 4;
    const limit = stay ? Math.max(80, Math.min(maxH, room)) : maxH;
    if (height > limit) {
      const scale = limit / height;
      height = limit;
      width = width * scale;
    }
    const block = height + captionH + reserve + 4;
    if (!stay && y - block < bottom) newPage();
    const top = y;
    items.forEach((item, index) => {
      const itemH = (item.image.height / item.image.width) * width;
      const x = MARGIN + index * ((CONTENT_W - gap) / 2 + gap);
      const imageTop = top - (height - itemH);
      page.drawImage(item.image, { x, y: imageTop - itemH, width, height: itemH });
      const captionBaseline = imageTop - itemH - 12;
      page.drawText(pdfText(item.caption), { x, y: captionBaseline, size: 9, font: bold, color: rgb(0.15, 0.15, 0.15) });
      mark('photo', { snagSeq, width, pair, baseline: captionBaseline });
    });
    y = top - height - captionH - 4;
  }

  function drawMissing(text: string, snagSeq: number) {
    const lines = expanded([{ text, size: 11, weight: 'regular', mark: 'missing' }], font, bold);
    if (y - linesHeight(lines) < bottom) newPage();
    paint(lines, snagSeq);
  }

  async function visualsFor(snag: SnagPdfSnag): Promise<Visual[]> {
    const total = snag.photos.length;
    const visuals: Visual[] = [];
    let index = 0;
    const prepared: Array<{ image: PDFImage | null; caption: string; missing: string }> = [];
    for (const photo of snag.photos) {
      const caption = snagPhotoCaption(index, total, photo.kind);
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

  function firstVisualHeight(visual: Visual | undefined, available: number): number {
    if (!visual) return 0;
    if (visual.type === 'missing') return 15;
    const pair = visual.items.length === 2;
    const gap = pair ? GAP : 0;
    const width = pair ? (CONTENT_W - gap) / 2 : CONTENT_W;
    let height = rowHeight(visual.items, width);
    const captionH = 14;
    const limit = Math.max(80, available - captionH - 4);
    if (height > limit) height = limit;
    return height + captionH + 4;
  }

  drawWrapped(options.title, 20, 'bold', 'header');
  y -= 2;
  drawWrapped(input.companyName, 12, 'bold', 'header');
  drawWrapped(input.siteName, 12, 'regular', 'header');
  drawWrapped(formatUkDateTime(input.generatedAt), 12, 'regular', 'header');
  drawWrapped(input.filterLabel, 12, 'regular', 'header');
  y -= 8;

  const signerLines = options.signoff ? signerBlock(options.signoff, font, bold) : [];
  const outstanding = options.signoff ? outstandingParts(options.signoff, font, bold) : null;
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
    ? expanded([{ text: SNAG_SIGN_OFF_DISCLAIMER, size: 8, weight: 'regular', mark: 'disclaimer' }], font, bold)
    : [];
  const continuedLines = expanded(
    [{ text: 'Outstanding (continued)', size: 12, weight: 'bold', mark: 'outstanding' }],
    font,
    bold
  );
  const closingH = linesHeight(signerLines) + signatureImageHeight(signoffImage) + linesHeight(disclaimerLines);
  const outstandingItems = outstanding?.items ?? [];
  const rowsHeight = (rows: LineSpec[][]) => rows.reduce((sum, row) => sum + linesHeight(row), 0);
  const outstandingHeadingH = outstanding ? linesHeight(outstanding.heading) : 0;
  const pageBudget = TOP - bottom;
  const wholeFitsPage = Boolean(
    outstanding && outstandingHeadingH + rowsHeight(outstandingItems) + closingH <= pageBudget
  );
  // A short list stays with the last photo, so a one-snag sign-off remains one page.
  // A long list starts after the photos; its last rows share the signer page.
  const photoTail =
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
    const detail = expanded(detailLines(snag), font, bold);
    const visuals = await visualsFor(snag);
    const reserve = snag.signature ? 6 * 16 + (snag.signature.signaturePng ? 80 : 0) + 16 : 0;
    const tail = snag === input.snags[input.snags.length - 1] ? photoTail : 0;
    const detailH = linesHeight(detail);
    const hold = visuals.length <= 1 ? reserve + tail : 0;
    const available = y - detailH - 8 - bottom - hold;
    const opening = detailH + firstVisualHeight(visuals[0], Math.max(available, 0)) + hold + 8;
    const keepWithHeader = pageNo === 1 && snag === input.snags[0];
    if (!keepWithHeader && y - opening < bottom) newPage();
    paint(detail, snag.snagSeq);
    y -= 4;

    let signatureImage: PDFImage | null = null;
    if (snag.signature?.signaturePng) {
      try {
        signatureImage = await doc.embedPng(snag.signature.signaturePng);
      } catch {
        signatureImage = null;
      }
    }

    visuals.forEach((visual, rowIndex) => {
      const last = rowIndex === visuals.length - 1;
      const hold = last ? reserve + tail : 0;
      const minVisual = visual.type === 'missing' ? 15 : 80 + 14 + 4;
      if (last && tail > 0 && y - (minVisual + tail) < bottom) newPage();
      if (visual.type === 'missing') {
        if (rowIndex > 0 && y - (15 + hold) < bottom) newPage();
        drawMissing(visual.text, snag.snagSeq);
        return;
      }
      drawPhotoRow(visual.items, snag.snagSeq, hold, rowIndex === 0);
    });

    if (snag.signature) {
      const lines = expanded(
        [
          { text: snag.signature.signerName, size: 12, weight: 'bold', mark: 'signature' },
          { text: snag.signature.signerRole, size: 12, weight: 'regular', mark: 'signature' },
          { text: snag.signature.signerCompany, size: 12, weight: 'regular', mark: 'signature' },
          { text: signedLine(snag.signature.signedAt), size: 12, weight: 'regular', mark: 'signature' },
        ],
        font,
        bold
      );
      const imageH = signatureImage ? Math.min(64, signatureImage.height) + 8 : 0;
      if (y - (linesHeight(lines) + imageH) < bottom) newPage();
      paint(lines, snag.snagSeq);
      if (signatureImage) {
        const scale = Math.min(220 / signatureImage.width, 64 / signatureImage.height, 1);
        const w = signatureImage.width * scale;
        const h = signatureImage.height * scale;
        page.drawImage(signatureImage, { x: MARGIN, y: y - h, width: w, height: h });
        y -= h + 8;
        mark('signature', { snagSeq: snag.snagSeq });
      }
    }
    y -= 10;
  }

  if (input.snags.length === 0) drawWrapped('No snags in this report.', 12, 'regular');

  if (options.signoff && outstanding) {
    const ensure = (height: number, onPage: () => void) => {
      if (y - height < bottom) {
        newPage();
        onPage();
      }
    };
    if (wholeFitsPage) {
      const blockH = outstandingHeadingH + rowsHeight(outstandingItems) + closingH;
      if (y - blockH < bottom) newPage();
      paint(outstanding.heading);
      for (const item of outstandingItems) paint(item);
      paintSignoffClose();
    } else {
      let used = linesHeight(continuedLines) + closingH;
      let keep = 0;
      for (let index = outstandingItems.length - 1; index >= 0; index -= 1) {
        const height = linesHeight(outstandingItems[index] ?? []);
        if (used + height > pageBudget) break;
        used += height;
        keep += 1;
      }
      if (keep < 1 && outstandingItems.length > 0) keep = 1;
      const prefix = outstandingItems.slice(0, outstandingItems.length - keep);
      const suffix = outstandingItems.slice(outstandingItems.length - keep);
      if (prefix.length > 0) {
        ensure(outstandingHeadingH, () => undefined);
        paint(outstanding.heading);
        for (const item of prefix) {
          ensure(linesHeight(item), () => {
            paint(continuedLines);
          });
          paint(item);
        }
      }
      const suffixHead = prefix.length > 0 ? continuedLines : outstanding.heading;
      const suffixH = linesHeight(suffixHead) + rowsHeight(suffix) + closingH;
      const headingAlreadyHere =
        prefix.length > 0 && trace.some((item) => item.page === pageNo && item.kind === 'outstanding');
      if (y - suffixH < bottom) {
        newPage();
        paint(suffixHead);
      } else if (!headingAlreadyHere) {
        paint(suffixHead);
      }
      for (const item of suffix) paint(item);
      paintSignoffClose();
    }
  }

  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((sheet, index) => {
    drawSheetFooter(sheet, input.reportId, input.companyName, index + 1, total, font);
    trace.push({ page: index + 1, kind: 'footer', baseline: 26 });
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

function signerBlock(input: SnagSignoffPdfInput, font: Face, bold: Face): LineSpec[] {
  return expanded(
    [
      { text: input.confirmationText, size: 11, weight: 'regular', mark: 'signature' },
      { text: input.signerName, size: 12, weight: 'bold', mark: 'signature' },
      { text: input.signerRole, size: 12, weight: 'regular', mark: 'signature' },
      { text: input.signerCompany, size: 12, weight: 'regular', mark: 'signature' },
      { text: signedLine(input.signedAt), size: 12, weight: 'regular', mark: 'signature' },
    ],
    font,
    bold
  );
}

function outstandingParts(
  input: SnagSignoffPdfInput,
  font: Face,
  bold: Face
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
    bold
  );
  const items = input.outstanding.map((row) =>
    expanded(
      [{ text: outstandingLine(row.snagSeq, row.note, row.levelArea), size: 11, weight: 'regular', mark: 'outstanding' }],
      font,
      bold
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
  let name = pdfText(company);
  const reference = pdfText(reportId);
  const tail = ` · ${reference} · Page ${page} of ${total}`;
  while (name.length > 4 && font.widthOfTextAtSize(name + tail, 9) > CONTENT_W) {
    name = name.slice(0, -2);
  }
  return `${name}${tail}`;
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
