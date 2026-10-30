import { pdfCacheName, pdfFileName } from '@/lib/pdfCache';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

const CACHE_DIR = 'sitepack-pdfs';
const WEB_CACHE = 'sitepack-pdfs';

const webFiles = new Map<string, Uint8Array>();

function cacheDirectory(): Directory {
  return new Directory(Paths.cache, CACHE_DIR);
}

function nativeFile(name: string): File {
  const dir = cacheDirectory();
  dir.create({ intermediates: true, idempotent: true });
  return new File(dir, pdfFileName(name));
}

/** Writes a PDF under the app cache directory. Shared storage and the document directory are not used. */
export async function writeCachedPdf(name: string, bytes: Uint8Array): Promise<string | null> {
  const safe = pdfFileName(name);
  if (Platform.OS === 'web') {
    webFiles.set(safe, bytes.slice());
    try {
      const cache = await caches.open(WEB_CACHE);
      await cache.put(
        new Request(`https://sitepack.cache/${encodeURIComponent(safe)}`),
        new Response(bytes.slice(), { headers: { 'content-type': 'application/pdf' } }),
      );
    } catch {
      // The in-memory copy is still cleared on sign-out.
    }
    return null;
  }
  const file = nativeFile(safe);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file.uri;
}

export async function writeCachedDocument(documentId: string, versionId: string, bytes: Uint8Array): Promise<void> {
  await writeCachedPdf(pdfCacheName(documentId, versionId), bytes);
}

/** Removes cached PDFs. Missing files are already gone. */
export async function clearCachedPdfs(): Promise<void> {
  if (Platform.OS === 'web') {
    webFiles.clear();
    try {
      await caches.delete(WEB_CACHE);
    } catch {
      // Already gone.
    }
    return;
  }
  try {
    const dir = cacheDirectory();
    if (!dir.exists) return;
    dir.delete();
  } catch {
    // A failed wipe must not block sign-out. The directory is still only in cache.
  }
}
