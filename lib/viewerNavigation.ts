/**
 * The embedded PDF page may stay on the blank document or a data URL.
 * Anything else, including a signed storage URL, is a navigation we refuse.
 */
export function allowsEmbeddedViewerUrl(url: string): boolean {
  if (url === 'about:blank' || url.startsWith('about:blank#') || url.startsWith('about:blank?') || url.startsWith('about:blank/')) {
    return true;
  }
  return url.startsWith('data:');
}
