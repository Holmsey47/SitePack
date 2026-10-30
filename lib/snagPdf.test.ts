import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { SNAG_PDF_SANS, SNAG_PDF_SANS_BOLD } from './snagPdfFonts.ts';
import { formatUkDateTime } from './format.ts';
import { snagJpegBytes, type SnagJpegName } from './snagJpegFixtures.ts';
import { strokesToPngDataUrl, dataUrlBytes } from './signaturePng.ts';
import {
  buildSnagPdf,
  buildSnagSignoffPdf,
  detailsStayWithHeading,
  headingStaysWithFirstPhoto,
  signatureStaysWithSnag,
  SNAG_PDF_BOTTOM,
  SNAG_PDF_MARGIN,
  SNAG_PDF_OUTSTANDING_CONTINUED,
  SNAG_PDF_PAGE_H,
  SNAG_PDF_PAGE_W,
  SNAG_PDF_SIGN_BOTTOM,
  SNAG_PDF_UNSHOWN_NOTE,
  snagPdfFilename,
  snagPhotoCaption,
  snagReportId,
  type SnagPdfSnag,
  type SnagPdfTrace,
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

type PdfObject = { dict: string; stream: Buffer | null };

/** Read page text. Each embedded face has its own glyph ids, so a run is decoded with the font selected by Tf. */
function decodedPdfText(bytes: Uint8Array): string {
  const objects = readPdfObjects(Buffer.from(bytes));
  const cmapById = new Map<number, Map<string, string>>();
  for (const [id, obj] of objects) {
    if (!obj.stream) continue;
    const text = obj.stream.toString('latin1');
    if (!text.includes('beginbfchar') && !text.includes('beginbfrange')) continue;
    cmapById.set(id, unicodeGlyphs(text));
  }
  const fontCmap = new Map<number, Map<string, string>>();
  for (const [id, obj] of objects) {
    const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(obj.dict);
    if (!ref) continue;
    const map = cmapById.get(Number(ref[1]));
    if (map) fontCmap.set(id, map);
  }
  const parts: string[] = [];
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Page(?!s)/.test(obj.dict)) continue;
    const fontBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(obj.dict)?.[1] ?? '';
    const fonts = new Map<string, Map<string, string>>();
    for (const ref of fontBlock.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+0\s+R/g)) {
      const map = fontCmap.get(Number(ref[2]));
      if (map && ref[1]) fonts.set(ref[1], map);
    }
    const ids: number[] = [];
    for (const match of obj.dict.matchAll(/\/Contents\s*(?:(\d+)\s+0\s+R|\[([\s\S]*?)\])/g)) {
      if (match[1]) ids.push(Number(match[1]));
      for (const id of match[2]?.matchAll(/(\d+)\s+0\s+R/g) ?? []) ids.push(Number(id[1]));
    }
    for (const id of ids) {
      const stream = objects.get(id)?.stream;
      if (stream) parts.push(decodeContent(stream.toString('latin1'), fonts));
    }
  }
  return parts.join('\n');
}

function readPdfObjects(raw: Buffer): Map<number, PdfObject> {
  const marker = raw.lastIndexOf('startxref');
  const xrefAt = Number(/startxref\s+(\d+)/.exec(raw.subarray(marker).toString('latin1'))?.[1]);
  const xref = readObjectAt(raw, xrefAt);
  if (!xref.stream) throw new Error('pdf xref missing');
  const widths = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(xref.dict);
  const w = widths ? [Number(widths[1]), Number(widths[2]), Number(widths[3])] : [1, 3, 2];
  const indexBody = /\/Index\s*\[([\s\S]*?)\]/.exec(xref.dict)?.[1] ?? '';
  const indexNums = indexBody.trim().split(/\s+/).filter(Boolean).map(Number);
  const ranges: Array<{ start: number; count: number }> = [];
  if (indexNums.length >= 2 && indexNums.every((value) => Number.isFinite(value))) {
    for (let i = 0; i < indexNums.length; i += 2) ranges.push({ start: indexNums[i] ?? 0, count: indexNums[i + 1] ?? 0 });
  } else {
    const size = Number(/\/Size\s+(\d+)/.exec(xref.dict)?.[1] ?? 0);
    ranges.push({ start: 0, count: size });
  }
  const objects = new Map<number, PdfObject>();
  const entry = w[0] + w[1] + w[2];
  let cursor = 0;
  for (const range of ranges) {
    for (let i = 0; i < range.count; i += 1) {
      const at = cursor;
      cursor += entry;
      const type = w[0] ? readBe(xref.stream, at, w[0]) : 1;
      const field = readBe(xref.stream, at + w[0], w[1]);
      if (type === 1) objects.set(range.start + i, readObjectAt(raw, field));
    }
  }
  for (const obj of [...objects.values()]) {
    if (!obj.stream || !/\/Type\s*\/ObjStm/.test(obj.dict)) continue;
    const count = Number(/\/N\s+(\d+)/.exec(obj.dict)?.[1]);
    const first = Number(/\/First\s+(\d+)/.exec(obj.dict)?.[1]);
    if (!Number.isFinite(count) || !Number.isFinite(first)) continue;
    const header = obj.stream.subarray(0, first).toString('latin1').trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i += 1) {
      const id = header[i * 2];
      const offset = header[i * 2 + 1];
      if (id === undefined || offset === undefined) continue;
      const start = first + offset;
      const next = header[(i + 1) * 2 + 1];
      const end = next === undefined ? obj.stream.length : first + next;
      objects.set(id, { dict: obj.stream.subarray(start, end).toString('latin1'), stream: null });
    }
  }
  return objects;
}

function readObjectAt(raw: Buffer, offset: number): PdfObject {
  const dictStart = raw.indexOf('<<', offset);
  if (dictStart < 0) return { dict: '', stream: null };
  let depth = 0;
  let cursor = dictStart;
  for (; cursor < raw.length; cursor += 1) {
    if (raw[cursor] === 0x3c && raw[cursor + 1] === 0x3c) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (raw[cursor] === 0x3e && raw[cursor + 1] === 0x3e) {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        cursor += 1;
        break;
      }
    }
  }
  const dict = raw.subarray(dictStart, cursor).toString('latin1');
  let after = cursor;
  while (raw[after] === 0x0d || raw[after] === 0x0a || raw[after] === 0x20) after += 1;
  if (raw.subarray(after, after + 6).toString('latin1') !== 'stream') return { dict, stream: null };
  let dataStart = after + 6;
  if (raw[dataStart] === 0x0d && raw[dataStart + 1] === 0x0a) dataStart += 2;
  else if (raw[dataStart] === 0x0a) dataStart += 1;
  const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1]);
  if (!Number.isFinite(length)) return { dict, stream: null };
  let stream: Buffer = raw.subarray(dataStart, dataStart + length);
  if (dict.includes('/FlateDecode')) stream = zlib.inflateSync(stream);
  return { dict, stream };
}

function readBe(buf: Buffer, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = (value << 8) | (buf[offset + index] ?? 0);
  return value;
}

function decodeContent(source: string, fonts: Map<string, Map<string, string>>): string {
  let glyphs = new Map<string, string>();
  let text = '';
  const pattern = /\/([A-Za-z0-9_.+-]+)\s+[0-9.]+\s+Tf|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      glyphs = fonts.get(match[1]) ?? glyphs;
      continue;
    }
    const hexes = match[3] ? [match[3]] : [...(match[2]?.matchAll(/<([0-9A-Fa-f\s]+)>/g) ?? [])].map((item) => item[1] ?? '');
    for (const hex of hexes) text += decodePdfHex(hex.replace(/\s/g, ''), glyphs);
  }
  return text;
}

function unicodeGlyphs(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const remember = (code: string, unicode: string) => {
    const point = parseInt(unicode, 16);
    if (!Number.isFinite(point)) return;
    map.set(code.toUpperCase().padStart(4, '0'), String.fromCodePoint(point));
  };
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]?.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
      remember(pair[1] ?? '', pair[2] ?? '');
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1]?.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
      const start = parseInt(range[1] ?? '', 16);
      const end = parseInt(range[2] ?? '', 16);
      const dest = parseInt(range[3] ?? '', 16);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(dest) || end < start || end - start > 512) continue;
      for (let code = start; code <= end; code += 1) {
        map.set(code.toString(16).toUpperCase().padStart(4, '0'), String.fromCodePoint(dest + (code - start)));
      }
    }
  }
  return map;
}

function decodePdfHex(hex: string, glyphs: Map<string, string>): string {
  if (glyphs.size > 0 && hex.length % 4 === 0) {
    let text = '';
    for (let index = 0; index < hex.length; index += 4) {
      const char = glyphs.get(hex.slice(index, index + 4).toUpperCase());
      if (!char) return Buffer.from(hex, 'hex').toString('latin1');
      text += char;
    }
    return text;
  }
  return Buffer.from(hex, 'hex').toString('latin1');
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
            signerRole: 'Site manager',
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
  assert.match(text, /Site manager/);
  assert.match(text, /Northbuild/);
  assert.match(text, /Ashfield Finishes/);
  assert.match(text, /Signed 22 Oct 2026, 2:05pm/);
  assert.match(text, /SR-22Oct2026/);
  assert.match(text, /Page 1 of /);
  assert.match(text, /S-1 Bead missing at the window reveal, Before · Photo 1 of 1/);
  assert.match(text, /S-8 Stain on the ceiling, Before · Photo 1 of 2/);
  assert.match(text, /S-8 Stain on the ceiling, After · Photo 2 of 2/);
  const footerPages = new Set(trace.filter((item) => item.kind === 'footer').map((item) => item.page));
  assert.equal(footerPages.size, doc.getPageCount());
  for (let page = 1; page <= doc.getPageCount(); page += 1) assert.ok(footerPages.has(page));
  const photoCount = snags.reduce((sum, snag) => sum + snag.photos.length, 0);
  assert.equal(trace.filter((item) => item.kind === 'photo').length, photoCount);
  const firstHeading = trace.find((item) => item.kind === 'heading' && item.snagSeq === 1);
  const firstPhoto = trace.find((item) => item.kind === 'photo' && item.snagSeq === 1 && !item.pair);
  assert.equal(firstHeading?.page, firstPhoto?.page);
  assert.ok(firstPhoto?.width && firstPhoto.width > 500);
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
  assert.match(text, /S-3 Joint tape lifting by the door, Before · Photo 1 of 2/);
  assert.equal(headingStaysWithFirstPhoto(trace, 3), true);
  assert.equal(trace.some((item) => item.kind === 'missing' && item.snagSeq === 3), true);
});

test('contractor and internal sign-off PDFs print the stored sentence, outstanding snags, and the disclaimer', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const stored = snagConfirmation('Northbuild', 'contractor', 1);
  const internal = snagConfirmation('Ashfield Finishes', 'internal', 1);
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
  assert.match(contractorText, /I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of/);
  assert.match(contractorText, /Northbuild\./);
  assert.match(contractorText, /Outstanding \(not signed off\): 1/);
  assert.match(contractorText, /S-2 · Skirting not fixed in the hall · Ground/);
  assert.match(contractorText, /This sign-off records the snags listed only\. It isn't a completion certificate\./);
  assert.match(contractorText, /SO-22Oct2026 · Page 1 of /);
  assert.equal(contractorText.includes('£'), false);
  assert.equal(contractor.trace.filter((item) => item.kind === 'footer').length, (await PDFDocument.load(contractor.bytes)).getPageCount());

  const internalPdf = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'internal',
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: internal,
    signerName: 'Priya Shah',
    signerRole: 'Site manager',
    signerCompany: 'Ashfield Finishes',
    signedAt: when,
    signaturePng: null,
    covered: [covered],
    outstanding: [],
  });
  const internalText = decodedPdfText(internalPdf.bytes);
  assert.match(internalText, /Internal check/);
  assert.match(internalText, /I've checked the 1 snag marked complete above and I'm satisfied it's been put right\./);
  assert.match(internalText, /for Ashfield Finishes, not sign-off by the main contractor\./);
  assert.match(internalText, /Ashfield Finishes, not sign-off by the main contractor\./);
  assert.match(internalText, /not sign-off by the main contractor\./);
  assert.match(internalText, /No snags are outstanding\./);
  assert.match(internalText, /This sign-off records the snags listed only\. It isn't a completion certificate\./);
});

test('José Müller and Łukasz Wójcik survive in the sign-off PDF', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const signaturePng = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]]));
  assert.ok(signaturePng);
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: 'Łukasz Wójcik',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('Łukasz Wójcik', 'contractor', 1),
    signerName: 'José Müller',
    signerRole: 'Site manager',
    signerCompany: 'Łukasz Wójcik',
    signedAt: when,
    signaturePng,
    covered: [
      {
        snagSeq: 1,
        note: 'Bead missing at the window reveal',
        levelArea: 'Ground',
        tradeLabel: 'dryliner',
        status: 'Fixed',
        raisedByName: 'José Müller',
        raisedAt: '2026-10-22T08:15:00.000Z',
        fixedAt: '2026-10-22T11:40:00.000Z',
        photos: [{ bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' }],
        signature: null,
      },
    ],
    outstanding: [{ snagSeq: 2, note: 'Skirting not fixed in the hall', levelArea: 'Ground' }],
  });
  const text = decodedPdfText(built.bytes);
  assert.match(text, /José Müller/);
  assert.match(text, /Łukasz Wójcik/);
  assert.equal(text.includes('Jos Mller'), false);
  assert.equal(text.includes('£'), false);
  assert.equal(text.includes(SNAG_PDF_UNSHOWN_NOTE), false);
});

test('bidi overrides and control characters are stripped from the sign-off PDF', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const signaturePng = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]]));
  assert.ok(signaturePng);
  const bidi = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200E\u200F';
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: `A\u202D$&`,
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('North\u2066build', 'contractor', 1),
    signerName: 'Jos\u0000é\u200E Müller',
    signerRole: `Site${bidi}\u007F manager`,
    signerCompany: 'North\u202Ebuild',
    signedAt: when,
    signaturePng,
    covered: [
      {
        snagSeq: 1,
        note: 'Bead\u0007 missing at the window reveal',
        levelArea: 'Gro\u0001und',
        tradeLabel: 'dryliner',
        status: 'Fixed',
        raisedByName: 'José Müller',
        raisedAt: '2026-10-22T08:15:00.000Z',
        fixedAt: '2026-10-22T11:40:00.000Z',
        photos: [{ bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' }],
        signature: null,
      },
    ],
    outstanding: [{ snagSeq: 2, note: 'Skirting\u0085 not fixed', levelArea: 'Ground' }],
  });
  const text = decodedPdfText(built.bytes);
  assert.equal(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(text.replaceAll('\n', '')), false);
  assert.match(text, /José Müller/);
  assert.match(text, /Northbuild/);
  assert.match(text, /A\$&/);
  assert.match(text, /Site manager/);
  assert.match(text, /Bead missing at the window reveal/);
  assert.match(text, /Ground/);
  assert.match(text, /I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of/);
  assert.match(text, /Northbuild\. Snags listed as outstanding are not signed off\./);
});

const NATURAL_PHOTO_W = SNAG_PDF_PAGE_W - 80;
const PAIR_PHOTO_W = (NATURAL_PHOTO_W - 8) / 2;

function assertPhotoInside(photo: SnagPdfTrace, label: string) {
  assert.ok((photo.x ?? -1) >= 0 && (photo.y ?? -1) >= 0, `${label} photo origin ${photo.x},${photo.y}`);
  assert.ok((photo.x ?? 0) + (photo.width ?? 0) <= SNAG_PDF_PAGE_W, `${label} photo crosses the right edge`);
  assert.ok((photo.y ?? 0) + (photo.height ?? 0) <= SNAG_PDF_PAGE_H, `${label} photo crosses the top`);
}

function assertFinalBlock(
  trace: SnagPdfTrace[],
  outstanding: Array<{ snagSeq: number }>,
  text: string,
  label: string
) {
  const disclaimer = trace.filter((item) => item.kind === 'disclaimer');
  const signature = trace.filter((item) => item.kind === 'signature' && item.snagSeq === undefined);
  assert.ok(disclaimer.length > 0, `${label} has no disclaimer`);
  assert.ok(signature.length > 0, `${label} has no signer`);
  const signPage = signature[0]?.page;
  assert.ok(signPage, `${label} has no signer page`);
  assert.ok(disclaimer.every((item) => item.page === signPage), `${label} disclaimer left the signer page`);
  assert.ok(signature.every((item) => item.page === signPage), `${label} signer block split`);
  const onSignPage = trace.filter((item) => item.kind === 'outstanding' && item.page === signPage);
  assert.ok(onSignPage.length > 0, `${label} outstanding list left the signer page`);
  if (outstanding.length > 0) {
    const last = outstanding[outstanding.length - 1]?.snagSeq;
    assert.ok(
      trace.some((item) => item.kind === 'outstanding' && item.snagSeq === last && item.page === signPage),
      `${label} list does not end on the signer page`
    );
  }
  if (trace.some((item) => item.kind === 'outstanding' && item.page !== signPage)) {
    assert.match(text, /Outstanding \(not signed off\), continued/);
  }
  const signHigh = Math.max(...signature.map((item) => item.baseline ?? 0));
  const signLow = Math.min(...signature.map((item) => item.baseline ?? 0));
  const outLow = Math.min(...onSignPage.filter((item) => item.baseline !== undefined).map((item) => item.baseline ?? 0));
  const noteLow = Math.min(...disclaimer.map((item) => item.baseline ?? 0));
  assert.ok(outLow > signHigh, `${label} outstanding is not above the signature`);
  assert.ok(noteLow < signLow, `${label} disclaimer is not under the signature`);
}

test('the outstanding list, sentence, signer and disclaimer stay one block', async () => {
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
    confirmationText: snagConfirmation('Northbuild', 'contractor', 1),
    signerName: 'José Marín',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng,
  };
  const oneWide = await buildSnagSignoffPdf({
    ...base,
    covered: [snag(1, snagJpegBytes('beforeWide'), 'Bead missing at the window reveal')],
    outstanding: [{ snagSeq: 2, note: 'Skirting not fixed in the hall', levelArea: 'Ground' }],
  });
  const oneText = decodedPdfText(oneWide.bytes);
  assert.match(oneText, /José Marín/);
  const onePhoto = oneWide.trace.find((item) => item.kind === 'photo' && item.snagSeq === 1);
  assert.ok(onePhoto);
  assert.ok(Math.abs((onePhoto.width ?? 0) - NATURAL_PHOTO_W) < 0.5);
  assert.equal(oneWide.trace.find((item) => item.kind === 'heading' && item.snagSeq === 1)?.page, onePhoto.page);
  assertPhotoInside(onePhoto, 'wide');
  assertFinalBlock(oneWide.trace, [{ snagSeq: 2 }], oneText, 'wide');
  const short = await buildSnagSignoffPdf({
    ...base,
    covered: [snag(1, snagJpegBytes('beforeWide'), 'Bead missing at the window reveal')],
    outstanding: [],
  });
  const shortText = decodedPdfText(short.bytes);
  assert.match(shortText, /No snags are outstanding/);
  assert.match(shortText, /I confirm the 1 snag marked complete above/);
  assert.equal(
    short.trace.find((item) => item.kind === 'heading' && item.snagSeq === 1)?.page,
    short.trace.find((item) => item.kind === 'photo' && item.snagSeq === 1)?.page
  );
  assertFinalBlock(short.trace, [], shortText, 'empty outstanding');

  const tall = await buildSnagSignoffPdf({
    ...base,
    covered: [snag(1, snagJpegBytes('beforeTall'), 'Bead missing at the window reveal')],
    outstanding: [],
  });
  const tallPhoto = tall.trace.find((item) => item.kind === 'photo' && item.snagSeq === 1);
  assert.equal(tall.trace.find((item) => item.kind === 'header')?.page, 1);
  assert.ok(tallPhoto);
  assert.equal(tall.trace.find((item) => item.kind === 'heading' && item.snagSeq === 1)?.page, tallPhoto.page);
  assert.ok(Math.abs((tallPhoto.width ?? 0) - NATURAL_PHOTO_W) < 0.5);
  const tallSize = jpegSize(snagJpegBytes('beforeTall'));
  assert.ok(Math.abs((tallPhoto.height ?? 0) - (NATURAL_PHOTO_W * tallSize.height) / tallSize.width) < 0.5);
  assertPhotoInside(tallPhoto, 'tall');
  assertFinalBlock(tall.trace, [], decodedPdfText(tall.bytes), 'tall');

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
  const manyText = decodedPdfText(many.bytes);
  const manyTall = many.trace.find((item) => item.kind === 'photo' && item.snagSeq === 6);
  assert.ok(manyTall);
  assert.equal(many.trace.find((item) => item.kind === 'heading' && item.snagSeq === 6)?.page, manyTall.page);
  assert.ok(Math.abs((manyTall.width ?? 0) - NATURAL_PHOTO_W) < 0.5);
  assertPhotoInside(manyTall, 'many');
  assertFinalBlock(
    many.trace,
    [
      { snagSeq: 7 },
      { snagSeq: 8 },
      { snagSeq: 9 },
      { snagSeq: 10 },
    ],
    manyText,
    'many'
  );
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
      confirmationText: snagConfirmation('Northbuild', 'contractor', 1),
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
    if (outstandingPages.size > 1) assert.match(text, /Outstanding \(not signed off\), continued/);
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
      assert.match(text, /Outstanding \(not signed off\), continued/);
      const lastSeq = outstanding[outstanding.length - 1]?.snagSeq;
      assert.ok(
        built.trace.some((item) => item.kind === 'outstanding' && item.snagSeq === lastSeq && item.page === signPage),
        `${count} list does not end on the signer page`
      );
    }
    const signHigh = Math.max(...signature.map((item) => item.baseline ?? 0));
    const outLow = Math.min(...onSignPage.map((item) => item.baseline ?? 0));
    const noteLow = Math.min(...disclaimer.map((item) => item.baseline ?? 0));
    const signLow = Math.min(...signature.map((item) => item.baseline ?? 0));
    assert.ok(outLow > signHigh, `${count} outstanding is not above the signature`);
    assert.ok(noteLow < signLow, `${count} disclaimer is not under the signature`);
    assert.match(text, /I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of/);
    assert.match(text, /Northbuild\. Snags listed as outstanding are not signed off\./);
    assert.equal(text.includes('£'), false);
    const referenceHits = text.match(/SO-22Oct2026/g) ?? [];
    assert.equal(referenceHits.length, pages, `${count} report reference is not on every page`);
    for (let page = 1; page <= pages; page += 1) {
      assert.match(text, new RegExp(`SO-22Oct2026 · Page ${page} of ${pages}`));
    }
    assert.match(text, /This sign-off records the snags listed only/);
  }
});

test('each put-right snag stays with its photos at full size', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const signaturePng = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]]));
  assert.ok(signaturePng);
  const covered = (seq: number, bytes: Uint8Array, photos: 'one' | 'pair'): SnagPdfSnag => ({
    snagSeq: seq,
    note: seq === 2 ? 'Door will not close on the latch' : 'Crack above the lintel',
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    status: 'Fixed',
    raisedByName: 'Amy Keane',
    raisedAt: '2026-10-22T08:15:00.000Z',
    fixedAt: '2026-10-22T11:40:00.000Z',
    photos:
      photos === 'pair'
        ? [
            { bytes, contentType: 'image/jpeg', kind: 'before' },
            { bytes: snagJpegBytes('afterWide'), contentType: 'image/jpeg', kind: 'after' },
          ]
        : [{ bytes, contentType: 'image/jpeg', kind: 'before' }],
    signature: null,
  });
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('Northbuild', 'contractor', 2),
    signerName: 'Dave Moran',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng,
    covered: [covered(1, snagJpegBytes('beforeWide'), 'one'), covered(2, snagJpegBytes('beforeWide'), 'pair')],
    outstanding: [],
  });
  assert.equal(snagPhotoCaption(2, 'Cracked board', 0, 2, 'before'), 'S-2 Cracked board, Before · Photo 1 of 2');
  assert.equal(SNAG_PDF_OUTSTANDING_CONTINUED, 'Outstanding (not signed off), continued');
  const text = decodedPdfText(built.bytes);
  assert.match(text, /S-2 Door will not close on the latch, Before · Photo 1 of 2/);
  assert.match(text, /S-2 Door will not close on the latch, After · Photo 2 of 2/);
  const heading = built.trace.find((item) => item.kind === 'heading' && item.snagSeq === 2);
  const photos = built.trace.filter((item) => item.kind === 'photo' && item.snagSeq === 2);
  const single = built.trace.find((item) => item.kind === 'photo' && item.snagSeq === 1);
  assert.equal(photos.length, 2);
  assert.ok(heading);
  assert.ok(single);
  assert.ok(Math.abs((single.width ?? 0) - NATURAL_PHOTO_W) < 0.5);
  assert.ok(photos.every((item) => item.page === heading?.page));
  for (const photo of photos) {
    assert.ok(Math.abs((photo.width ?? 0) - PAIR_PHOTO_W) < 0.5);
    assertPhotoInside(photo, 'pair');
  }
  assertPhotoInside(single, 'single');
  assertFinalBlock(built.trace, [], text, 'two snags');
});

test('a swept sign-off keeps every photo on its snag page and the closing block intact', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const signaturePng = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]]));
  assert.ok(signaturePng);
  const tall = snagJpegBytes('beforeTall');
  const wide = snagJpegBytes('beforeWide');
  const tallSize = jpegSize(tall);
  const wideSize = jpegSize(wide);
  for (const count of [1, 2, 15, 36, 120]) {
    for (const aspect of ['tall', 'wide'] as const) {
      for (const coveredCount of [1, 2, 3]) {
        const bytes = aspect === 'tall' ? tall : wide;
        const pixel = aspect === 'tall' ? tallSize : wideSize;
        const covered: SnagPdfSnag[] = Array.from({ length: coveredCount }, (_, index) => ({
          snagSeq: index + 1,
          note: `Put right ${index + 1}`,
          levelArea: 'Ground',
          tradeLabel: 'dryliner',
          status: 'Fixed',
          raisedByName: 'Amy Keane',
          raisedAt: '2026-10-22T08:15:00.000Z',
          fixedAt: '2026-10-22T11:40:00.000Z',
          photos: [{ bytes, contentType: 'image/jpeg', kind: 'before' as const }],
          signature: null,
        }));
        const outstanding = Array.from({ length: count }, (_, index) => ({
          snagSeq: index + 10,
          note: `Hole beside the riser ${index + 10}`,
          levelArea: index % 2 === 0 ? 'Ground' : 'First',
        }));
        const built = await buildSnagSignoffPdf({
          reportId: 'SO-22Oct2026',
          kind: 'contractor',
          companyName: 'Ashfield Finishes',
          siteName: 'Plot 12 - Oak Estate',
          generatedAt: when,
          confirmationText: snagConfirmation('Northbuild', 'contractor', coveredCount),
          signerName: 'Dave Moran',
          signerRole: 'Site manager',
          signerCompany: 'Northbuild',
          signedAt: when,
          signaturePng,
          covered,
          outstanding,
        });
        const label = `${count} ${aspect} x${coveredCount}`;
        const expectedH = (NATURAL_PHOTO_W * pixel.height) / pixel.width;
        for (const snag of covered) {
          const heading = built.trace.find((item) => item.kind === 'heading' && item.snagSeq === snag.snagSeq);
          const photos = built.trace.filter((item) => item.kind === 'photo' && item.snagSeq === snag.snagSeq);
          assert.ok(heading, `${label} S-${snag.snagSeq} has no heading`);
          assert.ok(photos.length > 0, `${label} S-${snag.snagSeq} has no photo`);
          for (const photo of photos) {
            assert.equal(photo.page, heading?.page, `${label} S-${snag.snagSeq} photo left its heading`);
            assert.ok(Math.abs((photo.width ?? 0) - NATURAL_PHOTO_W) < 0.5, `${label} photo width ${photo.width}`);
            assert.ok(Math.abs((photo.height ?? 0) - expectedH) < 0.5, `${label} photo height ${photo.height}`);
            assertPhotoInside(photo, label);
          }
        }
        const continued = built.trace.some((item) => item.kind === 'outstanding' && item.page !== built.trace.find((row) => row.kind === 'signature' && row.snagSeq === undefined)?.page);
        assertFinalBlock(built.trace, outstanding, continued ? decodedPdfText(built.bytes) : '', label);
      }
    }
  }
});

test('a footer cuts a long company with an ellipsis', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const company = 'Ashfield Finishes Regional Holdings '.repeat(6).trim();
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: company,
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('Northbuild', 'contractor', 1),
    signerName: 'Dave Moran',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng: null,
    covered: [
      {
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
      },
    ],
    outstanding: [],
  });
  const text = decodedPdfText(built.bytes);
  assert.match(text, /… · SO-22Oct2026 · Page 1 of /);
  assert.equal(text.includes(SNAG_PDF_UNSHOWN_NOTE), false);
});

function embeddedFontBytes(encoded: string): Uint8Array {
  const binary = globalThis.atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

test('the sign-off font includes Romanian comma-below letters', async () => {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  for (const encoded of [SNAG_PDF_SANS, SNAG_PDF_SANS_BOLD]) {
    const face = await doc.embedFont(embeddedFontBytes(encoded));
    const chars = new Set(face.getCharacterSet());
    for (const code of [0x0218, 0x0219, 0x021a, 0x021b]) {
      assert.ok(chars.has(code), `missing U+${code.toString(16).toUpperCase()}`);
    }
  }
});

test('Ștefan Țăran prints in the signer, the company and the sentence, with no fallback note', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const company = '\u0218tefan \u021A\u0103ran SRL';
  const sentence = snagConfirmation(company, 'contractor', 1);
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: company,
    siteName: '\u0418\u0432\u0430\u043D \u041F\u0435\u0442\u0440\u043E\u0432',
    generatedAt: when,
    confirmationText: sentence,
    signerName: company,
    signerRole: 'Site manager',
    signerCompany: company,
    signedAt: when,
    signaturePng: null,
    covered: [
      {
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
      },
    ],
    outstanding: [],
  });
  const text = decodedPdfText(built.bytes);
  assert.equal(sentence, 'I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of Ștefan Țăran SRL. Snags listed as outstanding are not signed off.');
  assert.match(text, /Snag sign-offȘtefan Țăran SRL/);
  assert.match(text, /ofȘtefan Țăran SRL\. Snags listed as outstanding are not signed off\./);
  assert.match(text, /Ștefan Țăran SRLSite manager/);
  assert.match(text, /Иван Петров/);
  assert.equal(text.includes('?'), false);
  assert.equal(text.includes(SNAG_PDF_UNSHOWN_NOTE), false);
});

test('an emoji or a CJK name adds the fallback note, and a plain name does not', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const note = 'Paint \u{1F600}\u4E2D missing';
  const cjkName = '\u738B\u4F1F';
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: 'Ashfield Finishes',
    siteName: 'Jos\u00e9 M\u00fcller',
    generatedAt: when,
    confirmationText: snagConfirmation('\u0141ukasz W\u00f3jcik', 'contractor', 1),
    signerName: cjkName,
    signerRole: 'Site manager',
    signerCompany: '\u0141ukasz W\u00f3jcik',
    signedAt: when,
    signaturePng: null,
    covered: [
      {
        snagSeq: 1,
        note,
        levelArea: 'Ground',
        tradeLabel: 'dryliner',
        status: 'Fixed',
        raisedByName: 'Jos\u00e9 M\u00fcller',
        raisedAt: '2026-10-22T08:15:00.000Z',
        fixedAt: '2026-10-22T11:40:00.000Z',
        photos: [{ bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' }],
        signature: null,
      },
    ],
    outstanding: [],
  });
  const text = decodedPdfText(built.bytes);
  assert.equal(note, 'Paint \u{1F600}\u4E2D missing');
  assert.equal(cjkName, '\u738B\u4F1F');
  assert.match(text, /José Müller/);
  assert.match(text, /Łukasz Wójcik/);
  assert.match(text, /Paint \?\? missing/);
  assert.match(text, /\?\?Site manager/);
  assert.equal(text.includes('\u{1F600}'), false);
  assert.equal(text.includes('\u4E2D'), false);
  assert.equal(text.includes('\u738B'), false);
  assert.equal(SNAG_PDF_UNSHOWN_NOTE, "Some characters can't be shown in this PDF and appear as ?. The signed record in SitePack shows the full text.");
  assert.match(text, /Some characters can't be shown in this PDF and appear as \?\. The signed record in SitePack shows the full text\./);

  const plain = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('Northbuild', 'contractor', 1),
    signerName: '\u0418\u0432\u0430\u043D \u041F\u0435\u0442\u0440\u043E\u0432',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng: null,
    covered: [
      {
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
      },
    ],
    outstanding: [],
  });
  const plainText = decodedPdfText(plain.bytes);
  assert.match(plainText, /Иван Петров/);
  assert.match(plainText, /Ashfield Finishes/);
  assert.equal(plainText.includes(SNAG_PDF_UNSHOWN_NOTE), false);
});

function crc32(buf: Buffer): number {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return ~crc >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type), data]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, sum]);
}

function solidPng(width: number, height: number): Uint8Array {
  const stride = width * 3 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * stride;
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = 180;
      raw[at + 1] = 96;
      raw[at + 2] = 48;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', zlib.deflateSync(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ])
  );
}

function assertPhotoInBand(photo: SnagPdfTrace, footer: number, label: string) {
  const x = photo.x ?? -1;
  const y = photo.y ?? -1;
  const width = photo.width ?? 0;
  const height = photo.height ?? 0;
  assert.ok(y >= footer - 0.5, `${label} photo bottom ${y} is under the footer`);
  assert.ok(y + height <= SNAG_PDF_PAGE_H - SNAG_PDF_MARGIN + 0.5, `${label} photo top ${y + height} is in the top margin`);
  assert.ok(x >= SNAG_PDF_MARGIN - 0.5, `${label} photo left ${x}`);
  assert.ok(x + width <= SNAG_PDF_PAGE_W - SNAG_PDF_MARGIN + 0.5, `${label} photo right ${x + width}`);
}

test('a newline in a note becomes a space, and a decomposed name is composed', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: 'Northbuild',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('Northbuild', 'contractor', 1),
    signerName: 'Jose\u0301 Mu\u0308ller',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng: null,
    covered: [
      {
        snagSeq: 1,
        note: 'Crack by door\nLevel 2',
        levelArea: 'Ground',
        tradeLabel: 'dryliner',
        status: 'Fixed',
        raisedByName: 'Amy Keane',
        raisedAt: '2026-10-22T08:15:00.000Z',
        fixedAt: '2026-10-22T11:40:00.000Z',
        photos: [{ bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' }],
        signature: null,
      },
    ],
    outstanding: [],
  });
  const text = decodedPdfText(built.bytes);
  assert.match(text, /Crack by door Level 2/);
  assert.equal(text.includes('Crack by doorLevel 2'), false);
  assert.match(text, /Jos\u00e9 M\u00fcller/);
  assert.equal(text.includes(SNAG_PDF_UNSHOWN_NOTE), false);
});

test('every photo stays between the top margin and the footer, at its own row', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const signaturePng = dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }]]));
  assert.ok(signaturePng);
  const aspects = {
    '3:4': solidPng(600, 800),
    '9:16': solidPng(450, 800),
    '4:3': solidPng(800, 600),
    '16:9': solidPng(800, 450),
  } as const;
  const aspectSize = {
    '3:4': { width: 600, height: 800 },
    '9:16': { width: 450, height: 800 },
    '4:3': { width: 800, height: 600 },
    '16:9': { width: 800, height: 450 },
  } as const;
  const signBase = {
    reportId: 'SO-22Oct2026',
    kind: 'contractor' as const,
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    signerName: 'Dave Moran',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng,
  };
  for (const count of [0, 1, 2, 15, 36, 120]) {
    for (const coveredCount of [1, 2, 3]) {
      for (const aspect of ['3:4', '9:16', '4:3', '16:9'] as const) {
        const bytes = aspects[aspect];
        const pixel = aspectSize[aspect];
        const covered: SnagPdfSnag[] = Array.from({ length: coveredCount }, (_, index) => ({
          snagSeq: index + 1,
          note: `Put right ${index + 1} with a long title for the corridor`,
          levelArea: 'Ground',
          tradeLabel: 'dryliner',
          status: 'Fixed',
          raisedByName: 'Amy Keane',
          raisedAt: '2026-10-22T08:15:00.000Z',
          fixedAt: '2026-10-22T11:40:00.000Z',
          photos: [
            { bytes, contentType: 'image/png', kind: 'before' as const },
            { bytes, contentType: 'image/png', kind: 'after' as const },
          ],
          signature: null,
        }));
        const outstanding = Array.from({ length: count }, (_, index) => ({
          snagSeq: index + 20,
          note: `Hole beside the riser ${index + 20}`,
          levelArea: index % 2 === 0 ? 'Ground' : 'First',
        }));
        const built = await buildSnagSignoffPdf({
          ...signBase,
          confirmationText: snagConfirmation('Northbuild', 'contractor', coveredCount),
          covered,
          outstanding,
        });
        const label = `${count} outstanding, ${coveredCount} covered, ${aspect}`;
        const photos = built.trace.filter((item) => item.kind === 'photo');
        assert.equal(photos.length, coveredCount * 2, `${label} photo count`);
        for (const photo of photos) assertPhotoInBand(photo, SNAG_PDF_SIGN_BOTTOM, label);
        const landscape = aspect === '4:3' || aspect === '16:9';
        for (const snag of covered) {
          const heading = built.trace.find((item) => item.kind === 'heading' && item.snagSeq === snag.snagSeq);
          const snagPhotos = photos.filter((item) => item.snagSeq === snag.snagSeq);
          assert.equal(snagPhotos[0]?.page, heading?.page, `${label} S-${snag.snagSeq} heading left its first photo`);
          if (landscape) {
            for (const photo of snagPhotos) {
              assert.ok(Math.abs((photo.width ?? 0) - PAIR_PHOTO_W) < 0.5, `${label} pair width ${photo.width}`);
              const expectedH = (PAIR_PHOTO_W * pixel.height) / pixel.width;
              assert.ok(Math.abs((photo.height ?? 0) - expectedH) < 0.5, `${label} pair height ${photo.height}`);
            }
          } else if (aspect === '3:4') {
            for (const photo of snagPhotos) {
              assert.ok(Math.abs((photo.width ?? 0) - NATURAL_PHOTO_W) < 0.5, `${label} portrait width ${photo.width}`);
              const expectedH = (NATURAL_PHOTO_W * pixel.height) / pixel.width;
              assert.ok(Math.abs((photo.height ?? 0) - expectedH) < 0.5, `${label} portrait height ${photo.height}`);
            }
          } else {
            for (const photo of snagPhotos) {
              const ratio = (photo.height ?? 0) / (photo.width ?? 1);
              assert.ok(Math.abs(ratio - pixel.height / pixel.width) < 0.02, `${label} aspect ${ratio}`);
              assert.ok((photo.width ?? 0) < NATURAL_PHOTO_W - 1, `${label} 9:16 stayed too wide to fit`);
            }
          }
        }
        const text = decodedPdfText(built.bytes);
        for (const snag of covered) assert.match(text, new RegExp(`S-${snag.snagSeq}(?!\\d)`));
        if (count > 0) {
          const continued = built.trace.some(
            (item) =>
              item.kind === 'outstanding' &&
              item.page !== built.trace.find((row) => row.kind === 'signature' && row.snagSeq === undefined)?.page
          );
          assertFinalBlock(built.trace, outstanding, continued ? text : '', label);
        }
      }
    }
  }

  const many = Array.from({ length: 20 }, (_, index) => ({
    bytes: snagJpegBytes(index % 2 === 0 ? 'beforeWide' : 'afterWide'),
    contentType: 'image/jpeg',
    kind: (index < 10 ? 'before' : 'after') as 'before' | 'after',
  }));
  const packed: SnagPdfSnag = {
    snagSeq: 2,
    note: 'Door will not close on the latch',
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    status: 'Fixed',
    raisedByName: 'Amy Keane',
    raisedAt: '2026-10-22T08:15:00.000Z',
    fixedAt: '2026-10-22T11:40:00.000Z',
    photos: many,
    signature: null,
  };
  for (const report of ['sign', 'share'] as const) {
    const built =
      report === 'sign'
        ? await buildSnagSignoffPdf({
            ...signBase,
            confirmationText: snagConfirmation('Northbuild', 'contractor', 1),
            covered: [packed],
            outstanding: [],
          })
        : await buildSnagPdf({
            reportId: 'SR-22Oct2026',
            companyName: 'Ashfield Finishes',
            siteName: 'Plot 12 - Oak Estate',
            generatedAt: when,
            filterLabel: 'All snags',
            snags: [packed],
          });
    const photos = built.trace.filter((item) => item.kind === 'photo');
    assert.equal(photos.length, 20, `${report} lost landscape photos`);
    const footer = report === 'sign' ? SNAG_PDF_SIGN_BOTTOM : SNAG_PDF_BOTTOM;
    for (const photo of photos) {
      assertPhotoInBand(photo, footer, `${report} 10+10`);
      assert.ok(Math.abs((photo.width ?? 0) - PAIR_PHOTO_W) < 0.5, `${report} shrank a landscape photo to ${photo.width}`);
    }
  }
});

test('a five snag put-right list names every S-number in the PDF', async () => {
  const when = '2026-10-22T13:05:00.000Z';
  const title = 'Paint missing along the whole of the corridor wall beside the riser cupboard';
  const covered: SnagPdfSnag[] = Array.from({ length: 5 }, (_, index) => ({
    snagSeq: index + 5,
    note: title,
    levelArea: 'Ground',
    tradeLabel: 'dryliner',
    status: 'Fixed',
    raisedByName: 'Amy Keane',
    raisedAt: '2026-10-22T08:15:00.000Z',
    fixedAt: '2026-10-22T11:40:00.000Z',
    photos: [{ bytes: snagJpegBytes('beforeWide'), contentType: 'image/jpeg', kind: 'before' }],
    signature: null,
  }));
  const built = await buildSnagSignoffPdf({
    reportId: 'SO-22Oct2026',
    kind: 'contractor',
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 - Oak Estate',
    generatedAt: when,
    confirmationText: snagConfirmation('Northbuild', 'contractor', 5),
    signerName: 'Dave Moran',
    signerRole: 'Site manager',
    signerCompany: 'Northbuild',
    signedAt: when,
    signaturePng: null,
    covered,
    outstanding: [],
  });
  const text = decodedPdfText(built.bytes);
  for (let seq = 5; seq <= 9; seq += 1) {
    const hits = text.match(new RegExp(`S-${seq}(?!\\d)`, 'g')) ?? [];
    assert.ok(hits.length >= 2, `S-${seq} appeared ${hits.length} times`);
  }
  assert.match(text, /5 put right:/);
});
