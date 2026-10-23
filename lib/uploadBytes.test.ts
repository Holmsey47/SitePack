import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { encode } from 'base64-arraybuffer';
import { bytesFromBase64, uploadBytes, type UploadBody } from './uploadBytes.ts';

const HERMES = "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported";

const PDF = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]);

function exactBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function paddedView(bytes: Uint8Array): Uint8Array {
  const padded = new Uint8Array(bytes.byteLength + 4);
  padded[0] = 1;
  padded[1] = 2;
  padded.set(bytes, 2);
  padded[bytes.byteLength + 2] = 9;
  padded[bytes.byteLength + 3] = 9;
  return padded.subarray(2, 2 + bytes.byteLength);
}

function sameBytes(body: UploadBody, bytes: Uint8Array) {
  assert.ok(body instanceof ArrayBuffer);
  assert.equal(body.byteLength, bytes.byteLength);
  const view = new Uint8Array(body);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    assert.equal(view[index], bytes[index]);
  }
}

function installHermesBlob(): { restore: () => void; calls: () => number } {
  const Original = globalThis.Blob;
  let calls = 0;
  function HermesBlob(parts?: BlobPart[], options?: BlobPropertyBag) {
    calls += 1;
    for (const part of parts ?? []) {
      if (part instanceof ArrayBuffer || ArrayBuffer.isView(part)) {
        throw new Error(HERMES);
      }
    }
    return new Original(parts ?? [], options);
  }
  globalThis.Blob = HermesBlob as unknown as typeof Blob;
  return {
    calls: () => calls,
    restore: () => {
      globalThis.Blob = Original;
    },
  };
}

test('Hermes refuses a Blob built from an ArrayBuffer or a Uint8Array', () => {
  const hermes = installHermesBlob();
  try {
    assert.throws(() => new Blob([PDF.buffer], { type: 'application/pdf' }), new RegExp(HERMES));
    assert.throws(() => new Blob([JPEG], { type: 'image/jpeg' }), new RegExp(HERMES));
    assert.equal(hermes.calls(), 2);
  } finally {
    hermes.restore();
  }
});

test('Platform.OS android and ios upload a PDF and a JPEG without building a Blob', async () => {
  const hermes = installHermesBlob();
  try {
    for (const os of ['android', 'ios']) {
      const pdf = paddedView(PDF);
      let pdfBody: UploadBody | null = null;
      const pdfResult = await uploadBytes(
        async (objectPath, body, options) => {
          pdfBody = body;
          assert.equal(objectPath, 'co/site/sheet.pdf');
          assert.equal(options.contentType, 'application/pdf');
          assert.equal(options.upsert, true);
          return { error: null };
        },
        'co/site/sheet.pdf',
        pdf,
        { contentType: 'application/pdf', upsert: true, os }
      );
      assert.equal(pdfResult.error, null);
      assert.ok(pdfBody);
      sameBytes(pdfBody, PDF);

      const jpeg = paddedView(JPEG);
      let jpegBody: UploadBody | null = null;
      const jpegResult = await uploadBytes(
        async (objectPath, body, options) => {
          jpegBody = body;
          assert.equal(objectPath, 'co/site/photo.jpg');
          assert.equal(options.contentType, 'image/jpeg');
          assert.equal(options.upsert, false);
          return { error: null };
        },
        'co/site/photo.jpg',
        jpeg,
        { contentType: 'image/jpeg', upsert: false, os }
      );
      assert.equal(jpegResult.error, null);
      assert.ok(jpegBody);
      sameBytes(jpegBody, JPEG);
    }
    assert.equal(hermes.calls(), 0);
  } finally {
    hermes.restore();
  }
});

test('web upload still sends a Blob with the file type', async () => {
  const pdfResult = await uploadBytes(
    async (_path, body, options) => {
      assert.ok(body instanceof Blob);
      assert.equal(body.type, 'application/pdf');
      assert.equal(options.contentType, 'application/pdf');
      assert.equal(options.upsert, true);
      assert.deepEqual(new Uint8Array(await body.arrayBuffer()), PDF);
      return { error: null };
    },
    'co/site/sheet.pdf',
    paddedView(PDF),
    { contentType: 'application/pdf', upsert: true, os: 'web' }
  );
  assert.equal(pdfResult.error, null);

  const jpegResult = await uploadBytes(
    async (_path, body, options) => {
      assert.ok(body instanceof Blob);
      assert.equal(body.type, 'image/jpeg');
      assert.equal(options.contentType, 'image/jpeg');
      assert.equal(options.upsert, false);
      assert.deepEqual(new Uint8Array(await body.arrayBuffer()), JPEG);
      return { error: null };
    },
    'co/site/photo.jpg',
    JPEG,
    { contentType: 'image/jpeg', upsert: false, os: 'web' }
  );
  assert.equal(jpegResult.error, null);
});

test('expo-file-system base64 decodes to the PDF and the JPEG', () => {
  assert.deepEqual(bytesFromBase64(encode(exactBuffer(PDF))), PDF);
  assert.deepEqual(bytesFromBase64(encode(exactBuffer(JPEG))), JPEG);
  const wrapped = `data:application/pdf;base64,${encode(exactBuffer(PDF))}\n`;
  assert.deepEqual(bytesFromBase64(wrapped), PDF);
});

function matchingBrace(source: string, open: number): number {
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('unbalanced web-only branch');
}

function stripWebOnly(source: string): string {
  const pattern = /if\s*\(\s*(?:Platform\.OS|os)\s*===\s*['"]web['"]\s*\)\s*\{/g;
  let out = '';
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const start = match.index ?? 0;
    const open = start + match[0].length - 1;
    out += source.slice(last, start);
    last = matchingBrace(source, open) + 1;
  }
  out += source.slice(last);
  return out;
}

function walk(dir: string, files: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === 'dist-android' ||
      entry.name === '.git' ||
      entry.name === 'android' ||
      entry.name === 'ios' ||
      entry.name === 'coverage'
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    files.push(full);
  }
}

function isUploadPath(file: string, source: string): boolean {
  const base = path.basename(file);
  if (base === 'uploadBytes.ts' || base === 'photoPrep.ts' || base === 'PhotoPicker.tsx' || base === 'upload.tsx') {
    return true;
  }
  return (
    source.includes('.storage.from(') ||
    source.includes('uploadBytes(') ||
    source.includes('readLocalBytes') ||
    source.includes('readPickedBytes') ||
    source.includes('uploadDrawingFile') ||
    source.includes('uploadSitePhoto') ||
    source.includes('setCompanyLogo')
  );
}

test('native upload paths do not build a Blob outside a web-only branch', () => {
  const files: string[] = [];
  walk('.', files);
  const hits: string[] = [];
  const uploadFiles: string[] = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    if (!isUploadPath(file, source)) continue;
    uploadFiles.push(file);
    const native = stripWebOnly(source);
    if (/new Blob\(/.test(native) || /\.blob\(\)/.test(native)) hits.push(file);
  }
  assert.deepEqual(hits, []);
  assert.ok(uploadFiles.some((file) => file.endsWith('uploadBytes.ts')));
  assert.ok(uploadFiles.some((file) => file.endsWith('supabaseRepo.ts')));
  assert.ok(uploadFiles.some((file) => file.endsWith('upload.tsx')));
  assert.ok(uploadFiles.some((file) => file.endsWith('photoPrep.ts')));
  assert.ok(uploadFiles.some((file) => file.endsWith('PhotoPicker.tsx')));

  const helper = fs.readFileSync('lib/uploadBytes.ts', 'utf8');
  const nativeHelper = stripWebOnly(helper);
  assert.match(helper, /Platform\.OS/);
  assert.match(helper, /from 'base64-arraybuffer'/);
  assert.match(helper, /new File\(uri\)\.base64\(\)/);
  assert.match(helper, /decode\(/);
  assert.match(helper, /options\.os \?\? platformOS\(\)/);
  assert.doesNotMatch(nativeHelper, /new Blob\(/);
  assert.doesNotMatch(nativeHelper, /\.blob\(\)/);
  assert.doesNotMatch(nativeHelper, /fetch\(/);

  const prep = fs.readFileSync('lib/photoPrep.ts', 'utf8');
  const nativePrep = prep.slice(prep.indexOf('async function prepareOnNative'), prep.indexOf('export async function preparePhoto'));
  assert.match(nativePrep, /readLocalBytes/);
  assert.doesNotMatch(nativePrep, /fetch\(/);
  assert.doesNotMatch(nativePrep, /new Blob\(/);
  assert.doesNotMatch(nativePrep, /\.blob\(\)/);

  const screen = fs.readFileSync('app/(app)/sites/[siteId]/upload.tsx', 'utf8');
  assert.match(screen, /readPickedBytes\(asset, Platform\.OS\)/);
  assert.doesNotMatch(screen, /new Blob\(/);
  assert.doesNotMatch(screen, /\.blob\(\)/);
  assert.doesNotMatch(screen, /fetch\(/);

  const repo = fs.readFileSync('data/supabaseRepo.ts', 'utf8');
  assert.equal(repo.match(/uploadBytes\(/g)?.length, 3);
  assert.equal(repo.match(/os: Platform\.OS/g)?.length, 3);
  assert.match(repo, /from\('drawings'\)\.upload/);
  assert.match(repo, /contentType: content, upsert: true/);
  assert.match(repo, /from\('company-logos'\)\.upload/);
  assert.match(repo, /from\('site-photos'\)\.upload/);
  assert.equal(repo.match(/upsert: false/g)?.length, 2);
  assert.doesNotMatch(repo, /new Blob\(/);
  assert.doesNotMatch(repo, /\.blob\(\)/);
  assert.doesNotMatch(stripWebOnly(repo), /new Blob\(/);
});
