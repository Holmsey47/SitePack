import { formatPounds, variationPdfFilename } from '@/data/variations';
import { formatUkDateTime } from '@/lib/format';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

export { variationPdfFilename };

export type VariationPdfInput = {
  voSeq: number;
  /** Current version. Version 1 is omitted from the page. */
  versionNo: number;
  companyName: string;
  siteName: string;
  title: string;
  description: string;
  levelArea: string | null;
  quantityText: string | null;
  valuePence: number | null;
  whenIso: string | null;
  signerName: string | null;
  signerRoleCompany: string | null;
  photos: Array<{ bytes: Uint8Array; contentType: string }>;
  signaturePng: Uint8Array | null;
};

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT = 40;
const CONTENT_WIDTH = 515;
const TOP = 800;
/** Content stays above the footer. */
const BOTTOM = 48;
const GAP = 8;
const CAPTION = 14;
const MAX_IMAGE_HEIGHT = TOP - BOTTOM - CAPTION - GAP - 4;

type Face = PDFFont;

function wrap(text: string, face: Face, size: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
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

/** Fit inside the box. Width is the full content width or half of it. Height follows the pixels. */
export function fitPhoto(pixelWidth: number, pixelHeight: number, boxWidth: number): { width: number; height: number } {
  const safeWidth = Math.max(1, pixelWidth);
  const safeHeight = Math.max(1, pixelHeight);
  let width = boxWidth;
  let height = (safeHeight / safeWidth) * boxWidth;
  if (height > MAX_IMAGE_HEIGHT) {
    height = MAX_IMAGE_HEIGHT;
    width = (safeWidth / safeHeight) * height;
  }
  return { width, height };
}

/** Two landscape photos share a row. A portrait, or a single leftover photo, takes the full width. */
export function photoRowKind(pixels: Array<{ width: number; height: number }>, index: number): 'pair' | 'full' {
  const current = pixels[index];
  const next = pixels[index + 1];
  if (!current || !next) return 'full';
  if (current.width >= current.height && next.width >= next.height) return 'pair';
  return 'full';
}

export async function buildVariationPdf(input: VariationPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(variationPdfFilename(input.voSeq).replace(/\.pdf$/, ''));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = TOP;
  const half = (CONTENT_WIDTH - GAP) / 2;

  function freshPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = TOP;
  }

  function ensure(space: number) {
    if (y - space >= BOTTOM) return;
    if (y !== TOP) freshPage();
  }

  function line(text: string, size: number, weight: 'bold' | 'regular' = 'regular') {
    const face = weight === 'bold' ? bold : font;
    for (const chunk of wrap(text, face, size, CONTENT_WIDTH)) {
      ensure(size + 6);
      page.drawText(chunk, { x: LEFT, y: y - size, size, font: face, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 6;
    }
  }

  function caption(text: string, x: number, baseline: number) {
    page.drawText(text, { x, y: baseline, size: 10, font, color: rgb(0.1, 0.1, 0.1) });
  }

  line(`Variation VO-${input.voSeq}`, 20, 'bold');
  y -= 4;
  line(input.companyName, 12, 'bold');
  line(input.siteName, 12);
  line(formatUkDateTime(input.whenIso) || 'Not signed', 12);
  if (input.versionNo > 1) line(`Version ${input.versionNo}`, 12, 'bold');
  y -= 8;
  line(input.title, 16, 'bold');
  if (input.description) line(input.description, 12);
  if (input.levelArea) line(`Level or area: ${input.levelArea}`, 12);
  if (input.quantityText) line(`Quantity or hours: ${input.quantityText}`, 12);
  if (input.valuePence != null) line(`Amount: ${formatPounds(input.valuePence)}`, 12);
  y -= 8;

  const embedded: Array<PDFImage | null> = [];
  for (const photo of input.photos) {
    try {
      embedded.push(
        photo.contentType.includes('png') ? await doc.embedPng(photo.bytes) : await doc.embedJpg(photo.bytes)
      );
    } catch {
      embedded.push(null);
    }
  }

  const total = embedded.length;
  let index = 0;
  while (index < total) {
    const current = embedded[index];
    const next = embedded[index + 1];
    const pair =
      current &&
      next &&
      photoRowKind(
        embedded.map((image) => ({ width: image?.width ?? 0, height: image?.height ?? 1 })),
        index
      ) === 'pair';

    if (!current) {
      line(`Photo ${index + 1} of ${total} could not be embedded.`, 11);
      index += 1;
      continue;
    }

    if (pair && next) {
      const leftSize = fitPhoto(current.width, current.height, half);
      const rightSize = fitPhoto(next.width, next.height, half);
      const rowHeight = Math.max(leftSize.height, rightSize.height);
      const block = rowHeight + CAPTION + GAP;
      ensure(block);
      const top = y;
      page.drawImage(current, { x: LEFT, y: top - leftSize.height, width: leftSize.width, height: leftSize.height });
      page.drawImage(next, {
        x: LEFT + half + GAP,
        y: top - rightSize.height,
        width: rightSize.width,
        height: rightSize.height,
      });
      const baseline = top - rowHeight - 12;
      caption(`Photo ${index + 1} of ${total}`, LEFT, baseline);
      caption(`Photo ${index + 2} of ${total}`, LEFT + half + GAP, baseline);
      y = baseline - GAP;
      index += 2;
      continue;
    }

    const size = fitPhoto(current.width, current.height, CONTENT_WIDTH);
    const block = size.height + CAPTION + GAP;
    ensure(block);
    const top = y;
    page.drawImage(current, { x: LEFT, y: top - size.height, width: size.width, height: size.height });
    const baseline = top - size.height - 12;
    caption(`Photo ${index + 1} of ${total}`, LEFT, baseline);
    y = baseline - GAP;
    index += 1;
  }

  if (input.signaturePng) {
    y -= 4;
    if (input.signerName) line(input.signerName, 12, 'bold');
    if (input.signerRoleCompany) line(input.signerRoleCompany, 12);
    const signed = formatUkDateTime(input.whenIso);
    if (signed) line(`Signed ${signed}`, 12, 'bold');
    try {
      const image = await doc.embedPng(input.signaturePng);
      const scale = Math.min(220 / image.width, 80 / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      ensure(height + GAP);
      page.drawImage(image, { x: LEFT, y: y - height, width, height });
      y -= height + GAP;
    } catch {
      line('Signature could not be embedded.', 11);
    }
  }

  const pages = doc.getPages();
  const pageCount = pages.length;
  pages.forEach((item: PDFPage, pageIndex: number) => {
    const label = `VO-${input.voSeq} · ${input.companyName} · page ${pageIndex + 1} of ${pageCount}`;
    let size = 9;
    while (size > 6 && font.widthOfTextAtSize(label, size) > CONTENT_WIDTH) size -= 0.5;
    item.drawText(label, { x: LEFT, y: 22, size, font, color: rgb(0.35, 0.35, 0.35) });
  });

  return doc.save();
}
