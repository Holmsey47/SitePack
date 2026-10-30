import { bytesToBase64 } from '@/data/base64';
import { makePagedPdf } from '@/lib/pdf';
import { pdfViewHtml } from '@/lib/pdfViewHtml';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

const LIBRARY = require('../assets/pdfjs/pdf.min.pdfjs');
const WORKER = require('../assets/pdfjs/pdf.worker.min.pdfjs');

export const PDF_OPEN_ERROR = 'Could not open the PDF.';

function isDeviceFile(uri: string): boolean {
  return uri.startsWith('file:') || uri.startsWith('content:');
}

async function bundledScript(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error(PDF_OPEN_ERROR);
  if (isDeviceFile(uri)) return new File(uri).text();
  const response = await fetch(uri);
  if (!response.ok) throw new Error(PDF_OPEN_ERROR);
  return response.text();
}

/** Fixture files are drawn in the app. A signed URL is read as bytes and never shown. */
export async function readPdfBytes(url: string, title: string): Promise<Uint8Array> {
  if (url.startsWith('fixture:')) return makePagedPdf([title || 'Document', 'Page 2']);
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(PDF_OPEN_ERROR);
  }
  if (!response.ok) throw new Error(PDF_OPEN_ERROR);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 5) throw new Error(PDF_OPEN_ERROR);
  return bytes;
}

/** Library and worker ship in the app. The page draws the PDF itself. */
export async function loadPdfHtml(bytes: Uint8Array): Promise<string> {
  const [library, worker] = await Promise.all([bundledScript(LIBRARY), bundledScript(WORKER)]);
  return pdfViewHtml(bytesToBase64(bytes), library, worker);
}
