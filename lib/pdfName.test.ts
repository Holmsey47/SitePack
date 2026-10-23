import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { dataUrlBytes, strokesToPngDataUrl } from './signaturePng.ts';
import { buildSnagPdf } from './snagPdf.ts';
import { buildVariationPdf } from './variationPdf.ts';

const NAME = 'Łukasz Wójcik';

function streamList(bytes: Uint8Array): string[] {
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
    const slice = raw.subarray(dataStart, dataEnd);
    try {
      streams.push(zlib.inflateSync(slice).toString('latin1'));
    } catch {
      streams.push(slice.toString('latin1'));
    }
    index = end + 'endstream'.length;
  }
  return streams;
}

function cmap(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const hex = (value: string) => value.replace(/\s/g, '').toUpperCase();
  const chars = (value: string) => {
    const clean = hex(value);
    let text = '';
    for (let i = 0; i + 4 <= clean.length; i += 4) {
      text += String.fromCodePoint(Number.parseInt(clean.slice(i, i + 4), 16));
    }
    return text;
  };
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const row of block[1]?.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
      map.set(hex(row[1] ?? ''), chars(row[2] ?? ''));
    }
  }
  return map;
}

function decodeWith(map: Map<string, string>, content: string): string {
  const shown: string[] = [];
  for (const match of content.matchAll(/<([0-9A-Fa-f]+)>/g)) {
    const clean = (match[1] ?? '').toUpperCase();
    let text = '';
    for (let i = 0; i + 4 <= clean.length; i += 4) text += map.get(clean.slice(i, i + 4)) ?? '';
    if (text) shown.push(text);
  }
  return shown.join('');
}

/** Each embedded font has its own glyph map. The name is present if one map reads it. */
function pdfShows(bytes: Uint8Array, name: string): boolean {
  const streams = streamList(bytes);
  if (streams.some((stream) => stream.includes(name))) return true;
  const maps = streams.filter((stream) => stream.includes('beginbfchar')).map(cmap);
  const contents = streams.filter((stream) => stream.includes('Tj'));
  return maps.some((map) => contents.some((content) => decodeWith(map, content).includes(name)));
}

test('a snag report and a variation keep Łukasz Wójcik', async () => {
  const snag = await buildSnagPdf({
    reportId: 'SR-22Oct2026',
    companyName: 'Northbuild',
    siteName: 'Harbour Point',
    generatedAt: '2026-10-22T08:00:00.000Z',
    filterLabel: 'Open',
    snags: [
      {
        snagSeq: 2,
        note: 'Crack by the door',
        levelArea: 'GF',
        tradeLabel: 'dryliner',
        status: 'Open',
        raisedByName: NAME,
        raisedAt: '2026-10-22T08:00:00.000Z',
        fixedAt: null,
        photos: [],
        signature: null,
      },
    ],
  });
  const variation = await buildVariationPdf({
    voSeq: 4,
    versionNo: 1,
    companyName: 'Northbuild',
    siteName: 'Harbour Point',
    title: 'Extra beads',
    description: 'Window reveals',
    levelArea: 'L2',
    quantityText: '12 m',
    valuePence: null,
    whenIso: '2026-10-22T08:00:00.000Z',
    signerName: NAME,
    signerRole: 'Foreman',
    signerCompany: 'Northbuild',
    confirmationText: null,
    photos: [],
    signaturePng: dataUrlBytes(strokesToPngDataUrl([[{ x: 12, y: 20 }, { x: 80, y: 90 }, { x: 160, y: 30 }]])),
  });
  assert.equal(pdfShows(snag.bytes, NAME), true);
  assert.equal(pdfShows(variation, NAME), true);
});

test('a snag report keeps José Müller', async () => {
  const snag = await buildSnagPdf({
    reportId: 'SR-22Oct2026',
    companyName: 'Northbuild',
    siteName: 'Harbour Point',
    generatedAt: '2026-10-22T08:00:00.000Z',
    filterLabel: 'Open',
    snags: [
      {
        snagSeq: 3,
        note: 'Paint the reveal',
        levelArea: 'GF',
        tradeLabel: 'decorator',
        status: 'Open',
        raisedByName: 'José Müller',
        raisedAt: '2026-10-22T08:00:00.000Z',
        fixedAt: null,
        photos: [],
        signature: null,
      },
    ],
  });
  assert.equal(pdfShows(snag.bytes, 'José Müller'), true);
  assert.equal(pdfShows(snag.bytes, 'Jos Mller'), false);
});
