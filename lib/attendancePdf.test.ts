import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { formatUkDateTime } from './format.ts';
import { buildWeekSheet, type HourSpan } from './attendanceHours.ts';
import { buildAttendancePdf } from './attendancePdf.ts';

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
      // Plain streams are not text.
    }
    index = end + 'endstream'.length;
  }
  const source = streams.join('\n');
  const shown: string[] = [];
  for (const match of source.matchAll(/\((?:\\\)|[^)])*\)/g)) {
    shown.push(match[0]?.slice(1, -1).replace(/\\([()\\])/g, '$1') ?? '');
  }
  for (const match of source.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const hex = match[1]?.replace(/\s/g, '') ?? '';
    if (hex.length < 2 || hex.length % 2 !== 0) continue;
    shown.push(Buffer.from(hex, 'hex').toString('latin1'));
  }
  const glyphs = new Map<string, string>();
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const row of block[1]?.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
      const key = row[1]?.toUpperCase().padStart(4, '0') ?? '';
      const hex = row[2] ?? '';
      if (!key || hex.length % 4 !== 0) continue;
      const codes: number[] = [];
      for (let i = 0; i < hex.length; i += 4) codes.push(parseInt(hex.slice(i, i + 4), 16));
      glyphs.set(key, String.fromCharCode(...codes));
    }
  }
  for (const match of source.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
    const hex = match[1]?.toUpperCase() ?? '';
    if (hex.length % 4 !== 0) continue;
    let text = '';
    let known = true;
    for (let i = 0; i < hex.length; i += 4) {
      const char = glyphs.get(hex.slice(i, i + 4));
      if (!char) {
        known = false;
        break;
      }
      text += char;
    }
    if (known && text) shown.push(text);
  }
  return shown.join('\n');
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
