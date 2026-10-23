import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { decodedPdfText } from './pdfDecode.ts';
import { pngDataUrl, solidPng } from './signaturePng.ts';
import { buildTalkPdf, packBlocks, pdfText, talkReportId, type RegisterPdfInput } from './talkPdf.ts';

function footerLine(input: RegisterPdfInput, page: number, total: number): string {
  return `${input.siteName} · ${input.companyName} · ${talkReportId(input.talkId, input.versionNo)} · Page ${page} of ${total}`;
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
    talkId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
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
    assert.equal(footer, footerLine(input, index + 1, footers.length));
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
    assert.match(text, new RegExp(`Page ${page} of ${footers.length}`));
  }
});

test('the presenter sign-off stays with an attendee for every gang size', async () => {
  for (let size = 1; size <= 30; size += 1) {
    const input = register();
    input.notSigned = [];
    input.signed = Array.from({ length: size }, (_, index) => ({
      name: `Gang ${index + 1}`,
      hasQuestion: false,
      question: null,
      explained: false,
      interpreter: false,
      receivedAt: '2026-10-22T13:05:00.000Z',
      meaning,
      signaturePng: png,
      sharedDevice: false,
    }));
    const { pages } = await buildTalkPdf(input);
    const signOff = pages.filter((page) => page.some((line) => line.includes('I gave this talk')));
    assert.ok(signOff.length > 0, `gang ${size} has a sign-off`);
    for (const page of signOff) {
      assert.match(page.join('\n'), /Gang \d+/, `gang ${size} sign-off page`);
    }
  }
});

function pdfContentBottoms(bytes: Uint8Array): { text: number; image: number }[] {
  const raw = Buffer.from(bytes);
  const pages: { text: number; image: number }[] = [];
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
    let source = '';
    try {
      source = zlib.inflateSync(raw.subarray(dataStart, dataEnd)).toString('latin1');
    } catch {
      index = end + 'endstream'.length;
      continue;
    }
    if (!source.includes('Tm')) {
      index = end + 'endstream'.length;
      continue;
    }
    const ops = source.split('\n');
    let text = 999;
    let image = 999;
    for (let op = 0; op < ops.length; op += 1) {
      const placed = ops[op]?.match(/^1 0 0 1 [\d.]+ ([\d.]+) Tm$/);
      if (placed) {
        const y = Number(placed[1]);
        if (y !== 28 && y < text) text = y;
      }
      if (ops[op]?.includes(' Do')) {
        for (let back = op; back >= 0; back -= 1) {
          const moved = ops[back]?.match(/^1 0 0 1 ([\d.]+) ([\d.]+) cm$/);
          if (moved && moved[1] !== '0') {
            image = Math.min(image, Number(moved[2]));
            break;
          }
        }
      }
    }
    pages.push({ text, image });
    index = end + 'endstream'.length;
  }
  return pages;
}

test('every signer is printed once and no row crosses the footer', async () => {
  for (const size of [60, 120]) {
    const input = register();
    input.notSigned = [];
    input.signed = Array.from({ length: size }, (_, index) => ({
      name: `Signer ${String(index + 1).padStart(3, '0')}`,
      hasQuestion: false,
      question: null,
      explained: false,
      interpreter: false,
      receivedAt: '2026-10-22T13:05:00.000Z',
      meaning,
      signaturePng: png,
      sharedDevice: false,
    }));
    const { bytes, footers, pages } = await buildTalkPdf(input);
    const text = decodedPdfText(bytes);
    for (let index = 1; index <= size; index += 1) {
      const name = `Signer ${String(index).padStart(3, '0')}`;
      assert.equal(text.split(name).length - 1, 1, name);
    }
    assert.ok(footers.length > 1, `gang ${size} continues onto another page`);
    assert.equal(pages[0]?.some((line) => line.includes('(continued)')), false);
    assert.ok(pages.slice(1).every((page) => page[0] === 'Register (continued)'));
    assert.equal(footers.length, pages.length);
    footers.forEach((footer, index) => {
      assert.equal(footer, footerLine(input, index + 1, footers.length));
      assert.match(text, new RegExp(`Page ${index + 1} of ${footers.length}`));
    });
    const signOff = pages.filter((page) => page.some((line) => line.includes('I gave this talk')));
    assert.equal(signOff.length, 1);
    assert.match(signOff[0]?.join('\n') ?? '', /Signer \d+/);
    for (const bottom of pdfContentBottoms(bytes)) {
      assert.ok(bottom.text >= 72, `text baseline ${bottom.text}`);
      if (bottom.image < 900) assert.ok(bottom.image >= 72, `image bottom ${bottom.image}`);
    }
  }
});

test('a row taller than one page continues instead of being clipped', async () => {
  const input = register();
  input.notSigned = [];
  input.presenterSignature = null;
  const tokens = Array.from({ length: 600 }, (_, index) => `token${String(index).padStart(3, '0')}`);
  input.signed = [
    {
      name: 'Tall Signer',
      hasQuestion: true,
      question: tokens.join(' '),
      explained: false,
      interpreter: false,
      receivedAt: '2026-10-22T13:05:00.000Z',
      meaning,
      signaturePng: png,
      sharedDevice: false,
    },
  ];
  const { bytes, footers } = await buildTalkPdf(input);
  const text = decodedPdfText(bytes);
  assert.equal(text.split('Tall Signer').length - 1, 1);
  for (const token of tokens) assert.equal(text.split(token).length - 1, 1, token);
  assert.ok(footers.length > 1);
  for (const bottom of pdfContentBottoms(bytes)) {
    assert.ok(bottom.text >= 72, `text baseline ${bottom.text}`);
    if (bottom.image < 900) assert.ok(bottom.image >= 72, `image bottom ${bottom.image}`);
  }
});

test('José Müller and Łukasz Wójcik print in the register', async () => {
  const input = register();
  input.siteName = 'Siobhán Ó Briain yard';
  input.presenterName = 'José Müller';
  input.signed = [
    {
      name: 'Łukasz Wójcik',
      hasQuestion: false,
      question: null,
      explained: false,
      interpreter: false,
      receivedAt: '2026-10-22T13:05:00.000Z',
      meaning: 'Noted and understood.',
      signaturePng: png,
      sharedDevice: false,
    },
    {
      name: 'José Müller',
      hasQuestion: false,
      question: null,
      explained: false,
      interpreter: false,
      receivedAt: '2026-10-22T13:06:00.000Z',
      meaning: 'Noted and understood.',
      signaturePng: png,
      sharedDevice: false,
    },
  ];
  const { bytes, footers } = await buildTalkPdf(input);
  const text = decodedPdfText(bytes);
  assert.match(text, /Łukasz Wójcik/);
  assert.match(text, /José Müller/);
  assert.match(text, /Siobhán Ó Briain/);
  assert.equal(text.includes('ukasz Wjcik'), false);
  assert.match(text, new RegExp(`Page 1 of ${footers.length}`));
  assert.match(text, new RegExp(talkReportId(input.talkId, input.versionNo)));
});

test('two talks with the same title, site, and day get different report refs', async () => {
  const left = register();
  const right = register();
  left.talkId = '11111111-1111-4111-8111-111111111111';
  right.talkId = '22222222-2222-4222-8222-222222222222';
  assert.equal(left.title, right.title);
  assert.equal(left.siteName, right.siteName);
  assert.equal(left.presentedAt, right.presentedAt);
  assert.equal(left.versionNo, right.versionNo);
  const fire = talkReportId(left.talkId, left.versionNo);
  const edges = talkReportId(right.talkId, right.versionNo);
  assert.notEqual(fire, edges);
  assert.equal(fire, 'TR-11111111-1111-4111-8111-111111111111-v2');
  assert.equal(edges, 'TR-22222222-2222-4222-8222-222222222222-v2');
  const printedLeft = decodedPdfText((await buildTalkPdf(left)).bytes);
  const printedRight = decodedPdfText((await buildTalkPdf(right)).bytes);
  assert.match(printedLeft, /TR-11111111-1111-4111-8111-111111111111-v2/);
  assert.match(printedRight, /TR-22222222-2222-4222-8222-222222222222-v2/);
  assert.equal(printedLeft.includes(right.talkId), false);
  assert.equal(printedRight.includes(left.talkId), false);
});

test('the register and PDF keep the signed name, the person identifier, and a rename flag', async () => {
  const input = register();
  input.signed = [
    {
      name: 'Op A',
      personRef: 'a11111',
      nameChanged: true,
      hasQuestion: false,
      question: null,
      explained: false,
      interpreter: false,
      receivedAt: '2026-10-22T13:05:00.000Z',
      meaning,
      signaturePng: png,
      sharedDevice: false,
    },
  ];
  input.presenterSignature = {
    name: 'Op A',
    personRef: 'a11111',
    nameChanged: true,
    receivedAt: '2026-10-22T13:20:00.000Z',
    meaning: 'I gave this talk to the people listed.',
    signaturePng: png,
  };
  const { bytes } = await buildTalkPdf(input);
  const text = decodedPdfText(bytes);
  assert.equal(text.split('Op A · a11111').length - 1, 2);
  assert.equal(text.split('Signed version 2').length - 1, 2);
  assert.equal(text.split('name changed since signing').length - 1, 2);
  assert.equal(text.includes('Op B'), false);
});

test('pdf text drops line separators and bidi controls', () => {
  assert.equal(pdfText('Lead\u0085\u2028\u2029\u202e\u200frole'), 'Lead     role');
  assert.equal(pdfText('=HYPERLINK("x")\r'), '=HYPERLINK("x") ');
});
