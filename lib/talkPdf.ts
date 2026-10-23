import type { TalkDelivery, TalkKind } from '@/lib/talkMeaning';
import { formatUkDateTime } from '@/lib/format';
import { pdfFontBytes, SNAG_PDF_SANS, SNAG_PDF_SANS_BOLD } from '@/lib/snagPdfFonts';
import { dataUrlBytes } from '@/lib/signaturePng';
import fontkit from '@pdf-lib/fontkit';
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
  personRef?: string;
  nameChanged?: boolean;
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
  talkId: string;
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
    personRef?: string;
    nameChanged?: boolean;
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
  /** Presenter sign-off stays on the same page as the last attendee row. */
  signoff?: boolean;
  withPrevious?: boolean;
};

export function talkPdfFilename(siteName: string, title: string): string {
  const site = pdfText(siteName).replace(/[^\w.\- ]+/g, '').trim() || 'Site';
  const name = pdfText(title).replace(/[^\w.\- ]+/g, '').trim() || 'Talk';
  return `Register ${site} ${name}.pdf`;
}

/** Report ref is the talk id plus the version, so two talks with the same title and day stay distinct. */
export function talkReportId(talkId: string, versionNo: number): string {
  const id = talkId.trim();
  if (!id) throw new Error('invalid_input');
  return `TR-${id}-v${versionNo}`;
}

export function talkFooter(
  siteName: string,
  companyName: string,
  reportId: string,
  page: number,
  total: number,
  font: PDFFont
): string {
  let site = pdfText(siteName);
  const company = pdfText(companyName);
  const reference = pdfText(reportId);
  const tail = ` · ${company} · ${reference} · Page ${page} of ${total}`;
  while (site.length > 4 && font.widthOfTextAtSize(site + tail, 9) > CONTENT_W) site = site.slice(0, -2);
  return `${site}${tail}`;
}

/** Keep letters, including Ł and ü. A dash the name font does not draw becomes a hyphen. */
export function pdfText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[–—]/g, '-')
    .replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029\u202a-\u202e\u2066-\u2069\u200e\u200f]/g, ' ');
}

function wrap(text: string, face: PDFFont, size: number, max: number): string[] {
  const words = pdfText(text).split(/\s+/).filter(Boolean);
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

type Packed = { kind: BlockKind; height: number; signoff?: boolean; withPrevious?: boolean };

/** Packs blocks so a row stays on one page, a heading is never left alone, and the presenter sign-off keeps an attendee row. */
export function packBlocks<T extends Packed>(blocks: T[], limit: number): T[][] {
  const pages: T[][] = [];
  let current: T[] = [];
  let used = 0;

  function flush() {
    if (current.length === 0) return;
    pages.push(current);
    current = [];
    used = 0;
  }

  function pullLastRow() {
    const pulled: T[] = [];
    const last = current[current.length - 1];
    if (last?.kind !== 'row') return pulled;
    pulled.unshift(current.pop() as T);
    used -= last.height;
    const tail = current[current.length - 1];
    if (tail?.kind === 'heading' && !current.some((item) => item.kind === 'row')) {
      pulled.unshift(current.pop() as T);
      used -= tail.height;
    }
    return pulled;
  }

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (!block) continue;
    if (block.withPrevious) {
      const follow = blocks[index + 1];
      const need = block.height + (follow && follow.kind !== 'heading' ? follow.height : 0);
      if (current.some((item) => item.kind === 'row') && used + need > limit) {
        const pulled = pullLastRow();
        flush();
        current = pulled;
        used = pulled.reduce((sum, item) => sum + item.height, 0);
      }
    }
    if (block.kind === 'heading') {
      const follow = blocks[index + 1];
      if (!follow || follow.kind === 'heading') continue;
      if (!block.withPrevious && current.length > 0 && used + block.height + follow.height > limit) flush();
    } else if (!block.signoff && current.length > 0 && used + block.height > limit) {
      flush();
    }
    current.push(block);
    used += block.height;
  }
  flush();
  return pages.filter((page) => page.some((block) => block.kind === 'intro' || block.kind === 'row'));
}

function textBlock(
  kind: BlockKind,
  rows: Array<[string, number, boolean]>,
  flags: { signoff?: boolean; withPrevious?: boolean } = {}
): Block {
  const lines = rows.map(([text, size, bold]) => ({ text, size, bold }));
  return { kind, lines, png: null, height: measure(lines, null), ...flags };
}

function personLines(person: RegisterPdfPerson, versionNo?: number): Array<[string, number, boolean]> {
  const label = person.personRef ? `${person.name} · ${person.personRef}` : person.name;
  const rows: Array<[string, number, boolean]> = [[label, 13, true]];
  if (versionNo) rows.push([`Signed version ${versionNo}`, 11, true]);
  if (person.nameChanged) rows.push(['name changed since signing', 11, true]);
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
      const rows = personLines(person, input.versionNo);
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
    blocks.push(textBlock('heading', [['Presenter', 14, true]], { signoff: true, withPrevious: true }));
    const presenterLabel = presenter.personRef ? `${presenter.name} · ${presenter.personRef}` : presenter.name;
    const rows: Array<[string, number, boolean]> = [
      [presenterLabel, 13, true],
      [`Signed version ${input.versionNo}`, 11, true],
      ...(presenter.nameChanged ? [['name changed since signing', 11, true] as [string, number, boolean]] : []),
      [formatUkDateTime(presenter.receivedAt), 11, false],
      [presenter.meaning, 11, false],
    ];
    const lines: Line[] = [];
    for (const [text, size, weight] of rows) {
      const face = weight ? bold : font;
      for (const line of wrap(text, face, size, CONTENT_W)) lines.push({ text: line, size, bold: weight });
    }
    const png = presenter.signaturePng ? dataUrlBytes(presenter.signaturePng) : null;
    blocks.push({ kind: 'row', lines, png, height: measure(lines, png), signoff: true });
  }

  return blocks;
}

export async function buildTalkPdf(input: RegisterPdfInput): Promise<{ bytes: Uint8Array; footers: string[]; pages: string[][] }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const reportId = talkReportId(input.talkId, input.versionNo);
  doc.setTitle(`Register ${reportId}`);
  const font = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS), { subset: true });
  const bold = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS_BOLD), { subset: true });
  const blocks = buildBlocks(input, font, bold);
  const packed = packBlocks(blocks, CONTENT_H);
  const groups = packed.length > 0 ? packed : [blocks.filter((block) => block.kind === 'intro')];
  const drawn: PDFPage[] = [];
  const pageLines: string[][] = [];
  let lines: string[] = [];
  let y = TOP;
  let sheet = doc.addPage([PAGE_W, PAGE_H]);
  drawn.push(sheet);

  function nextPage(): PDFPage {
    if (lines.length === 0 && y === TOP) return sheet;
    pageLines.push(lines);
    lines = [];
    sheet = doc.addPage([PAGE_W, PAGE_H]);
    drawn.push(sheet);
    y = TOP;
    const continued = pdfText('Register (continued)');
    sheet.drawText(continued, { x: MARGIN, y: y - 14, size: 14, font: bold, color: rgb(0.1, 0.1, 0.1) });
    lines.push(continued);
    y -= 18;
    return sheet;
  }

  /** A line or image that does not fit continues on the next page. Nothing is dropped or drawn over the footer. */
  function ensure(drop: number) {
    if (y - drop < BOTTOM && y < TOP) nextPage();
  }

  for (const group of groups) {
    if (lines.length > 0) nextPage();
    for (const block of group) {
      for (const line of block.lines) {
        ensure(lineHeight(line));
        const face = line.bold ? bold : font;
        const text = pdfText(line.text);
        const page = sheet;
        lines.push(text);
        page.drawText(text, { x: MARGIN, y: y - line.size, size: line.size, font: face, color: rgb(0.1, 0.1, 0.1) });
        y -= lineHeight(line);
      }
      if (block.png) {
        try {
          const image = await doc.embedPng(block.png);
          const width = Math.min(180, image.width);
          let height = Math.min(64, (image.height / Math.max(image.width, 1)) * width);
          if (y - height < BOTTOM && y < TOP) nextPage();
          if (y - height < BOTTOM) height = Math.max(1, y - BOTTOM);
          sheet.drawImage(image, { x: MARGIN, y: y - height, width, height });
          y -= height + 8;
        } catch {
          y -= 8;
        }
      }
      if (y - 8 >= BOTTOM) y -= 8;
    }
  }
  pageLines.push(lines);

  const footers = drawn.map((_, index) => talkFooter(input.siteName, input.companyName, reportId, index + 1, drawn.length, font));
  drawn.forEach((sheet, index) => {
    const footer = footers[index] ?? '';
    pageLines[index]?.push(footer);
    sheet.drawText(footer, { x: MARGIN, y: 28, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
  });
  return { bytes: await doc.save(), footers, pages: pageLines };
}
