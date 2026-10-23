import { pdfFontBytes, SNAG_PDF_SANS, SNAG_PDF_SANS_BOLD } from '@/lib/snagPdfFonts';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';

/** Windows-1252 extras. Helvetica can draw these. Ł (U+0141) is not in this set. */
const WINANSI_EXTRA = new Set([
  0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018,
  0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178,
]);

/** True when Helvetica's WinAnsi set cannot draw the text. Ł is outside that set. */
export function textNeedsUnicode(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x0a || code === 0x0d) continue;
    if (code >= 0x20 && code <= 0x7e) continue;
    if (code >= 0xa0 && code <= 0xff) continue;
    if (WINANSI_EXTRA.has(code)) continue;
    return true;
  }
  return false;
}

export function anyNeedsUnicode(values: Array<string | null | undefined>): boolean {
  return values.some((value) => typeof value === 'string' && textNeedsUnicode(value));
}

/**
 * Helvetica for ordinary reports, so existing page layout stays put.
 * A name such as Łukasz needs the Noto subset. pdf-lib can embed that
 * only through @pdf-lib/fontkit, which is why that package is a dependency.
 */
export async function embedBodyFonts(doc: PDFDocument, unicode: boolean): Promise<{ regular: PDFFont; bold: PDFFont }> {
  if (!unicode) {
    return {
      regular: await doc.embedFont(StandardFonts.Helvetica),
      bold: await doc.embedFont(StandardFonts.HelveticaBold),
    };
  }
  const fontkit = (await import('@pdf-lib/fontkit')).default;
  doc.registerFontkit(fontkit);
  return {
    regular: await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS), { subset: true }),
    bold: await doc.embedFont(pdfFontBytes(SNAG_PDF_SANS_BOLD), { subset: true }),
  };
}
