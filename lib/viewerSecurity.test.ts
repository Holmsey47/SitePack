import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { sheetViewHtml } from './sheetHtml.ts';
import { pdfViewHtml } from './pdfViewHtml.ts';
import { allowsEmbeddedViewerUrl } from './viewerNavigation.ts';

test('pdf and sheet HTML disable pdf.js eval', () => {
  const pdf = pdfViewHtml('QQ==', 'var pdfjsLib = {};', 'var pdfjsWorker = {};');
  const sheet = sheetViewHtml('QQ==', 'var pdfjsLib = {};', 'var pdfjsWorker = {};');
  assert.match(pdf, /getDocument\(\{ data: bytes\([^)]+\), isEvalSupported: false \}\)/);
  assert.match(sheet, /getDocument\(\{ data: bytes\([^)]+\), isEvalSupported: false \}\)/);
  assert.equal(pdf.includes('isEvalSupported: true'), false);
  assert.equal(sheet.includes('isEvalSupported: true'), false);
});

test('pdf and drawing iframes use sandbox allow-scripts and not allow-same-origin', () => {
  const pdf = fs.readFileSync('components/pdf-frame.web.tsx', 'utf8');
  const drawing = fs.readFileSync('components/drawing-frame.web.tsx', 'utf8');
  for (const source of [pdf, drawing]) {
    assert.match(source, /sandbox: 'allow-scripts'/);
    assert.equal(source.includes('allow-same-origin'), false);
    assert.match(source, /srcDoc: html/);
  }
  assert.match(pdf, /event\.source !== frameRef\.current\.contentWindow/);
});

test('native viewers allow about:blank and data URLs only', () => {
  assert.equal(allowsEmbeddedViewerUrl('about:blank'), true);
  assert.equal(allowsEmbeddedViewerUrl('about:blank#page'), true);
  assert.equal(allowsEmbeddedViewerUrl('data:text/html,hi'), true);
  assert.equal(allowsEmbeddedViewerUrl('https://example.supabase.co/storage/v1/object/sign/doc'), false);
  assert.equal(allowsEmbeddedViewerUrl('https://evil.example/about:blank'), false);
  assert.equal(allowsEmbeddedViewerUrl('file:///data/user/0/uk.sitepack.app/cache/doc.pdf'), false);
  assert.equal(allowsEmbeddedViewerUrl(''), false);
  const pdf = fs.readFileSync('components/pdf-frame.tsx', 'utf8');
  const drawing = fs.readFileSync('components/drawing-frame.tsx', 'utf8');
  assert.match(pdf, /onShouldStartLoadWithRequest=\{\(request\) => allowsEmbeddedViewerUrl\(request\.url\)\}/);
  assert.match(drawing, /onShouldStartLoadWithRequest=\{\(request\) => allowsEmbeddedViewerUrl\(request\.url\)\}/);
});
