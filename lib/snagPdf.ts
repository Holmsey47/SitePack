import { snagNumber } from '@/data/snags';
import { formatUkDateTime } from '@/lib/format';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage } from 'pdf-lib';

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 800;
const BOTTOM = 48;
const GAP = 8;

export type SnagPdfPhoto = {
  bytes: Uint8Array;
  contentType: string;
  caption: string;
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

export type SnagPdfTrace = {
  page: number;
  kind: 'header' | 'heading' | 'photo' | 'signature' | 'footer';
  snagSeq?: number;
  width?: number;
  pair?: boolean;
};

type Face = PDFFont;

function pdfText(value: string): string {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x0A\x0D\x20-\x7E\u00A3\u00B7]/g, '');
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

export function snagPdfFilename(reportId: string): string {
  return `Snag report ${reportId}.pdf`;
}

function signedLine(iso: string): string {
  return `Signed ${formatUkDateTime(iso)}`;
}

function signatureHeight(hasPng: boolean): number {
  return 6 * 16 + (hasPng ? 80 : 0) + 16;
}

export async function buildSnagPdf(input: SnagPdfInput): Promise<{ bytes: Uint8Array; trace: SnagPdfTrace[] }> {
  const doc = await PDFDocument.create();
  doc.setTitle(input.reportId);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const trace: SnagPdfTrace[] = [];
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = TOP;
  let pageNo = 1;

  function mark(kind: SnagPdfTrace['kind'], extra: Partial<SnagPdfTrace> = {}) {
    trace.push({ page: pageNo, kind, ...extra });
  }

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = TOP;
    pageNo += 1;
  }

  function ensure(space: number) {
    if (y - space >= BOTTOM) return;
    newPage();
  }

  function drawLines(text: string, size: number, weight: 'bold' | 'regular', snagSeq?: number, kind?: SnagPdfTrace['kind']) {
    const face = weight === 'bold' ? bold : font;
    const lines = wrap(text, face, size, CONTENT_W);
    for (const line of lines) {
      ensure(size + 4);
      page.drawText(line, { x: MARGIN, y: y - size, size, font: face, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
      if (kind) mark(kind, { snagSeq });
    }
  }

  async function embed(photo: SnagPdfPhoto): Promise<PDFImage | null> {
    try {
      if (photo.contentType.includes('png')) return await doc.embedPng(photo.bytes);
      return await doc.embedJpg(photo.bytes);
    } catch {
      return null;
    }
  }

  type Placed = { image: PDFImage; caption: string; landscape: boolean };

  function rowHeight(items: Placed[], width: number): number {
    return Math.max(...items.map((item) => (item.image.height / item.image.width) * width));
  }

  function drawRow(items: Placed[], snagSeq: number, reserve: number) {
    const pair = items.length === 2;
    const gap = pair ? GAP : 0;
    let width = pair ? (CONTENT_W - gap) / 2 : CONTENT_W;
    let height = rowHeight(items, width);
    const captionH = 14;
    const maxH = TOP - BOTTOM - captionH - reserve - 4;
    if (height > maxH) {
      const scale = maxH / height;
      height = maxH;
      width = width * scale;
    }
    const block = height + captionH + reserve + 4;
    if (y - block < BOTTOM) newPage();
    const top = y;
    items.forEach((item, index) => {
      const itemH = (item.image.height / item.image.width) * width;
      const x = MARGIN + index * ((CONTENT_W - gap) / 2 + gap);
      const imageTop = top - (height - itemH);
      page.drawImage(item.image, { x, y: imageTop - itemH, width, height: itemH });
      const caption = pdfText(item.caption);
      page.drawText(caption, { x, y: imageTop - itemH - 12, size: 9, font: bold, color: rgb(0.15, 0.15, 0.15) });
      mark('photo', { snagSeq, width, pair });
    });
    y = top - height - captionH - 4;
  }

  function drawSignature(snag: SnagPdfSnag, image: PDFImage | null) {
    const signature = snag.signature;
    if (!signature) return;
    drawLines(signature.signerName, 12, 'bold', snag.snagSeq, 'signature');
    drawLines(signature.signerRole, 12, 'regular', snag.snagSeq, 'signature');
    drawLines(signature.signerCompany, 12, 'regular', snag.snagSeq, 'signature');
    drawLines(signedLine(signature.signedAt), 12, 'regular', snag.snagSeq, 'signature');
    if (image) {
      const scale = Math.min(220 / image.width, 64 / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      ensure(h + 8);
      page.drawImage(image, { x: MARGIN, y: y - h, width: w, height: h });
      y -= h + 8;
      mark('signature', { snagSeq: snag.snagSeq });
    }
    y -= 6;
  }

  drawLines('Snag report', 20, 'bold', undefined, 'header');
  y -= 2;
  drawLines(input.companyName, 12, 'bold', undefined, 'header');
  drawLines(input.siteName, 12, 'regular', undefined, 'header');
  drawLines(formatUkDateTime(input.generatedAt), 12, 'regular', undefined, 'header');
  drawLines(input.filterLabel, 12, 'regular', undefined, 'header');
  y -= 8;

  for (const snag of input.snags) {
    const heading = `${snagNumber(snag.snagSeq)} · ${snag.tradeLabel} · ${snag.status}`;
    const reserve = snag.signature ? signatureHeight(Boolean(snag.signature.signaturePng)) : 0;
    if (snag.photos.length === 0 && reserve > 0) {
      const headingH = 18 + 16 * 3;
      if (y - (headingH + reserve) < BOTTOM) newPage();
    }
    drawLines(heading, 14, 'bold', snag.snagSeq, 'heading');
    drawLines(snag.note, 11, 'regular');
    if (snag.levelArea) drawLines(`Level or area: ${snag.levelArea}`, 11, 'regular');
    drawLines(`Raised by ${snag.raisedByName} · ${formatUkDateTime(snag.raisedAt)}`, 11, 'regular');
    if (snag.fixedAt) drawLines(`Fixed ${formatUkDateTime(snag.fixedAt)}`, 11, 'regular');
    y -= 4;

    const placed: Placed[] = [];
    for (const photo of snag.photos) {
      const image = await embed(photo);
      if (!image) {
        drawLines(`${photo.caption} could not be embedded.`, 11, 'regular');
        continue;
      }
      placed.push({ image, caption: photo.caption, landscape: image.width >= image.height });
    }

    const rows: Placed[][] = [];
    let index = 0;
    while (index < placed.length) {
      const current = placed[index];
      const next = placed[index + 1];
      if (current && next && current.landscape && next.landscape) {
        rows.push([current, next]);
        index += 2;
      } else if (current) {
        rows.push([current]);
        index += 1;
      } else {
        index += 1;
      }
    }

    let signatureImage: PDFImage | null = null;
    if (snag.signature?.signaturePng) {
      try {
        signatureImage = await doc.embedPng(snag.signature.signaturePng);
      } catch {
        signatureImage = null;
      }
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
      const last = rowIndex === rows.length - 1;
      drawRow(rows[rowIndex] ?? [], snag.snagSeq, last ? reserve : 0);
    }

    if (snag.signature) {
      if (rows.length === 0 && y - reserve < BOTTOM) newPage();
      drawSignature(snag, signatureImage);
    }
    y -= 10;
  }

  if (input.snags.length === 0) {
    drawLines('No snags in this report.', 12, 'regular');
  }

  const pages = doc.getPages();
  const total = pages.length;
  pages.forEach((sheet, index) => {
    const label = footerLabel(input.reportId, input.companyName, index + 1, total, font);
    sheet.drawText(label, { x: MARGIN, y: 26, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
    trace.push({ page: index + 1, kind: 'footer' });
  });

  return { bytes: await doc.save(), trace };
}

function footerLabel(reportId: string, company: string, page: number, total: number, font: Face): string {
  let name = pdfText(company);
  const tail = ` · page ${page} of ${total}`;
  const head = `${pdfText(reportId)} · `;
  while (name.length > 4 && font.widthOfTextAtSize(head + name + tail, 9) > CONTENT_W) {
    name = name.slice(0, -2);
  }
  return `${head}${name}${tail}`;
}

export function signatureStaysWithSnag(trace: SnagPdfTrace[], snagSeq: number): boolean {
  const pages = trace.filter((item) => item.kind === 'signature' && item.snagSeq === snagSeq).map((item) => item.page);
  if (pages.length === 0) return false;
  return pages.every((page) =>
    trace.some((item) => item.page === page && item.snagSeq === snagSeq && (item.kind === 'photo' || item.kind === 'heading'))
  );
}
