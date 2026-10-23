/**
 * Letters stay, including accents and a pound sign. Punctuation the embedded
 * Noto subset cannot draw is rewritten to ASCII. A line break becomes a space.
 * Other controls, bidi overrides, and zero-width characters are dropped.
 * Glyphs that are still undrawable are replaced later by pdfGlyphs.
 */
export function pdfText(value: string): string {
  return value
    .normalize('NFC')
    .replace(/[\t\n\v\f\r\u0085\u2028\u2029]+/g, ' ')
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/€/g, 'EUR')
    .replace(/[✓✔]/g, 'yes')
    .replace(/[–—]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[•\u2010\u2212]/g, '-')
    .replace(/\u2039/g, '<')
    .replace(/\u203A/g, '>')
    .replace(/[‚′]/g, "'")
    .replace(/[„″]/g, '"')
    .replace(/[\u2009\u202F]/g, ' ')
    .replace(/™/g, 'TM');
}

export const PDF_UNSHOWN_NOTE =
  "Some characters can't be shown in this PDF and appear as ?. The signed record in SitePack shows the full text.";

export type PdfFace = { getCharacterSet(): number[] };

export type PdfGlyphs = {
  /** pdfText, then one '?' per code point neither face can draw. */
  show: (value: string) => string;
  unshown: () => boolean;
  /** Horizontal ellipsis when both faces can draw it, otherwise three dots. */
  ellipsis: string;
};

export function pdfEllipsis(drawable: ReadonlySet<number>): string {
  return drawable.has(0x2026) ? '\u2026' : '...';
}

/** Intersection of the two embedded faces. Walks code points, so a surrogate pair stays one character. */
export function pdfGlyphs(regular: PdfFace, bold: PdfFace): PdfGlyphs {
  const boldChars = new Set(bold.getCharacterSet());
  const drawable = new Set<number>();
  for (const code of regular.getCharacterSet()) {
    if (boldChars.has(code)) drawable.add(code);
  }
  const state = { missing: false };
  function show(value: string): string {
    let out = '';
    for (const char of pdfText(value)) {
      const code = char.codePointAt(0) ?? 0;
      if (drawable.has(code)) out += char;
      else {
        out += '?';
        state.missing = true;
      }
    }
    return out;
  }
  return { show, unshown: () => state.missing, ellipsis: pdfEllipsis(drawable) };
}

type PdfMeasureFont = { widthOfTextAtSize(text: string, size: number): number };

function codePointCount(value: string): number {
  return Array.from(value).length;
}

function dropLastCodePoint(value: string): string {
  const chars = Array.from(value);
  chars.pop();
  return chars.join('');
}

/**
 * Shorten the site and the company, longer name first, until the line fits.
 * A name that was cut gains an ellipsis. The tail (report ref, page) stays whole.
 * Width is measured on the same substituted text that will be drawn.
 */
export function fitPdfNames(
  siteName: string,
  companyName: string,
  tail: string,
  font: PdfMeasureFont,
  maxWidth: number,
  size: number,
  show: (value: string) => string,
  ellipsis: string
): string {
  let site = show(siteName).trim() || 'Site';
  let company = show(companyName).trim() || 'Company';
  const fullSite = site;
  const fullCompany = company;
  const line = () => {
    const siteLabel = site === fullSite ? site : `${site}${ellipsis}`;
    const companyLabel = company === fullCompany ? company : `${company}${ellipsis}`;
    return `${siteLabel} · ${companyLabel}${tail}`;
  };
  while (font.widthOfTextAtSize(line(), size) > maxWidth && (codePointCount(site) > 1 || codePointCount(company) > 1)) {
    if (codePointCount(company) >= codePointCount(site) && codePointCount(company) > 1) company = dropLastCodePoint(company);
    else site = dropLastCodePoint(site);
  }
  return line();
}
