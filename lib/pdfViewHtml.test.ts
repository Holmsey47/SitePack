import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { makePagedPdf } from './pdf.ts';
import { parsePdfMessage, pdfViewHtml } from './pdfViewHtml.ts';

test('the viewer page reports a page and never a remote address', () => {
  const html = pdfViewHtml('QQ==', 'var pdfjsLib = {};', 'var pdfjsWorker = {};');
  assert.equal(html.includes('supabase.co'), false);
  assert.equal(html.includes('http://'), false);
  assert.equal(html.includes('https://'), false);
  assert.match(html, /postMessage/);
  assert.match(html, /sitepack-pdf/);
  const parsed = parsePdfMessage(JSON.stringify({ source: 'sitepack-pdf', page: 2, total: 5 }));
  assert.equal(parsed && 'page' in parsed ? parsed.page : 0, 2);
  assert.equal(parsed && 'total' in parsed ? parsed.total : 0, 5);
  assert.deepEqual(parsePdfMessage(JSON.stringify({ source: 'sitepack-pdf', error: true })), { error: true });
  assert.equal(parsePdfMessage(JSON.stringify({ source: 'other', page: 1, total: 1 })), null);
  assert.equal(parsePdfMessage('https://example.supabase.co/object'), null);
  assert.equal(parsePdfMessage(JSON.stringify({ source: 'sitepack-pdf', page: 0, total: 2 })), null);
});

test('Open PDF stays inside the app for every signed-url browser open', () => {
  const detail = fs.readFileSync('app/(app)/sites/[siteId]/documents/[documentId].tsx', 'utf8');
  assert.match(detail, /Open PDF/);
  assert.match(detail, /\/pdf\?documentId=/);
  assert.equal(detail.includes('openBrowserAsync'), false);
  assert.equal(detail.includes('expo-web-browser'), false);
  const appFiles = walk('app').filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'));
  const hits = appFiles.filter((file) => fs.readFileSync(file, 'utf8').includes('openBrowserAsync'));
  assert.deepEqual(hits, []);
  const viewer = fs.readFileSync('app/(app)/pdf.tsx', 'utf8');
  assert.match(viewer, /Share \/ Save/);
  assert.match(viewer, /Try again/);
  assert.match(viewer, /pdf-pages/);
  assert.equal(viewer.includes('supabase.co'), false);
  assert.equal(viewer.includes('openBrowserAsync'), false);
  const frame = fs.readFileSync('components/pdf-frame.tsx', 'utf8');
  assert.match(frame, /source=\{\{ html, baseUrl: 'about:blank' \}\}/);
  assert.match(frame, /setSupportMultipleWindows=\{false\}/);
  assert.match(frame, /supabase\\.co/);
  const web = fs.readFileSync('components/pdf-frame.web.tsx', 'utf8');
  assert.match(web, /srcDoc: html/);
  assert.equal(web.includes('window.open'), false);
  const share = fs.readFileSync('lib/sharePdf.ts', 'utf8');
  assert.equal(share.includes('supabase.co'), false);
  assert.equal(share.includes('window.open'), false);
  assert.match(share, /createObjectURL/);
  const bytes = makePagedPdf(['Site induction', 'Page 2']);
  const text = new TextDecoder().decode(bytes);
  assert.equal(text.startsWith('%PDF-'), true);
  assert.equal((text.match(/\/Type \/Page\b/g) ?? []).length, 2);
});

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(full));
    else found.push(full);
  }
  return found;
}
