import { preparedLine, weekRangeLabel, type WeekRow } from '@/lib/attendanceHours';
import { pdfText } from '@/lib/snagPdf';
import { SNAG_PDF_SANS, SNAG_PDF_SANS_BOLD } from '@/lib/snagPdfFonts';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = 800;
const BOTTOM = 56;

export type AttendancePdfInput = {
  companyName: string;
  siteName: string;
  weekStart: string;
  generatedAt: string;
  rows: WeekRow[];
};

type Face = PDFFont;

function pdfFontBytes(encoded: string): Uint8Array {
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
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
    } else current = next;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [''];
}

export function attendancePdfFilename(siteName: string, weekStart: string): string {
  const safe = pdfText(siteName).replace(/[^\w.\- ]+/g, '').trim() || 'Site';
  return `Hours ${safe} week ${weekStart}.pdf`;
}

export function attendanceFooter(siteName: string, companyName: string, page: number, total: number, font: Face): string {
  let site = pdfText(siteName);
  const company = pdfText(companyName);
  const tail = ` · ${company} · page ${page} of ${total}`;
  while (site.length > 4 && font.widthOfTextAtSize(site + tail, 9) > CONTENT_W) site = site.slice(0, -2);
  return `${site}${tail}`;
}

export async function buildAttendancePdf(input: AttendancePdfInput): Promise<{ bytes: Uint8Array; footers: string[] }> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Hours ${pdfText(input.siteName)}`);
  const font = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS), { subset: true });
  const bold = await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS_BOLD), { subset: true });
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = TOP;

  function faceFor(weight: 'bold' | 'regular'): Face {
    return weight === 'bold' ? bold : font;
  }

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = TOP;
  }

  function ensure(space: number) {
    if (y - space >= BOTTOM) return;
    newPage();
  }

  async function draw(text: string, size: number, weight: 'bold' | 'regular') {
    const value = pdfText(text);
    const face = faceFor(weight);
    for (const line of wrap(value, face, size, CONTENT_W)) {
      ensure(size + 4);
      page.drawText(line, { x: MARGIN, y: y - size, size, font: face, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    }
  }

  await draw('Weekly hours', 20, 'bold');
  await draw(input.siteName, 12, 'bold');
  await draw(input.companyName, 12, 'regular');
  await draw(weekRangeLabel(input.weekStart), 12, 'regular');
  await draw(preparedLine(input.generatedAt), 11, 'regular');
  y -= 8;

  if (input.rows.length === 0) await draw('No hours this week.', 12, 'regular');

  for (const row of input.rows) {
    const flags = [...new Set(row.shifts.flatMap((shift) => shift.flags))];
    await draw(row.personName, 13, 'bold');
    for (const line of row.dayLines) await draw(line, 11, 'regular');
    await draw(row.totalLine, 12, 'bold');
    for (const shift of row.shifts) {
      if (shift.correction) await draw(shift.correction, 11, 'bold');
      if (shift.reason) await draw(shift.reason, 11, 'regular');
    }
    if (flags.length > 0) await draw(flags.join(' · '), 11, 'bold');
    y -= 6;
  }

  const pages = doc.getPages();
  const total = pages.length;
  const footerFace = faceFor('regular');
  const footers = pages.map((_, index) => attendanceFooter(input.siteName, input.companyName, index + 1, total, footerFace));
  pages.forEach((sheet, index) => {
    paintFooter(sheet, footers[index] ?? '', footerFace);
  });
  return { bytes: await doc.save(), footers };
}

function paintFooter(sheet: PDFPage, label: string, font: Face) {
  sheet.drawText(label, { x: MARGIN, y: 28, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
}
