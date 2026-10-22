import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { formatUkDateTime } from './format.ts';
import { snagJpegBytes, type SnagJpegName } from './snagJpegFixtures.ts';
import { strokesToPngDataUrl, dataUrlBytes } from './signaturePng.ts';
import { buildSnagPdf, signatureStaysWithSnag, snagPdfFilename, snagReportId, type SnagPdfSnag } from './snagPdf.ts';

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd8 || marker === 0xd9) {
      offset += 2;
      continue;
    }
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return {
        height: ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0),
        width: ((bytes[offset + 7] ?? 0) << 8) | (bytes[offset + 8] ?? 0),
      };
    }
    offset += 2 + length;
  }
  throw new Error('not a jpeg');
}

function decodedPdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const streams: string[] = [];
  let index = 0;
  while (index < raw.length) {
    const start = raw.indexOf('stream', index);
    if (start < 0) break;
    let dataStart = start + 'stream'.length;
    if (raw[dataStart] === 0x0d && raw[dataStart + 1] === 0x0a) dataStart += 2;
    else if (raw[dataStart] === 0x0a) dataStart += 1;
    const end = raw.indexOf('endstream', dataStart);
    if (end < 0) break;
    let dataEnd = end;
    if (raw[dataEnd - 1] === 0x0a) dataEnd -= 1;
    if (raw[dataEnd - 1] === 0x0d) dataEnd -= 1;
    try {
      streams.push(zlib.inflateSync(raw.subarray(dataStart, dataEnd)).toString('latin1'));
    } catch {
      // Image streams and already-plain streams are not text.
    }
    index = end + 'endstream'.length;
  }
  const source = streams.join('\n');
  const shown: string[] = [];
  for (const match of source.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const hex = match[1]?.replace(/\s/g, '') ?? '';
    if (hex.length < 2 || hex.length % 2 !== 0) continue;
    shown.push(Buffer.from(hex, 'hex').toString('latin1'));
  }
  return shown.join('');
}

test('snag JPEG fixtures are real photographs, not colour squares', () => {
  for (const name of ['beforeWide', 'afterWide', 'beforeTall', 'bars'] as SnagJpegName[]) {
    const bytes = snagJpegBytes(name);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
    assert.equal(Buffer.from(bytes).includes('GPS'), false);
    const size = jpegSize(bytes);
    const longSide = Math.max(size.width, size.height);
    const shortSide = Math.min(size.width, size.height);
    assert.ok(longSide >= 1280, `${name} long side ${longSide}`);
    assert.ok(shortSide >= 720, `${name} short side ${shortSide}`);
    assert.ok(bytes.byteLength > 10_000, `${name} is only ${bytes.byteLength} bytes`);
  }
});

test('a report of 10 snags keeps photos whole, signs with UK time, and numbers every page', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  assert.equal(formatUkDateTime(when), '22 Oct 2026, 2:05pm');
  assert.equal(snagReportId(when), 'SR-22Oct2026');
  const signature = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }, { x: 160, y: 30 }]]));
  assert.ok(signature);
  const wide = snagJpegBytes('beforeWide');
  const after = snagJpegBytes('afterWide');
  const tall = snagJpegBytes('beforeTall');
  const bars = snagJpegBytes('bars');
  const notes = [
    'Bead missing at the window reveal',
    'Skirting not fixed in the hall',
    'Joint tape lifting by the door',
    'Socket box proud of the board',
    'Crack above the lintel',
    'Door will not close on the latch',
    'Hole in the plaster by the riser',
    'Stain on the ceiling',
    'Board joint open in the corridor',
    'Tidy the offcuts by the stairs',
  ];
  const snags: SnagPdfSnag[] = notes.map((note, index) => {
    const seq = index + 1;
    const signed = seq >= 7;
    const fixed = seq >= 5;
    const photos =
      seq === 1
        ? [{ bytes: tall, contentType: 'image/jpeg', caption: 'Before' }]
        : seq === 8
          ? [
              { bytes: wide, contentType: 'image/jpeg', caption: 'Before' },
              { bytes: after, contentType: 'image/jpeg', caption: 'After' },
            ]
          : [{ bytes: index % 2 === 0 ? bars : wide, contentType: 'image/jpeg', caption: 'Before' }];
    if (fixed && seq !== 1 && seq !== 8) {
      photos.push({ bytes: after, contentType: 'image/jpeg', caption: 'After' });
    }
    return {
      snagSeq: seq,
      note,
      levelArea: ['Ground', 'First', 'Second'][index % 3] ?? 'Ground',
      tradeLabel: index % 2 === 0 ? 'dryliner' : 'labourer',
      status: signed ? 'Signed off' : fixed ? 'Fixed' : 'Open',
      raisedByName: 'Amy Keane',
      raisedAt: '2026-10-22T08:15:00.000Z',
      fixedAt: fixed ? '2026-10-22T11:40:00.000Z' : null,
      photos,
      signature: signed
        ? {
            signerName: seq === 8 ? 'Dave Moran' : 'Priya Shah',
            signerRole: seq === 8 ? 'Site manager' : 'Contracts manager',
            signerCompany: seq === 8 ? 'Northbuild' : 'Ashfield Finishes',
            signedAt: when,
            signaturePng: seq === 8 ? signature : null,
          }
        : null,
    };
  });

  const { bytes, trace } = await buildSnagPdf({
    reportId: snagReportId(when),
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    filterLabel: 'All snags',
    snags,
  });
  assert.equal(snagPdfFilename('SR-22Oct2026'), 'Snag report SR-22Oct2026.pdf');
  assert.equal(String.fromCharCode(...bytes.subarray(0, 4)), '%PDF');
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
  const text = decodedPdfText(bytes);
  assert.match(text, /Dave Moran/);
  assert.match(text, /Priya Shah/);
  assert.match(text, /Contracts manager/);
  assert.match(text, /Northbuild/);
  assert.match(text, /Ashfield Finishes/);
  assert.match(text, /Signed 22 Oct 2026, 2:05pm/);
  assert.match(text, /SR-22Oct2026/);
  assert.match(text, /page 1 of /);
  const footerPages = new Set(trace.filter((item) => item.kind === 'footer').map((item) => item.page));
  assert.equal(footerPages.size, doc.getPageCount());
  for (let page = 1; page <= doc.getPageCount(); page += 1) assert.ok(footerPages.has(page));
  const photoCount = snags.reduce((sum, snag) => sum + snag.photos.length, 0);
  assert.equal(trace.filter((item) => item.kind === 'photo').length, photoCount);
  const full = trace.find((item) => item.kind === 'photo' && item.snagSeq === 1 && !item.pair);
  assert.ok(full?.width && full.width > 450);
  const pair = trace.filter((item) => item.kind === 'photo' && item.snagSeq === 8);
  assert.equal(pair.length, 2);
  assert.ok(pair.every((item) => item.pair && item.width && item.width < 280 && item.width > 180));
  assert.equal(pair[0]?.page, pair[1]?.page);
  for (const seq of [7, 8, 9, 10]) assert.equal(signatureStaysWithSnag(trace, seq), true);
});
