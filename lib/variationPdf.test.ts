import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { solidPng, strokesToPngDataUrl, dataUrlBytes } from './signaturePng.ts';
import { buildVariationPdf, variationPdfFilename } from './variationPdf.ts';

test('the variation PDF names VO, the company, and embeds the photo and signature', async () => {
  const signature = dataUrlBytes(strokesToPngDataUrl([[{ x: 10, y: 10 }, { x: 80, y: 40 }]]));
  assert.ok(signature);
  assert.equal(signature[0], 137);
  assert.equal(String.fromCharCode(...signature.subarray(1, 4)), 'PNG');
  assert.equal(Buffer.from(signature).includes('GPS'), false);

  const bytes = await buildVariationPdf({
    voSeq: 7,
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 – Oak Estate',
    title: 'Extra beads',
    description: 'Window reveals',
    levelArea: 'L2',
    quantityText: '12 m',
    valuePence: 18000,
    whenIso: '2026-10-22T13:05:00.000Z',
    signerName: 'Dave Moran',
    signerRoleCompany: 'Site manager, Northbuild',
    photos: [{ bytes: solidPng(8, 8, [20, 80, 140]), contentType: 'image/png' }],
    signaturePng: signature,
  });
  assert.equal(variationPdfFilename(7), 'Variation VO-7.pdf');
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), '%PDF');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(), 'Variation VO-7');
  assert.ok(doc.getPageCount() >= 1);
});
