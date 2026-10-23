import { preparedLine, weekRangeLabel, WEEK_DAYS, type WeekRow } from '@/lib/attendanceHours';
import { anyNeedsUnicode, embedBodyFonts } from '@/lib/pdfFonts';
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

function pdfText(value: string, face?: { name: string }): string {
  const mapped = value
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"');
  if (face && !/Helvetica/i.test(face.name)) {
    return mapped.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }
  return mapped.replace(/[^\x0A\x0D\x20-\x7E\u00B7]/g, '');
}

function wrap(text: string, face: Face, size: number, max: number): string[] {
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

export function attendancePdfFilename(siteName: string, weekStart: string): string {
  const safe = pdfText(siteName).replace(/[^\w.\- ]+/g, '').trim() || 'Site';
  return `Hours ${safe} week ${weekStart}.pdf`;
}

export function attendanceFooter(siteName: string, companyName: string, page: number, total: number, font: Face): string {
  let site = pdfText(siteName, font);
  const company = pdfText(companyName, font);
  const tail = ` · ${company} · page ${page} of ${total}`;
  while (site.length > 4 && font.widthOfTextAtSize(site + tail, 9) > CONTENT_W) site = site.slice(0, -2);
  return `${site}${tail}`;
}

export async function buildAttendancePdf(input: AttendancePdfInput): Promise<{ bytes: Uint8Array; footers: string[] }> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Hours ${pdfText(input.siteName)}`);
  const unicode = anyNeedsUnicode([
    input.companyName,
    input.siteName,
    ...input.rows.flatMap((row) => [row.personName, ...row.shifts.flatMap((shift) => shift.flags)]),
  ]);
  const { regular: font, bold } = await embedBodyFonts(doc, unicode);
  let page = doc.addPage([PAGE_W, PAGE_H]);
  let y = TOP;

  function newPage() {
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = TOP;
  }

  function ensure(space: number) {
    if (y - space >= BOTTOM) return;
    newPage();
  }

  function draw(text: string, size: number, weight: 'bold' | 'regular') {
    const face = weight === 'bold' ? bold : font;
    for (const line of wrap(text, face, size, CONTENT_W)) {
      ensure(size + 4);
      page.drawText(line, { x: MARGIN, y: y - size, size, font: face, color: rgb(0.1, 0.1, 0.1) });
      y -= size + 4;
    }
  }

  draw('Weekly hours', 20, 'bold');
  draw(input.siteName, 12, 'bold');
  draw(input.companyName, 12, 'regular');
  draw(weekRangeLabel(input.weekStart), 12, 'regular');
  draw(preparedLine(input.generatedAt), 11, 'regular');
  y -= 8;

  if (input.rows.length === 0) draw('No hours this week.', 12, 'regular');

  const colW = CONTENT_W / 8;
  function drawColumns(cells: string[], size: number, weight: 'bold' | 'regular') {
    ensure(size + 6);
    const face = weight === 'bold' ? bold : font;
    cells.forEach((cell, index) => {
      page.drawText(pdfText(cell, face), {
        x: MARGIN + index * colW,
        y: y - size,
        size,
        font: face,
        color: rgb(0.1, 0.1, 0.1),
      });
    });
    y -= size + 6;
  }

  for (const row of input.rows) {
    const flags = [...new Set(row.shifts.flatMap((shift) => shift.flags))];
    ensure(18 + 16 + 16 + (flags.length > 0 ? 16 : 0) + 8);
    draw(row.personName, 13, 'bold');
    drawColumns([...WEEK_DAYS, 'Total'], 9, 'bold');
    drawColumns([...row.days, row.total], 10, 'regular');
    if (flags.length > 0) draw(flags.join(' · '), 11, 'bold');
    y -= 6;
  }

  const pages = doc.getPages();
  const total = pages.length;
  const footers = pages.map((_, index) => attendanceFooter(input.siteName, input.companyName, index + 1, total, font));
  pages.forEach((sheet, index) => {
    paintFooter(sheet, footers[index] ?? '', font);
  });
  return { bytes: await doc.save(), footers };
}

function paintFooter(sheet: PDFPage, label: string, font: Face) {
  sheet.drawText(label, { x: MARGIN, y: 28, size: 9, font, color: rgb(0.25, 0.25, 0.25) });
}
