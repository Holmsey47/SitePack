import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { clearPdfCache, createMemoryPdfCache, pdfCacheName, pdfFileName } from './pdfCache.ts';

test('sign-out clears every cached PDF and later files can be stored again', async () => {
  const cache = createMemoryPdfCache();
  await cache.write('a.pdf', new Uint8Array([1, 2, 3]));
  await cache.write('b.pdf', new Uint8Array([4]));
  assert.deepEqual(cache.snapshot().sort(), ['a.pdf', 'b.pdf']);
  await clearPdfCache(cache);
  assert.deepEqual(cache.snapshot(), []);
  await cache.write(pdfCacheName('doc', 'ver'), new Uint8Array([9]));
  assert.deepEqual(cache.snapshot(), ['doc-ver.pdf']);
});

test('cache names stay inside the app cache directory', () => {
  assert.equal(pdfCacheName('../secret', 'ver'), 'secret-ver.pdf');
  assert.equal(pdfCacheName('doc/id', '..'), 'docid-.pdf');
  assert.equal(pdfFileName('../Downloads/sheet').includes('/'), false);
  assert.equal(pdfFileName('../Downloads/sheet').includes('\\'), false);
  assert.equal(pdfFileName('Roof RAMS'), 'Roof RAMS.pdf');
  const files = fs.readFileSync('lib/pdfCacheFiles.ts', 'utf8');
  assert.match(files, /Paths\.cache/);
  assert.match(files, /sitepack-pdfs/);
  assert.equal(files.includes('Paths.document'), false);
  assert.equal(files.includes('MediaStore'), false);
  assert.equal(files.includes('Downloads'), false);
  const auth = fs.readFileSync('context/AuthContext.tsx', 'utf8');
  const bind = auth.slice(auth.indexOf('async function bindCache'), auth.indexOf('function authTokenKey'));
  assert.match(bind, /clearCachedPdfs\(\)/);
  const cleared = bind.slice(bind.indexOf('} else {'), bind.indexOf('} catch'));
  assert.match(cleared, /clearCachedPdfs\(\)/);
});
