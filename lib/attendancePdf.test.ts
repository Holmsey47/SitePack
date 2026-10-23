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
    const body = match[0]?.slice(1, -1) ?? '';
    shown.push(
      body.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_full, esc: string) => {
        if (/^[0-7]/.test(esc)) return String.fromCharCode(Number.parseInt(esc, 8));
        if (esc === 'n') return '\n';
        if (esc === 'r') return '\r';
        if (esc === 't') return '\t';
        if (esc === 'b') return '\b';
        if (esc === 'f') return '\f';
        return esc;
      })
    );
  }
  for (const match of source.matchAll(/<([0-9A-Fa-f\s]+)>/g)) {
    const hex = match[1]?.replace(/\s/g, '') ?? '';
    if (hex.length < 2 || hex.length % 2 !== 0) continue;
    shown.push(Buffer.from(hex, 'hex').toString('latin1'));
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
      personId: 'jose',
      personName: 'José Müller',
      inAt: '2026-10-20T08:00:00.000Z',
      outAt: '2026-10-20T16:00:00.000Z',
      forgot: false,
    },
    {
      personId: 'late',
      personName: 'Late Sign Out',
      inAt: '2026-10-21T20:00:00.000Z',
      outAt: '2026-10-21T22:59:00.000Z',
      forgot: true,
      gap: true,
      corrected: true,
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
  assert.match(text, /Not signed out/);
  assert.match(text, /Phone time was more than 10 minutes out/);
  assert.match(text, /Corrected/);
  assert.equal(text.includes('Mon 8h'), false);
  assert.match(text, /\nMon\n/);
  assert.match(text, /José Müller/);
  assert.equal(text.includes('Jos Mller'), false);
});
