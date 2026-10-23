import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { pngDataUrl, solidPng } from './signaturePng.ts';
import { buildTalkPdf, packBlocks, type RegisterPdfInput } from './talkPdf.ts';

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
  return shown.join('\n');
}

const meaning = "I was at the toolbox talk 'Fire exits' given by Jordan Hale at Oak yard on 22 Oct 2026, and I understood it.";
const png = pngDataUrl(solidPng(16, 8, [20, 20, 20]));

function register(): RegisterPdfInput {
  const signed = Array.from({ length: 14 }, (_, index) => ({
    name: `Person ${index + 1} on the gang`,
    hasQuestion: false,
    question: null,
    explained: index === 0,
    interpreter: index === 0,
    receivedAt: '2026-10-22T13:05:00.000Z',
    meaning,
    signaturePng: png,
    sharedDevice: index === 1,
  }));
  return {
    companyName: 'Ashfield Finishes',
    siteName: 'Oak yard',
    title: 'Fire exits',
    kind: 'toolbox',
    delivery: 'in_person',
    versionNo: 2,
    presenterName: 'Jordan Hale',
    presenterRole: 'Owner',
    presentedAt: '2026-10-22T12:00:00.000Z',
    notSigned: [
      {
        name: 'Rio Kent',
        hasQuestion: true,
        question: 'Where is the muster point?',
        explained: false,
        interpreter: false,
      },
    ],
    signed,
    presenterSignature: {
      name: 'Jordan Hale',
      receivedAt: '2026-10-22T13:20:00.000Z',
      meaning: 'I gave this talk to the people listed.',
      signaturePng: png,
    },
  };
}

test('a heading stays with the next row and a row is not split', () => {
  const pages = packBlocks(
    [
      { kind: 'row' as const, height: 80, id: 'a' },
      { kind: 'heading' as const, height: 30, id: 'h' },
      { kind: 'row' as const, height: 40, id: 'b' },
      { kind: 'heading' as const, height: 20, id: 'orphan' },
    ],
    100
  );
  assert.deepEqual(
    pages.map((page) => page.map((block) => block.id)),
    [
      ['a'],
      ['h', 'b'],
    ]
  );
  assert.equal(
    packBlocks([{ kind: 'heading', height: 20 }], 100).length,
    0
  );
});

test('the register prints the stored sentence, markers, presenter, and page footer', async () => {
  const input = register();
  const { bytes, footers } = await buildTalkPdf(input);
  const doc = await PDFDocument.load(bytes);
  assert.ok(doc.getPageCount() >= 2);
  assert.equal(footers.length, doc.getPageCount());
  footers.forEach((footer, index) => {
    assert.equal(footer, `Oak yard · Ashfield Finishes · page ${index + 1} of ${footers.length}`);
  });
  const text = decodedPdfText(bytes);
  assert.match(text, /Version 2/);
  assert.match(text, /Presenter Jordan Hale, Owner/);
  assert.match(text, /Given in person/);
  assert.match(text, /22 Oct 2026, 1:00pm/);
  assert.match(text, /Has a question/);
  assert.match(text, /Where is the muster point\?/);
  assert.match(text, /Explained verbally/);
  assert.match(text, /Interpreter used/);
  assert.match(text, /Signed on a shared device/);
  assert.match(text, /I gave this talk to the people listed\./);
  assert.match(text, /I was at the toolbox talk 'Fire exits'/);
  assert.equal(/compliant/i.test(text), false);
  for (let page = 1; page <= footers.length; page += 1) {
    assert.match(text, new RegExp(`page ${page} of ${footers.length}`));
  }
});
