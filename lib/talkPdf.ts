import type { TalkDelivery, TalkKind } from '@/lib/talkMeaning';
import { formatUkDateTime } from '@/lib/format';
import { dataUrlBytes } from '@/lib/signaturePng';
import { anyNeedsUnicode, embedBodyFonts } from '@/lib/pdfFonts';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 800;
const BOTTOM = 72;
const CONTENT_H = TOP - BOTTOM;

export type RegisterPdfPerson = {
  name: string;
  hasQuestion: boolean;
  question: string | null;
  explained: boolean;
  interpreter: boolean;
};

export type RegisterPdfSigned = RegisterPdfPerson & {
  receivedAt: string;
  meaning: string;
  signaturePng: string | null;
  sharedDevice: boolean;
};

export type RegisterPdfInput = {
  companyName: string;
  siteName: string;
  title: string;
  kind: TalkKind;
  delivery: TalkDelivery;
  versionNo: number;
  presenterName: string;
  presenterRole: string;
  presentedAt: string;
  notSigned: RegisterPdfPerson[];
  signed: RegisterPdfSigned[];
  presenterSignature: {
    name: string;
    receivedAt: string;
    meaning: string;
    signaturePng: string | null;
  } | null;
};

type Line = { text: string; size: number; bold: boolean };
type BlockKind = 'intro' | 'heading' | 'row';

type Block = {
  kind: BlockKind;
  lines: Line[];
  png: Uint8Array | null;
  height: number;
};

export function talkPdfFilename(siteName: string, title: string): string {
  const site = pdfText(siteName).replace(/[^\w.\- ]+/g, '').trim() || 'Site';
  const name = pdfText(title).replace(/[^\w.\- ]+/g, '').trim() || 'Talk';
  return `Register ${site} ${name}.pdf`;
}

export function talkFooter(siteName: string, companyName: string, page: number, total: number, font: PDFFont): string {
  let site = pdfText(siteName, font);
  const company = pdfText(companyName, font);
  const tail = ` · ${company} · page ${page} of ${total}`;
  while (site.length > 4 && font.widthOfTextAtSize(site + tail, 9) > CONTENT_W) site = site.slice(0, -2);
  return `${site}${tail}`;
}

function pdfText(value: string, face?: { name: string }): string {
  const mapped = value
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
  if (face && !/Helvetica/i.test(face.name)) {
    return mapped.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  return mapped.replace(/[^\x0A\x0D\x20-\x7E]/g, '');
}

function wrap(text: string, face: PDFFont, size: number, max: number): string[] {
  const words = pdfText(text, face).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words.length > 0 ? words : ['']) {
    const next = current ? `${current} ${word}` : word;
    if (face.widthOfTextAtSize(next, size) > max && current) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

function lineHeight(line: Line): number {
  return line.size + 4;
}

function measure(lines: Line[], png: Uint8Array | null): number {
  const text = lines.reduce((sum, line) => sum + lineHeight(line), 0);
  return text + (png ? 74 : 0) + 8;
}

/** Packs blocks so a row stays on one page and a heading is never left alone. */
export function packBlocks<T extends { kind: BlockKind; height: number }>(blocks: T[], limit: number): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = 0;

  function flush() {
    if (current.length === 0) return;
    pages.push(current);
    current = [];
    used = 0;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.kind === 'heading') {
      const follow = blocks[index + 1];
      if (!follow || follow.kind === 'heading') continue;
      if (current.length > 0 && used + block.height + follow.height > limit) flush();
    } else if (current.length > 0 && used + block.height > limit) {
      flush();
    }
    current.push(block);
    used += block.height;
  }
  flush();
  return pages.filter((page) => page.some((block) => block.kind === 'intro' || block.kind === 'row'));
}

function textBlock(kind: BlockKind, rows: Array<[string, number, boolean]>): Block {
  const lines = rows.map(([text, size, bold]) => ({ text, size, bold }));
  return { kind, lines, png: null, height: measure(lines, null) };
}

function personLines(person: RegisterPdfPerson): Array<[string, number, boolean]> {
  const rows: Array<[string, number, boolean]> = [[person.name, 13, true]];
  if (person.hasQuestion) rows.push(['Has a question', 11, true]);
  if (person.question) rows.push([person.question, 11, false]);
  if (person.explained) rows.push(['Explained verbally', 11, false]);
  if (person.interpreter) rows.push(['Interpreter used', 11, false]);
  return rows;
}

function buildBlocks(input: RegisterPdfInput, font: PDFFont, bold: PDFFont): Block[] {
  const blocks: Block[] = [];
  const introLines: Line[] = [];
  const introRows: Array<[string, number, boolean]> = [
    [input.kind === 'induction' ? 'Induction register' : 'Toolbox talk register', 18, true],
    [input.title, 14, true],
    [input.siteName, 12, true],
    [input.companyName, 12, false],
    [`Version ${input.versionNo}`, 12, true],
    [`Presenter ${input.presenterName}, ${input.presenterRole}`, 12, false],
    [formatUkDateTime(input.presentedAt), 12, false],
    [input.delivery === 'in_person' ? 'Given in person' : 'Read on the phone', 12, false],
  ];
  for (const [text, size, weight] of introRows) {
    const face = weight ? bold : font;
    for (const line of wrap(text, face, size, CONTENT_W)) introLines.push({ text: line, size, bold: weight });
  }
  blocks.push({ kind: 'intro', lines: introLines, png: null, height: measure(introLines, null) });

  if (input.notSigned.length > 0) {
    blocks.push(textBlock('heading', [[`Not signed yet (${input.notSigned.length})`, 14, true]]));
    for (const person of input.notSigned) {
      const lines: Line[] = [];
      for (const [text, size, weight] of personLines(person)) {
        const face = weight ? bold : font;
        for (const line of wrap(text, face, size, CONTENT_W)) lines.push({ text: line, size, bold: weight });
      }
      blocks.push({ kind: 'row', lines, png: null, height: measure(lines, null) });
    }
  }

  if (input.signed.length > 0) {
    blocks.push(textBlock('heading', [[`Signed (${input.signed.length})`, 14, true]]));
    for (const person of input.signed) {
      const rows = personLines(person);
      rows.push([formatUkDateTime(person.receivedAt), 11, false]);
      rows.push([person.meaning, 11, false]);
      if (person.sharedDevice) rows.push(['Signed on a shared device', 11, true]);
      const lines: Line[] = [];
      for (const [text, size, weight] of rows) {
        const face = weight ? bold : font;
        for (const line of wrap(text, face, size, CONTENT_W)) lines.push({ text: line, size, bold: weight });
      }
      const png = person.signaturePng ? dataUrlBytes(person.signaturePng) : null;
      blocks.push({ kind: 'row', lines, png, height: measure(lines, png) });
    }
  }

  if (input.presenterSignature) {
    const presenter = input.presenterSignature;
    blocks.push(textBlock('heading', [['Presenter', 14, true]]));
    const rows: Array<[string, number, boolean]> = [
      [presenter.name, 13, true],
      [formatUkDateTime(presenter.receivedAt), 11, false],
      [presenter.meaning, 11, false],
    ];
    const lines: Line[] = [];
    for (const [text, size, weight] of rows) {
      const face = weight ? bold : font;
      for (const line of wrap(text, face, size, CONTENT_W)) lines.push({ text: line, size, bold: weight });
    }
    const png = presenter.signaturePng ? dataUrlBytes(presenter.signaturePng) : null;
    blocks.push({ kind: 'row', lines, png, height: measure(lines, png) });
  }

  return blocks;
}

export async function buildTalkPdf(input: RegisterPdfInput): Promise<{ bytes: Uint8Array; footers: string[] }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Register ${pdfText(input.title)}`);
  const unicode = anyNeedsUnicode([
    input.companyName,
    input.siteName,
    input.title,
    input.presenterName,
    input.presenterRole,
    ...input.notSigned.flatMap((row) => [row.name, row.question]),
    ...input.signed.flatMap((row) => [row.name, row.question, row.meaning]),
  ]);
  const { regular: font, bold } = await embedBodyFonts(doc, unicode);
  const blocks = buildBlocks(input, font, bold);
  const packed = packBlocks(blocks, CONTENT_H);
  const pages = packed.length > 0 ? packed : [blocks.filter((block) => block.kind === 'intro')];
  const drawn: PDFPage[] = [];

  for (const group of pages) {
    const sheet = doc.addPage([PAGE_W, PAGE_H]);
    drawn.push(sheet);
    let y = TOP;
    for (const block of group) {
      for (const line of block.lines) {
        const face = line.bold ? bold : font;
        sheet.drawText(pdfText(line.text, face), { x: MARGIN, y: y - line.size, size: line.size, font: face, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight(line);
      }
      if (block.png) {
        try {
          const image = await doc.embedPng(block.png);
          const width = Math.min(180, image.width);
          const height = Math.min(64, (image.height / Math.max(image.width, 1)) * width);
          sheet.drawImage(image, { x: MARGIN, y: y - height, width, height });
          y -= height + 8;
        } catch {
          y -= 8;
        }
      }
      y -= 8;
    }
  }

  const footers = drawn.map((_, index) => talkFooter(input.siteName, input.companyName, index + 1, drawn.length, font));
  drawn.forEach((sheet, index) => {
    sheet.drawText(footers[index] ?? '', { x: MARGIN, y: 28, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
  });
  return { bytes: await doc.save(), footers };
}
