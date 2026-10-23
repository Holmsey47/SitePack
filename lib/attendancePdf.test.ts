import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { formatUkDateTime } from './format.ts';
import { buildWeekSheet, type HourSpan } from './attendanceHours.ts';
import { buildAttendancePdf } from './attendancePdf.ts';

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
  const ranges: { start: number; count: number }[] = [];
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

test('every hours page has the site, company, page count, and a UK time', async () => {
  const generatedAt = '2026-10-22T13:05:00.000Z';
  const spans: HourSpan[] = [
    ...Array.from({ length: 18 }, (_, index) => ({
      personId: `person-${index}`,
      personName: `Person ${index + 1} on the gang`,
      inAt: '2026-10-20T08:00:00.000Z',
      outAt: '2026-10-20T16:00:00.000Z',
      forgot: false,
    })),
    {
      personId: 'late',
      personName: 'Late Sign Out',
      inAt: '2026-10-21T20:00:00.000Z',
      outAt: '2026-10-21T22:59:00.000Z',
      forgot: true,
      gap: true,
      corrected: true,
      correctedBy: 'Jordan Hale',
      reason: 'Closed at four',
      prior: 'was not signed out',
    },
  ];
  const rows = buildWeekSheet(spans, '2026-10-19', '2026-10-22T18:00:00.000Z');
  const { bytes, footers } = await buildAttendancePdf({
    companyName: 'Ashfield Finishes',
    siteName: 'Oak yard',
    weekStart: '2026-10-19',
    generatedAt,
    rows,
  });
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.equal(footers.length, doc.getPageCount());
  footers.forEach((footer, index) => {
    assert.equal(footer, `Oak yard · Ashfield Finishes · page ${index + 1} of ${footers.length}`);
  });
  const text = decodedPdfText(bytes);
  assert.match(text, /22 Oct 2026, 2:05pm/);
  assert.equal(formatUkDateTime(generatedAt), '22 Oct 2026, 2:05pm');
  for (let page = 1; page <= footers.length; page += 1) {
    assert.match(text, new RegExp(`page ${page} of ${footers.length}`));
  }
  assert.equal(text.includes('£'), false);
  assert.match(text, /Tue: 8h 00m/);
  assert.match(text, /Total 8h 00m/);
  assert.match(text, /Corrected by Jordan Hale: was not signed out/);
  assert.match(text, /Closed at four/);
  assert.match(text, /Phone time was more than 10 minutes out/);
  assert.equal(text.includes('Not signed out'), false);
  assert.equal(text.includes('\nMon\n'), false);
});

test('the PDF uses the same unchecked and corrected lines as the sheet', async () => {
  const { londonWallIso, weekCsv, FLAG_FORGOT } = await import('./attendanceHours.ts');
  const inAt = londonWallIso('2026-10-21', 8, 0);
  const now = londonWallIso('2026-10-22', 9, 0);
  const rows = buildWeekSheet(
    [
      {
        personId: 'amy',
        personName: 'Amy Keane',
        inAt,
        outAt: null,
        forgot: true,
      },
    ],
    '2026-10-19',
    now
  );
  assert.equal(rows[0]?.dayLines[0], 'Wed: not signed out (in 8:00am)');
  assert.equal(rows[0]?.totalLine, 'Total 0h 00m + 1 shift to check');
  const csv = weekCsv(rows, 'Oak yard', '2026-10-19');
  assert.match(csv, /0h 00m \+ 1 shift to check,,Not signed out/);
  assert.equal(csv.includes('0.00'), false);
  assert.equal(csv.includes(FLAG_FORGOT), true);
  const { bytes } = await buildAttendancePdf({
    companyName: 'Ashfield Finishes',
    siteName: 'Oak yard',
    weekStart: '2026-10-19',
    generatedAt: '2026-10-22T09:00:00.000Z',
    rows,
  });
  const text = decodedPdfText(bytes);
  assert.match(text, /Wed: not signed out \(in 8:00am\)/);
  assert.match(text, /Total 0h 00m \+ 1 shift to check/);
  assert.match(text, /Not signed out/);
  assert.equal(text.includes('15h'), false);
  assert.equal(text.includes('23:59'), false);
});

test('José Müller and Łukasz Wójcik survive in the weekly PDF', async () => {
  const rows = buildWeekSheet(
    [
      {
        personId: 'jose',
        personName: 'José Müller',
        inAt: '2026-10-20T08:00:00.000Z',
        outAt: '2026-10-20T16:00:00.000Z',
        forgot: false,
      },
      {
        personId: 'lukasz',
        personName: 'Łukasz Wójcik',
        inAt: '2026-10-21T08:00:00.000Z',
        outAt: '2026-10-21T16:00:00.000Z',
        forgot: false,
      },
    ],
    '2026-10-19',
    '2026-10-22T18:00:00.000Z'
  );
  const { bytes } = await buildAttendancePdf({
    companyName: 'Ashfield Finishes',
    siteName: 'Oak yard',
    weekStart: '2026-10-19',
    generatedAt: '2026-10-22T13:05:00.000Z',
    rows,
  });
  const text = decodedPdfText(bytes);
  assert.match(text, /José Müller/);
  assert.match(text, /Łukasz Wójcik/);
  assert.equal(text.includes('Jos Mller'), false);
  assert.equal(text.includes('Lukasz'), false);
});

test('a site name drops controls, line breaks, bidi, and zero-width characters', async () => {
  const { pdfText } = await import('./snagPdf.ts');
  const bidi = '\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069\u200B\u200C\u200D\u200E\u200F\u2060\uFEFF';
  const raw = `Jose\u0301\nPlot\u0007${bidi} 12 – Oak`;
  assert.equal(pdfText(raw), 'José Plot 12 - Oak');
  const rows = buildWeekSheet([], '2026-10-19', '2026-10-22T13:05:00.000Z');
  const { bytes } = await buildAttendancePdf({
    companyName: 'Ashfield Finishes',
    siteName: raw,
    weekStart: '2026-10-19',
    generatedAt: '2026-10-22T13:05:00.000Z',
    rows,
  });
  const text = decodedPdfText(bytes);
  assert.equal(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/.test(text.replaceAll('\n', '')), false);
  assert.match(text, /José Plot 12 - Oak/);
  assert.equal(text.includes('\u202E'), false);
  assert.equal(text.includes('\u200B'), false);
});
