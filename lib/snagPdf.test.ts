import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { formatUkDateTime } from './format.ts';
import { snagJpegBytes, type SnagJpegName } from './snagJpegFixtures.ts';
import { strokesToPngDataUrl, dataUrlBytes } from './signaturePng.ts';
import {
  buildSnagPdf,
  buildSnagSignoffPdf,
  detailsStayWithHeading,
  headingStaysWithFirstPhoto,
  signatureStaysWithSnag,
  SNAG_PDF_SIGN_BOTTOM,
  snagPdfFilename,
  snagReportId,
  type SnagPdfSnag,
} from './snagPdf.ts';
import { snagConfirmation } from './snagWording.ts';

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
        ? [{ bytes: tall, contentType: 'image/jpeg', kind: 'before' as const }]
        : seq === 8
          ? [
              { bytes: wide, contentType: 'image/jpeg', kind: 'before' as const },
              { bytes: after, contentType: 'image/jpeg', kind: 'after' as const },
            ]
          : [{ bytes: index % 2 === 0 ? bars : wide, contentType: 'image/jpeg', kind: 'before' as const }];
    if (fixed && seq !== 1 && seq !== 8) {
      photos.push({ bytes: after, contentType: 'image/jpeg', kind: 'after' as const });
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
  assert.ok(doc.getPageCount() < 9, `report is ${doc.getPageCount()} pages`);
  const text = decodedPdfText(bytes);
  assert.match(text, /Dave Moran/);
  assert.match(text, /Priya Shah/);
  assert.match(text, /Contracts manager/);
  assert.match(text, /Northbuild/);
  assert.match(text, /Ashfield Finishes/);
  assert.match(text, /Signed 22 Oct 2026, 2:05pm/);
  assert.match(text, /SR-22Oct2026/);
  assert.match(text, /page 1 of /);
  assert.match(text, /Before · Photo 1 of 1/);
  assert.match(text, /Before · Photo 1 of 2/);
  assert.match(text, /After · Photo 2 of 2/);
  const footerPages = new Set(trace.filter((item) => item.kind === 'footer').map((item) => item.page));
  assert.equal(footerPages.size, doc.getPageCount());
  for (let page = 1; page <= doc.getPageCount(); page += 1) assert.ok(footerPages.has(page));
  const photoCount = snags.reduce((sum, snag) => sum + snag.photos.length, 0);
  assert.equal(trace.filter((item) => item.kind === 'photo').length, photoCount);
  const firstHeading = trace.find((item) => item.kind === 'heading' && item.snagSeq === 1);
  const firstPhoto = trace.find((item) => item.kind === 'photo' && item.snagSeq === 1 && !item.pair);
  assert.equal(firstHeading?.page, 1);
  assert.equal(firstPhoto?.page, 1);
  assert.ok(firstPhoto?.width && firstPhoto.width > 200);
  const full = trace.find((item) => item.kind === 'photo' && item.snagSeq === 2 && !item.pair);
  assert.ok(full?.width && full.width > 450);
  const pair = trace.filter((item) => item.kind === 'photo' && item.snagSeq === 8);
  assert.equal(pair.length, 2);
  assert.ok(pair.every((item) => item.pair && item.width && item.width < 280 && item.width > 180));
  assert.equal(pair[0]?.page, pair[1]?.page);
  for (const seq of [7, 8, 9, 10]) assert.equal(signatureStaysWithSnag(trace, seq), true);
  for (let seq = 1; seq <= 10; seq += 1) {
    assert.equal(headingStaysWithFirstPhoto(trace, seq), true, `S-${seq} heading left its first photo`);
    assert.equal(detailsStayWithHeading(trace, seq), true, `S-${seq} details split from the heading`);
  }
});

test('a photo that cannot be loaded is named in the report', async () => {
  const { bytes, trace } = await buildSnagPdf({
    reportId: 'SR-22Oct2026',
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: '2026-10-22T13:05:00.000Z',
    filterLabel: 'All snags',
    snags: [
      {
        snagSeq: 3,
        note: 'Joint tape lifting by the door',
        levelArea: 'First',
        tradeLabel: 'dryliner',
        status: 'Open',
        raisedByName: 'Amy Keane',
        raisedAt: '2026-10-22T08:15:00.000Z',
        fixedAt: null,
        photos: [
          { bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' },
          { bytes: null, contentType: 'image/jpeg', kind: 'after' },
        ],
        signature: null,
      },
    ],
  });
  const text = decodedPdfText(bytes);
  assert.match(text, /Photo 2 of 2 \(After\) could not be loaded/);
  assert.match(text, /Before · Photo 1 of 2/);
  assert.equal(headingStaysWithFirstPhoto(trace, 3), true);
  assert.equal(trace.some((item) => item.kind === 'missing' && item.snagSeq === 3), true);
});

test('contractor and internal sign-off PDFs print the stored sentence, outstanding snags, and the disclaimer', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const stored = snagConfirmation('Northbuild', 'contractor');
  const internal = snagConfirmation('Ashfield Finishes', 'internal');
  const covered: SnagPdfSnag = {
    snagSeq: 5,
    note: 'Crack above the lintel',
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    status: 'Fixed',
    raisedByName: 'Amy Keane',
    raisedAt: '2026-10-22T08:15:00.000Z',
    fixedAt: '2026-10-22T11:40:00.000Z',
    photos: [{ bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' }],
    signature: null,
  };
  const outstanding = [{ snagSeq: 2, note: 'Skirting not fixed in the hall', levelArea: 'Ground' }];
  const contractor = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: stored,
    signerName: 'Dave Moran',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng: dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]])),
    covered: [covered],
    outstanding,
  });
  const contractorText = decodedPdfText(contractor.bytes);
  assert.match(contractorText, /Snag sign-off/);
  assert.equal(contractorText.includes('Internal check'), false);
  assert.match(contractorText, /I confirm the snags listed above have been put right to my satisfaction, on behalf of/);
  assert.match(contractorText, /Northbuild\./);
  assert.match(contractorText, /Outstanding \(not signed off\): 1/);
  assert.match(contractorText, /S-2 · Skirting not fixed in the hall · Ground/);
  assert.match(contractorText, /This sign-off records the snags listed only\. It isn't a completion certificate\./);
  assert.match(contractorText, /page 1 of /);
  assert.equal(contractor.trace.filter((item) => item.kind === 'footer').length, (await PDFDocument.load(contractor.bytes)).getPageCount());

  const internalPdf = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'internal',
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: internal,
    signerName: 'Priya Shah',
    signerRole: 'Contracts manager',
    signerCompany: 'Ashfield Finishes',
    signedAt: when,
    signaturePng: null,
    covered: [covered],
    outstanding: [],
  });
  const internalText = decodedPdfText(internalPdf.bytes);
  assert.match(internalText, /Internal check/);
  assert.match(internalText, /I've checked the snags listed above and I'm satisfied they've been put right\./);
  assert.match(internalText, /This is an internal/);
  assert.match(internalText, /Ashfield Finishes, not sign-off by the main contractor\./);
  assert.match(internalText, /not sign-off by the main contractor\./);
  assert.match(internalText, /No snags are outstanding\./);
  assert.match(internalText, /This sign-off records the snags listed only\. It isn't a completion certificate\./);
});

function signerSharesLastPhoto(trace: Array<{ page: number; kind: string; snagSeq?: number }>, lastSeq: number): boolean {
  const signerPage = trace.find((item) => item.kind === 'signature' && item.snagSeq === undefined)?.page;
  const photoPage = trace.find((item) => item.kind === 'photo' && item.snagSeq === lastSeq)?.page;
  return signerPage !== undefined && signerPage === photoPage;
}

test('the signer block stays on the same page as the last photo', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const signaturePng = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]]));
  assert.ok(signaturePng);
  const snag = (seq: number, bytes: Uint8Array, note: string): SnagPdfSnag => ({
    snagSeq: seq,
    note,
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    status: 'Fixed',
    raisedByName: 'Amy Keane',
    raisedAt: '2026-10-22T08:15:00.000Z',
    fixedAt: '2026-10-22T11:40:00.000Z',
    photos: [{ bytes, contentType: 'image/jpeg', kind: 'before' }],
    signature: null,
  });
  const base = {
    reportId: 'SO-22Oct2026',
    kind: 'contractor' as const,
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('Northbuild', 'contractor'),
    signerName: 'José Marín',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng,
  };
  const onePage = await buildSnagSignoffPdf({
    ...base,
    covered: [snag(1, snagJpegBytes('beforeWide'), 'Bead missing at the window reveal')],
    outstanding: [{ snagSeq: 2, note: 'Skirting not fixed in the hall', levelArea: 'Ground' }],
  });
  assert.equal((await PDFDocument.load(onePage.bytes)).getPageCount(), 1, 'a 1-snag sign-off is one page');
  assert.match(decodedPdfText(onePage.bytes), /José Marín/);
  const oneTrace = onePage.trace;
  const oneSign = oneTrace.filter((item) => item.kind === 'signature' && item.page === 1 && item.baseline !== undefined);
  const oneOut = oneTrace.filter((item) => item.kind === 'outstanding' && item.baseline !== undefined);
  const oneNote = oneTrace.filter((item) => item.kind === 'disclaimer' && item.baseline !== undefined);
  assert.ok(oneOut.length > 0 && oneSign.length > 0 && oneNote.length > 0);
  assert.ok(Math.min(...oneOut.map((item) => item.baseline ?? 0)) > Math.max(...oneSign.map((item) => item.baseline ?? 0)));
  assert.ok(Math.min(...oneNote.map((item) => item.baseline ?? 0)) < Math.min(...oneSign.map((item) => item.baseline ?? 0)));
  const short = await buildSnagSignoffPdf({
    ...base,
    covered: [snag(1, snagJpegBytes('beforeWide'), 'Bead missing at the window reveal')],
    outstanding: [],
  });
  assert.equal(signerSharesLastPhoto(short.trace, 1), true);
  assert.equal(short.trace.find((item) => item.kind === 'photo' && item.snagSeq === 1)?.page, 1);
  assert.equal((await PDFDocument.load(short.bytes)).getPageCount(), 1);
  assert.match(decodedPdfText(short.bytes), /No snags are outstanding/);
  assert.match(decodedPdfText(short.bytes), /listed above/);

  const tall = await buildSnagSignoffPdf({
    ...base,
    covered: [snag(1, snagJpegBytes('beforeTall'), 'Bead missing at the window reveal')],
    outstanding: [],
  });
  assert.equal(tall.trace.find((item) => item.kind === 'header')?.page, 1);
  assert.equal(tall.trace.find((item) => item.kind === 'heading' && item.snagSeq === 1)?.page, 1);
  assert.equal(tall.trace.find((item) => item.kind === 'photo' && item.snagSeq === 1)?.page, 1);
  assert.equal(signerSharesLastPhoto(tall.trace, 1), true);

  const notes = [
    'Bead missing at the window reveal',
    'Skirting not fixed in the hall',
    'Joint tape lifting by the door',
    'Socket box proud of the board',
    'Crack above the lintel',
    'Door will not close on the latch',
  ];
  const many = await buildSnagSignoffPdf({
    ...base,
    covered: notes.map((note, index) =>
      snag(index + 1, index === 5 ? snagJpegBytes('beforeTall') : snagJpegBytes('beforeWide'), note)
    ),
    outstanding: [
      { snagSeq: 7, note: 'Hole in the plaster by the riser', levelArea: 'First' },
      { snagSeq: 8, note: 'Stain on the ceiling', levelArea: 'Second' },
      { snagSeq: 9, note: 'Board joint open in the corridor', levelArea: 'Ground' },
      { snagSeq: 10, note: 'Tidy the offcuts by the stairs', levelArea: 'Second' },
    ],
  });
  assert.equal(signerSharesLastPhoto(many.trace, 6), true);
});

test('outstanding snags continue onto later pages and stay above the footer', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const signaturePng = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]]));
  assert.ok(signaturePng);
  const covered: SnagPdfSnag = {
    snagSeq: 1,
    note: 'Bead missing at the window reveal',
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    status: 'Fixed',
    raisedByName: 'Amy Keane',
    raisedAt: '2026-10-22T08:15:00.000Z',
    fixedAt: '2026-10-22T11:40:00.000Z',
    photos: [{ bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' }],
    signature: null,
  };
  for (const count of [30, 60, 120]) {
    const outstanding = Array.from({ length: count }, (_, index) => ({
      snagSeq: index + 2,
      note: `Hole beside the riser ${index + 2}`,
      levelArea: index % 2 === 0 ? 'Ground' : 'First',
    }));
    const built = await buildSnagSignoffPdf({
      reportId: 'SO-22Oct2026',
      kind: 'contractor',
      companyName: 'Ashfield Finishes',
      siteName: 'Plot 12 - Oak Estate',
      generatedAt: when,
      confirmationText: snagConfirmation('Northbuild', 'contractor'),
      signerName: 'Dave Moran',
      signerRole: 'Site manager',
      signerCompany: 'Northbuild',
      signedAt: when,
      signaturePng,
      covered: [covered],
      outstanding,
    });
    const text = decodedPdfText(built.bytes);
    for (const row of outstanding) {
      const id = `S-${row.snagSeq}`;
      const found = text.match(new RegExp(`S-${row.snagSeq}(?!\\d)`, 'g')) ?? [];
      assert.equal(found.length, 1, `${count} outstanding, ${id} x${found.length}`);
    }
    const pages = (await PDFDocument.load(built.bytes)).getPageCount();
    const footers = built.trace.filter((item) => item.kind === 'footer');
    assert.equal(footers.length, pages, `${count} missing a footer`);
    for (const item of built.trace) {
      if (item.kind === 'footer' || item.baseline === undefined) continue;
      assert.ok(
        item.baseline >= SNAG_PDF_SIGN_BOTTOM,
        `${count} ${item.kind} on page ${item.page} crosses the bottom (${item.baseline})`
      );
    }
    const outstandingPages = new Set(
      built.trace.filter((item) => item.kind === 'outstanding').map((item) => item.page)
    );
    if (outstandingPages.size > 1) assert.match(text, /Outstanding \(continued\)/);
    const disclaimer = built.trace.filter((item) => item.kind === 'disclaimer');
    assert.ok(disclaimer.length > 0);
    const signature = built.trace.filter((item) => item.kind === 'signature' && item.snagSeq === undefined);
    assert.ok(signature.length > 0);
    const signPage = signature[0]?.page;
    assert.ok(disclaimer.every((item) => item.page === signPage));
    const onSignPage = built.trace.filter((item) => item.kind === 'outstanding' && item.page === signPage && item.baseline !== undefined);
    const earlier = built.trace.filter((item) => item.kind === 'outstanding' && item.page !== signPage);
    assert.ok(onSignPage.length > 0, `${count} signer page has no outstanding rows`);
    if (count >= 60) {
      assert.ok(earlier.length > 0, `${count} outstanding list did not continue`);
      assert.match(text, /Outstanding \(continued\)/);
    }
    const signHigh = Math.max(...signature.map((item) => item.baseline ?? 0));
    const outLow = Math.min(...onSignPage.map((item) => item.baseline ?? 0));
    const noteLow = Math.min(...disclaimer.map((item) => item.baseline ?? 0));
    const signLow = Math.min(...signature.map((item) => item.baseline ?? 0));
    assert.ok(outLow > signHigh, `${count} outstanding is not above the signature`);
    assert.ok(noteLow < signLow, `${count} disclaimer is not under the signature`);
    assert.match(text, /listed above/);
    assert.match(text, /This sign-off records the snags listed only/);
  }
});
