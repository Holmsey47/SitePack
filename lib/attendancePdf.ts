import { preparedLine, weekRangeLabel, WEEK_DAYS, type WeekRow } from '@/lib/attendanceHours';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

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

function pdfText(value: string): string {
  return value
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x0A\x0D\x20-\x7E\u00B7]/g, '');
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
  doc.setTitle(`Hours ${pdfText(input.siteName)}`);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
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

  for (const row of input.rows) {
    const block = 16 + 14 + 14 + 16 + 10;
    ensure(block);
    draw(row.personName, 13, 'bold');
    draw(`${WEEK_DAYS[0]} ${row.days[0]}   ${WEEK_DAYS[1]} ${row.days[1]}   ${WEEK_DAYS[2]} ${row.days[2]}   ${WEEK_DAYS[3]} ${row.days[3]}`, 11, 'regular');
    draw(`${WEEK_DAYS[4]} ${row.days[4]}   ${WEEK_DAYS[5]} ${row.days[5]}   ${WEEK_DAYS[6]} ${row.days[6]}`, 11, 'regular');
    draw(`Total ${row.total}`, 12, 'bold');
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
