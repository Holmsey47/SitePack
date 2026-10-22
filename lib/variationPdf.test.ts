import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { solidPng, strokesToPngDataUrl, dataUrlBytes } from './signaturePng.ts';
import { buildVariationPdf, fitPhoto, photoRowKind, variationPdfFilename } from './variationPdf.ts';

const ZIGZAG = [
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55,
  62, 63,
];

const Y_QUANT = [
  16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87,
  80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92,
  95, 98, 112, 100, 103, 99,
];

const C_QUANT = [
  17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99,
  99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99,
  99, 99, 99, 99,
];

const DC_LUMA_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_LUMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DC_CHROMA_BITS = [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];
const DC_CHROMA_VALS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const AC_LUMA_BITS = [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d];
const AC_LUMA_VALS = [
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32,
  0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16,
  0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45,
  0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94,
  0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6,
  0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8,
  0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];
const AC_CHROMA_BITS = [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77];
const AC_CHROMA_VALS = [
  0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81,
  0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34,
  0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44,
  0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
  0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92,
  0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4,
  0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6,
  0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8,
  0xf9, 0xfa,
];

type Huff = Map<number, { code: number; len: number }>;

function buildHuff(bits: number[], vals: number[]): Huff {
  assert.equal(
    bits.reduce((sum, count) => sum + count, 0),
    vals.length
  );
  const codes: Huff = new Map();
  let code = 0;
  let at = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let count = 0; count < (bits[length - 1] ?? 0); count += 1) {
      codes.set(vals[at] ?? 0, { code, len: length });
      code += 1;
      at += 1;
    }
    code <<= 1;
  }
  return codes;
}

const HUFF = {
  yDc: buildHuff(DC_LUMA_BITS, DC_LUMA_VALS),
  yAc: buildHuff(AC_LUMA_BITS, AC_LUMA_VALS),
  cDc: buildHuff(DC_CHROMA_BITS, DC_CHROMA_VALS),
  cAc: buildHuff(AC_CHROMA_BITS, AC_CHROMA_VALS),
};

class BitWriter {
  bytes: number[] = [];
  private acc = 0;
  private n = 0;

  put(code: number, len: number) {
    this.acc = ((this.acc << len) | (code & ((1 << len) - 1))) >>> 0;
    this.n += len;
    while (this.n >= 8) {
      this.n -= 8;
      const bite = (this.acc >> this.n) & 255;
      this.bytes.push(bite);
      if (bite === 255) this.bytes.push(0);
      this.acc &= (1 << this.n) - 1;
    }
  }

  finish() {
    if (this.n > 0) {
      const bite = ((this.acc << (8 - this.n)) | ((1 << (8 - this.n)) - 1)) & 255;
      this.bytes.push(bite);
      if (bite === 255) this.bytes.push(0);
      this.n = 0;
    }
  }
}

function category(value: number): number {
  const abs = Math.abs(value);
  if (abs === 0) return 0;
  return Math.floor(Math.log2(abs)) + 1;
}

function dctQuant(samples: number[], quant: number[]): number[] {
  const zz = new Array<number>(64).fill(0);
  for (let v = 0; v < 8; v += 1) {
    for (let u = 0; u < 8; u += 1) {
      let sum = 0;
      for (let y = 0; y < 8; y += 1) {
        for (let x = 0; x < 8; x += 1) {
          sum +=
            (samples[y * 8 + x] ?? 0) *
            Math.cos(((2 * x + 1) * u * Math.PI) / 16) *
            Math.cos(((2 * y + 1) * v * Math.PI) / 16);
        }
      }
      const cu = u === 0 ? 1 / Math.SQRT2 : 1;
      const cv = v === 0 ? 1 / Math.SQRT2 : 1;
      const natural = v * 8 + u;
      zz[ZIGZAG.indexOf(natural)] = Math.round((0.25 * cu * cv * sum) / (quant[natural] ?? 1));
    }
  }
  return zz;
}

function writeBlock(zz: number[], prevDc: number, dc: Huff, ac: Huff, bits: BitWriter): number {
  const diff = (zz[0] ?? 0) - prevDc;
  const dcCat = category(diff);
  const dcCode = dc.get(dcCat);
  if (!dcCode) throw new Error('missing dc code');
  bits.put(dcCode.code, dcCode.len);
  if (dcCat > 0) bits.put(diff >= 0 ? diff : diff + (1 << dcCat) - 1, dcCat);
  let zeros = 0;
  for (let i = 1; i < 64; i += 1) {
    const value = zz[i] ?? 0;
    if (value === 0) {
      zeros += 1;
      continue;
    }
    while (zeros > 15) {
      const zrl = ac.get(0xf0);
      if (!zrl) throw new Error('missing zrl');
      bits.put(zrl.code, zrl.len);
      zeros -= 16;
    }
    const cat = category(value);
    const code = ac.get((zeros << 4) | cat);
    if (!code) throw new Error('missing ac code');
    bits.put(code.code, code.len);
    bits.put(value >= 0 ? value : value + (1 << cat) - 1, cat);
    zeros = 0;
  }
  if (zeros > 0) {
    const eob = ac.get(0x00);
    if (!eob) throw new Error('missing eob');
    bits.put(eob.code, eob.len);
  }
  return zz[0] ?? 0;
}

function push16(out: number[], value: number) {
  out.push((value >> 8) & 255, value & 255);
}

function dht(out: number[], cls: number, id: number, bits: number[], vals: number[]) {
  out.push(0xff, 0xc4);
  push16(out, 2 + 1 + 16 + vals.length);
  out.push((cls << 4) | id, ...bits, ...vals);
}

/** Baseline JPEG with horizontal bands. Width and height are the real pixel size. */
export function fixtureJpeg(width: number, height: number, tone: 'wide' | 'tall'): Uint8Array {
  const sample = (y: number): [number, number, number] => {
    const band = tone === 'wide' ? [48, 96, 150] : [150, 110, 70];
    const lower = tone === 'wide' ? [170, 140, 90] : [70, 90, 60];
    const ground = tone === 'wide' ? [90, 100, 70] : [40, 50, 55];
    const t = y / height;
    const base = y % 48 < 4 ? [25, 25, 28] : t < 0.35 ? band : t < 0.7 ? lower : ground;
    return [base[0] ?? 0, base[1] ?? 0, base[2] ?? 0];
  };
  const cols = Math.ceil(width / 8);
  const rows = Math.ceil(height / 8);
  const rowZz: Array<{ y: number[]; cb: number[]; cr: number[] }> = [];
  for (let row = 0; row < rows; row += 1) {
    const ySamples: number[] = [];
    const cbSamples: number[] = [];
    const crSamples: number[] = [];
    for (let yy = 0; yy < 8; yy += 1) {
      const py = Math.min(height - 1, row * 8 + yy);
      const [r, g, b] = sample(py);
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
      const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
      for (let xx = 0; xx < 8; xx += 1) {
        ySamples.push(y);
        cbSamples.push(cb);
        crSamples.push(cr);
      }
    }
    rowZz.push({
      y: dctQuant(ySamples.map((value) => value - 128), Y_QUANT),
      cb: dctQuant(cbSamples.map((value) => value - 128), C_QUANT),
      cr: dctQuant(crSamples.map((value) => value - 128), C_QUANT),
    });
  }

  const bits = new BitWriter();
  let yDc = 0;
  let cbDc = 0;
  let crDc = 0;
  for (let row = 0; row < rows; row += 1) {
    const zz = rowZz[row];
    if (!zz) continue;
    for (let col = 0; col < cols; col += 1) {
      yDc = writeBlock(zz.y, yDc, HUFF.yDc, HUFF.yAc, bits);
      cbDc = writeBlock(zz.cb, cbDc, HUFF.cDc, HUFF.cAc, bits);
      crDc = writeBlock(zz.cr, crDc, HUFF.cDc, HUFF.cAc, bits);
    }
  }
  bits.finish();

  const out: number[] = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00];
  out.push(0xff, 0xdb);
  push16(out, 2 + 65 * 2);
  out.push(0x00);
  for (let i = 0; i < 64; i += 1) out.push(Y_QUANT[ZIGZAG[i] ?? 0] ?? 1);
  out.push(0x01);
  for (let i = 0; i < 64; i += 1) out.push(C_QUANT[ZIGZAG[i] ?? 0] ?? 1);
  out.push(0xff, 0xc0);
  push16(out, 17);
  out.push(8);
  push16(out, height);
  push16(out, width);
  out.push(3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1);
  dht(out, 0, 0, DC_LUMA_BITS, DC_LUMA_VALS);
  dht(out, 1, 0, AC_LUMA_BITS, AC_LUMA_VALS);
  dht(out, 0, 1, DC_CHROMA_BITS, DC_CHROMA_VALS);
  dht(out, 1, 1, AC_CHROMA_BITS, AC_CHROMA_VALS);
  out.push(0xff, 0xda);
  push16(out, 12);
  out.push(3, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00);
  const jpeg = new Uint8Array(out.length + bits.bytes.length + 2);
  jpeg.set(out, 0);
  jpeg.set(bits.bytes, out.length);
  jpeg[jpeg.length - 2] = 0xff;
  jpeg[jpeg.length - 1] = 0xd9;
  return jpeg;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  let pos = 2;
  while (pos + 8 < bytes.length) {
    const marker = ((bytes[pos] ?? 0) << 8) | (bytes[pos + 1] ?? 0);
    if (marker >= 0xffc0 && marker <= 0xffc3) {
      return { height: ((bytes[pos + 5] ?? 0) << 8) | (bytes[pos + 6] ?? 0), width: ((bytes[pos + 7] ?? 0) << 8) | (bytes[pos + 8] ?? 0) };
    }
    pos += 2 + (((bytes[pos + 2] ?? 0) << 8) | (bytes[pos + 3] ?? 0));
  }
  throw new Error('jpeg size missing');
}

function pdfText(bytes: Uint8Array): string {
  const src = Buffer.from(bytes);
  const parts: Buffer[] = [];
  let at = 0;
  while (at < src.length) {
    const start = src.indexOf('stream', at);
    if (start < 0) break;
    let data = start + 6;
    if (src[data] === 13 && src[data + 1] === 10) data += 2;
    else if (src[data] === 10) data += 1;
    const end = src.indexOf('endstream', data);
    if (end < 0) break;
    let stop = end;
    if (src[stop - 1] === 10) stop -= src[stop - 2] === 13 ? 2 : 1;
    const slice = src.subarray(data, stop);
    try {
      parts.push(zlib.inflateSync(slice));
    } catch {
      parts.push(slice);
    }
    at = end + 9;
  }
  const raw = Buffer.concat(parts).toString('latin1');
  return raw.replace(/<([0-9A-Fa-f]+)>/g, (_match, hex: string) => {
    let text = '';
    for (let i = 0; i < hex.length; i += 2) text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    return text;
  });
}

function drawnPhotos(text: string): Array<{ width: number; height: number; x: number; y: number }> {
  const found: Array<{ width: number; height: number; x: number; y: number }> = [];
  const pattern = /([0-9.]+) 0 0 ([0-9.]+) ([0-9.]+) ([0-9.]+) cm/g;
  for (const match of text.matchAll(pattern)) {
    found.push({
      width: Number(match[1]),
      height: Number(match[2]),
      x: Number(match[3]),
      y: Number(match[4]),
    });
  }
  return found.filter((item) => item.width > 100);
}

const signature = dataUrlBytes(strokesToPngDataUrl([[{ x: 10, y: 10 }, { x: 80, y: 40 }]]));

test('real-size photos keep their shape, the sign time is UK, and every page is numbered', async () => {
  assert.ok(signature);
  assert.equal(signature[0], 137);
  assert.equal(String.fromCharCode(...signature.subarray(1, 4)), 'PNG');
  const wide = fixtureJpeg(2000, 1500, 'wide');
  const tall = fixtureJpeg(1500, 2000, 'tall');
  assert.deepEqual(jpegSize(wide), { width: 2000, height: 1500 });
  assert.deepEqual(jpegSize(tall), { width: 1500, height: 2000 });
  assert.equal(photoRowKind([{ width: 2000, height: 1500 }, { width: 1500, height: 2000 }], 0), 'full');
  assert.equal(photoRowKind([{ width: 2000, height: 1500 }, { width: 2000, height: 1500 }], 0), 'pair');
  const wideFit = fitPhoto(2000, 1500, 515);
  const tallFit = fitPhoto(1500, 2000, 515);
  assert.ok(Math.abs(wideFit.width - 515) < 0.01);
  assert.ok(Math.abs(wideFit.width / wideFit.height - 2000 / 1500) < 0.001);
  assert.ok(Math.abs(tallFit.width / tallFit.height - 1500 / 2000) < 0.001);
  assert.ok(tallFit.height > 600);
  assert.ok(wideFit.height + tallFit.height > 750);

  const bytes = await buildVariationPdf({
    voSeq: 7,
    versionNo: 2,
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 – Oak Estate',
    title: 'Extra beads',
    description: 'Window reveals',
    levelArea: 'L2',
    quantityText: '12 m',
    valuePence: 18000,
    whenIso: '2026-10-22T22:14:00.000Z',
    signerName: 'Dave Moran',
    signerRoleCompany: 'Site manager, Northbuild',
    photos: [
      { bytes: wide, contentType: 'image/jpeg' },
      { bytes: tall, contentType: 'image/jpeg' },
    ],
    signaturePng: signature,
  });
  assert.equal(variationPdfFilename(7), 'Variation VO-7.pdf');
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getTitle(), 'Variation VO-7');
  assert.ok(doc.getPageCount() >= 2);
  const text = pdfText(bytes);
  assert.match(text, /Photo 1 of 2/);
  assert.match(text, /Photo 2 of 2/);
  assert.match(text, /Signed 22 Oct 2026, 11:14pm/);
  assert.match(text, /Version 2/);
  assert.match(text, /Amount:/);
  assert.match(text, /180\.00/);
  for (let page = 1; page <= doc.getPageCount(); page += 1) {
    assert.match(text, new RegExp(`VO-7 . Ashfield Finishes . page ${page} of ${doc.getPageCount()}`));
  }
  const photos = drawnPhotos(text).filter((item) => item.height > 150);
  assert.equal(photos.length, 2);
  const landscape = photos.find((item) => item.width > item.height);
  const portrait = photos.find((item) => item.height > item.width);
  assert.ok(landscape);
  assert.ok(portrait);
  assert.ok(Math.abs(landscape.width - 515) < 1);
  assert.ok(Math.abs(portrait.width - 515) < 1);
  assert.ok(Math.abs(landscape.width / landscape.height - 4 / 3) < 0.02);
  assert.ok(Math.abs(portrait.width / portrait.height - 3 / 4) < 0.02);
  assert.ok(landscape.height < 740);
  assert.ok(portrait.height < 740);
});

test('two landscape photos share a row, and a blank amount or first version stays off the page', async () => {
  const left = fixtureJpeg(2000, 1500, 'wide');
  const right = fixtureJpeg(2000, 1500, 'tall');
  const bytes = await buildVariationPdf({
    voSeq: 3,
    versionNo: 1,
    companyName: 'Ashfield Finishes',
    siteName: 'Plot 12 – Oak Estate',
    title: 'Extra skirting',
    description: '',
    levelArea: null,
    quantityText: null,
    valuePence: null,
    whenIso: '2026-01-15T22:14:00.000Z',
    signerName: 'Dave Moran',
    signerRoleCompany: 'Site manager, Northbuild',
    photos: [
      { bytes: left, contentType: 'image/jpeg' },
      { bytes: right, contentType: 'image/jpeg' },
    ],
    signaturePng: signature,
  });
  const text = pdfText(bytes);
  assert.equal(text.includes('Version'), false);
  assert.equal(text.includes('Amount'), false);
  assert.match(text, /Signed 15 Jan 2026, 10:14pm/);
  assert.match(text, /Photo 1 of 2/);
  assert.match(text, /Photo 2 of 2/);
  const photos = drawnPhotos(text).filter((item) => item.height > 100 && item.height < 300);
  assert.equal(photos.length, 2);
  assert.ok(Math.abs(photos[0].width - (515 - 8) / 2) < 1);
  assert.ok(Math.abs(photos[1].width - (515 - 8) / 2) < 1);
  assert.equal(photos[0].y, photos[1].y);
  assert.ok(photos[0].width / photos[0].height > 1.2);
  assert.equal(Buffer.from(solidPng(8, 8, [20, 80, 140])).length > 0, true);
});
