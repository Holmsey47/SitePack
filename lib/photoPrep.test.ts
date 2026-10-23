import assert from 'node:assert/strict';
import test from 'node:test';
import { fittedSize, jpegHasExifGps, PHOTO_MAX_BYTES, PHOTO_MAX_EDGE, stripJpegExif } from './photoBytes.ts';

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
