import { formatPounds, variationPdfFilename } from '@/data/variations';
import { formatUkDateTime } from '@/lib/format';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export { variationPdfFilename };

export type VariationPdfInput = {
  voSeq: number;
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

export async function buildVariationPdf(input: VariationPdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(variationPdfFilename(input.voSeq).replace(/\.pdf$/, ''));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([595, 842]);
  let y = 800;
  const left = 40;
  const width = 515;

  function need(space: number) {
    if (y - space >= 40) return;
    page = doc.addPage([595, 842]);
    y = 800;
  }

  function line(text: string, size: number, weight: 'bold' | 'regular' = 'regular') {
    const face = weight === 'bold' ? bold : font;
    const chunks = wrap(text, face, size, width);
    for (const chunk of chunks) {
      need(size + 6);
      page.drawText(chunk, { x: left, y: y - size, size, font: face, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 6;
    }
  }

  function wrap(text: string, face: { widthOfTextAtSize: (value: string, size: number) => number }, size: number, max: number) {
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

  line(`Variation VO-${input.voSeq}`, 20, 'bold');
  y -= 4;
  line(input.companyName, 12, 'bold');
  line(input.siteName, 12);
  line(formatUkDateTime(input.whenIso) || 'Not signed', 12);
  y -= 8;
  line(input.title, 16, 'bold');
  if (input.description) line(input.description, 12);
  if (input.levelArea) line(`Level or area: ${input.levelArea}`, 12);
  if (input.quantityText) line(`Quantity or hours: ${input.quantityText}`, 12);
  if (input.valuePence != null) line(`Amount: ${formatPounds(input.valuePence)}`, 12);
  y -= 8;

  for (const photo of input.photos) {
    try {
      const image = photo.contentType.includes('png')
        ? await doc.embedPng(photo.bytes)
        : await doc.embedJpg(photo.bytes);
      const scale = Math.min(width / image.width, 240 / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      need(h + 12);
      page.drawImage(image, { x: left, y: y - h, width: w, height: h });
      y -= h + 12;
    } catch {
      line('Photo could not be embedded.', 11);
    }
  }

  if (input.signaturePng) {
    line('Signed', 14, 'bold');
    if (input.signerName) line(input.signerName, 12);
    if (input.signerRoleCompany) line(input.signerRoleCompany, 12);
    try {
      const image = await doc.embedPng(input.signaturePng);
      const scale = Math.min(220 / image.width, 100 / image.height, 1);
      const w = image.width * scale;
      const h = image.height * scale;
      need(h + 8);
      page.drawImage(image, { x: left, y: y - h, width: w, height: h });
      y -= h + 8;
    } catch {
      line('Signature could not be embedded.', 11);
    }
  }

  return doc.save();
}
