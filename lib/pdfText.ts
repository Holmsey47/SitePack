/**
 * Letters stay, including accents and a pound sign. Curly quotes, dashes, a euro
 * sign, and a tick become characters the embedded Noto subset can draw. A line
 * break becomes a space. Other controls, bidi overrides, and zero-width characters
 * are dropped.
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
    .replace(/[“”]/g, '"');
}
