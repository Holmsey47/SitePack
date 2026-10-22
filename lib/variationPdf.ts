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

  type HeaderItem =
    | { kind: 'text'; text: string; size: number; face: Face; height: number }
    | { kind: 'gap'; height: number };
  const header: HeaderItem[] = [];

  function line(text: string, size: number, weight: 'bold' | 'regular' = 'regular') {
    const face = weight === 'bold' ? bold : font;
    for (const chunk of wrap(text, face, size, CONTENT_WIDTH)) {
      header.push({ kind: 'text', text: chunk, size, face, height: size + 6 });
    }
  }

  function drawLine(text: string, size: number, weight: 'bold' | 'regular' = 'regular') {
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
  header.push({ kind: 'gap', height: 4 });
  line(input.companyName, 12, 'bold');
  line(input.siteName, 12);
  line(formatUkDateTime(input.whenIso) || 'Not signed', 12);
  if (input.versionNo > 1) line(`Version ${input.versionNo}`, 12, 'bold');
  header.push({ kind: 'gap', height: 8 });
  line(input.title, 16, 'bold');
  if (input.description) line(input.description, 12);
  if (input.levelArea) line(`Level or area: ${input.levelArea}`, 12);
  if (input.quantityText) line(`Quantity or hours: ${input.quantityText}`, 12);
  if (input.valuePence != null) line(`Amount: ${formatPounds(input.valuePence)}`, 12);
  header.push({ kind: 'gap', height: 8 });

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

  const signature = await layoutSignature();
  const glueHeader = embedded.length === 0 && signature != null;
  drawHeader(glueHeader);
  let signaturePlaced = glueHeader;

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
      const message = `Photo ${index + 1} of ${total} could not be embedded.`;
      const last = index + 1 >= total;
      if (last && signature && !signaturePlaced) {
        const drop = 17;
        if (y - (drop + signature.height) < BOTTOM && y !== TOP) freshPage();
        page.drawText(message, { x: LEFT, y: y - 11, size: 11, font, color: rgb(0.1, 0.1, 0.1) });
        y -= drop;
        y = signature.draw(page, y);
        signaturePlaced = true;
      } else {
        drawLine(message, 11);
      }
      index += 1;
      continue;
    }

    if (pair && next) {
      let leftSize = fitPhoto(current.width, current.height, half);
      let rightSize = fitPhoto(next.width, next.height, half);
      let rowHeight = Math.max(leftSize.height, rightSize.height);
      const last = index + 2 >= total;
      if (last && signature && !signaturePlaced) {
        rowHeight = fitWithSignature(rowHeight, (maxVisual) => {
          if (rowHeight <= maxVisual) return rowHeight;
          const scale = maxVisual / rowHeight;
          leftSize = { width: leftSize.width * scale, height: leftSize.height * scale };
          rightSize = { width: rightSize.width * scale, height: rightSize.height * scale };
          return maxVisual;
        });
      } else {
        ensure(rowHeight + CAPTION + GAP);
      }
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
      if (last && signature && !signaturePlaced) {
        y = signature.draw(page, y);
        signaturePlaced = true;
      }
      index += 2;
      continue;
    }

    let size = fitPhoto(current.width, current.height, CONTENT_WIDTH);
    const last = index + 1 >= total;
    if (last && signature && !signaturePlaced) {
      const height = fitWithSignature(size.height, (maxVisual) => {
        if (size.height <= maxVisual) return size.height;
        size = { width: (current.width / current.height) * maxVisual, height: maxVisual };
        return maxVisual;
      });
      size = { width: size.width, height };
    } else {
      ensure(size.height + CAPTION + GAP);
    }
    const top = y;
    page.drawImage(current, { x: LEFT, y: top - size.height, width: size.width, height: size.height });
    const baseline = top - size.height - 12;
    caption(`Photo ${index + 1} of ${total}`, LEFT, baseline);
    y = baseline - GAP;
    if (last && signature && !signaturePlaced) {
      y = signature.draw(page, y);
      signaturePlaced = true;
    }
    index += 1;
  }

  function drawHeader(glueSignature: boolean) {
    let lastText = -1;
    for (let i = 0; i < header.length; i += 1) {
      if (header[i]?.kind === 'text') lastText = i;
    }
    for (let i = 0; i < header.length; i += 1) {
      const item = header[i];
      if (!item) continue;
      if (glueSignature && signature && i === lastText) {
        let tail = signature.height;
        for (let j = i; j < header.length; j += 1) tail += header[j]?.height ?? 0;
        if (y - tail < BOTTOM && y !== TOP) freshPage();
      }
      if (item.kind === 'gap') {
        y -= item.height;
        continue;
      }
      if (!(glueSignature && signature && i === lastText) && y - item.height < BOTTOM && y !== TOP) freshPage();
      page.drawText(item.text, {
        x: LEFT,
        y: y - item.size,
        size: item.size,
        font: item.face,
        color: rgb(0.1, 0.1, 0.1),
      });
      y -= item.height;
    }
    if (glueSignature && signature) y = signature.draw(page, y);
  }

  /** Keep the signature on the last photo's page. Shrink that photo when both will not fit. */
  function fitWithSignature(visual: number, rescale: (maxVisual: number) => number): number {
    if (!signature) return visual;
    const drop = (height: number) => height + 12 + GAP;
    let height = visual;
    if (y - (drop(height) + signature.height) < BOTTOM && y !== TOP) freshPage();
    if (y - (drop(height) + signature.height) < BOTTOM) {
      const maxVisual = Math.max(1, y - BOTTOM - signature.height - 12 - GAP);
      height = rescale(maxVisual);
    }
    return height;
  }

  async function layoutSignature(): Promise<{ height: number; draw: (target: PDFPage, top: number) => number } | null> {
    if (!input.signaturePng) return null;
    let image: PDFImage | null = null;
    try {
      image = await doc.embedPng(input.signaturePng);
    } catch {
      image = null;
    }
    const scale = image ? Math.min(200 / image.width, 72 / image.height, 1) : 0;
    const imageWidth = image ? image.width * scale : 0;
    const imageHeight = image ? image.height * scale : 0;
    const textX = image ? LEFT + imageWidth + GAP : LEFT;
    const textMax = Math.max(40, LEFT + CONTENT_WIDTH - textX);
    const rows: Array<{ text: string; face: Face; size: number }> = [];
    const pushWrapped = (text: string | null, face: Face, size: number) => {
      const trimmed = text?.trim() ?? '';
      if (!trimmed) return;
      for (const chunk of wrap(trimmed, face, size, textMax)) rows.push({ text: chunk, face, size });
    };
    pushWrapped(input.signerName, bold, 12);
    pushWrapped(input.signerRoleCompany, font, 12);
    const signed = formatUkDateTime(input.whenIso);
    if (signed) pushWrapped(`Signed ${signed}`, bold, 12);
    if (!image && rows.length === 0) {
      rows.push({ text: 'Signature could not be embedded.', face: font, size: 11 });
    }
    const lineGap = 4;
    const textHeight = rows.reduce((sum, row) => sum + row.size + lineGap, 0);
    const lead = 4;
    const block = Math.max(imageHeight, textHeight);
    const height = lead + block + GAP;
    return {
      height,
      draw(target, top) {
        const origin = top - lead;
        if (image) {
          target.drawImage(image, { x: LEFT, y: origin - imageHeight, width: imageWidth, height: imageHeight });
        }
        let cursor = origin;
        for (const row of rows) {
          target.drawText(row.text, {
            x: textX,
            y: cursor - row.size,
            size: row.size,
            font: row.face,
            color: rgb(0.1, 0.1, 0.1),
          });
          cursor -= row.size + lineGap;
        }
        return top - height;
      },
    };
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
