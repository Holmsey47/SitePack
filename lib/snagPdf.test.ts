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
  assert.match(text, /Page 1 of /);
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
    signerRole: 'Contracts manager',
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
  assert.equal(/[\u0000-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(text), false);
  assert.match(text, /José Müller/);
  assert.match(text, /Northbuild/);
  assert.match(text, /A\$&/);
  assert.match(text, /Site manager/);
  assert.match(text, /Bead missing at the window reveal/);
  assert.match(text, /Ground/);
  assert.match(text, /I confirm the 1 snag marked complete above has been put right to my satisfaction, on behalf of/);
  assert.match(text, /Northbuild\. Snags listed as outstanding are not signed off\./);
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
    confirmationText: snagConfirmation('Northbuild', 'contractor', 1),
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
  assert.match(decodedPdfText(short.bytes), /I confirm the 1 snag marked complete above/);

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
