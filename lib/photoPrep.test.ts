import assert from 'node:assert/strict';
import test from 'node:test';
import { fittedSize, jpegHasExifGps, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, stripJpegExif } from './photoBytes.ts';
import { preparePhoto } from './photoPrep.ts';

test('photos fit inside 2000px', () => {
  assert.deepEqual(fittedSize(4000, 3000), { width: 2000, height: 1500 });
  assert.deepEqual(fittedSize(800, 600), { width: 800, height: 600 });
  assert.ok(Math.max(fittedSize(5000, 100).width, fittedSize(5000, 100).height) <= PHOTO_MAX_EDGE);
});

test('JPEG APP1 GPS is removed and the scan payload stays', () => {
  const exif = Buffer.from('Exif\0\0GPSLatitudeGPSLongitude', 'binary');
  const app1 = Buffer.alloc(2 + 2 + exif.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  app1.writeUInt16BE(exif.length + 2, 2);
  exif.copy(app1, 4);
  const scan = Buffer.from([0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0xff, 0xd9]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), app1, scan]);
  assert.equal(jpegHasExifGps(jpeg), true);
  const stripped = stripJpegExif(jpeg);
  assert.equal(jpegHasExifGps(stripped), false);
  assert.equal(stripped[0], 0xff);
  assert.equal(stripped[1], 0xd8);
  assert.ok(Buffer.from(stripped).includes(Buffer.from([0xff, 0xda, 0x00, 0x04])));
  assert.ok(stripped.byteLength < PHOTO_MAX_BYTES);
});

test('a camera-sized photo is compressed under the 1.5MB upload limit', async () => {
  const previousDocument = globalThis.document;
  const previousImage = globalThis.Image;
  const createObjectURL = URL.createObjectURL;
  const revokeObjectURL = URL.revokeObjectURL;
  const sizes: number[] = [];
  URL.createObjectURL = () => 'blob:photo';
  URL.revokeObjectURL = () => undefined;
  globalThis.document = {
    createElement() {
      const canvas = {
        width: 1,
        height: 1,
        getContext() {
          return { drawImage() {} };
        },
        toBlob(callback: (blob: Blob | null) => void, type: string, quality: number) {
          const edge = Math.max(canvas.width, canvas.height);
          const size = quality > 0.5 && edge > 800 ? PHOTO_MAX_BYTES + 120_000 : 48_000;
          sizes.push(size);
          const bytes = new Uint8Array(size);
          bytes[0] = 0xff;
          bytes[1] = 0xd8;
          bytes[2] = 0x00;
          callback(new Blob([bytes], { type }));
        },
      };
      return canvas;
    },
  } as unknown as Document;
  globalThis.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 4032;
    height = 3024;
    set src(_value: string) {
      this.onload?.();
    }
  } as unknown as typeof Image;
  try {
    const result = await preparePhoto({ blob: new Blob([new Uint8Array([1, 2, 3])]) });
    assert.equal(result.contentType, 'image/jpeg');
    assert.ok(sizes[0]! > PHOTO_MAX_BYTES);
    assert.ok(result.bytes.byteLength <= PHOTO_MAX_BYTES);
    assert.ok(result.bytes.byteLength < sizes[0]!);
    const native = (await import('node:fs')).readFileSync(new URL('./photoPrep.ts', import.meta.url), 'utf8');
    const nativeLoop = native.slice(native.indexOf('async function prepareOnNative'), native.indexOf('export async function preparePhoto'));
    assert.match(nativeLoop, /bytes\.byteLength <= PHOTO_MAX_BYTES/);
    assert.match(nativeLoop, /quality -= 0\.15/);
    assert.match(nativeLoop, /fittedSize/);
  } finally {
    globalThis.document = previousDocument;
    globalThis.Image = previousImage;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
  }
});
