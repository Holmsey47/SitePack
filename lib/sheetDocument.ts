import { bytesToBase64 } from '@/data/base64';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { sheetViewHtml } from './sheetHtml';

const LIBRARY = require('../assets/pdfjs/pdf.min.pdfjs');
const WORKER = require('../assets/pdfjs/pdf.worker.min.pdfjs');

export const SHEET_OPEN_ERROR = 'Could not open the sheet.';

function isDeviceFile(uri: string): boolean {
  return uri.startsWith('file:') || uri.startsWith('content:');
}

async function bundledScript(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error(SHEET_OPEN_ERROR);
  if (isDeviceFile(uri)) return new File(uri).text();
  const response = await fetch(uri);
  if (!response.ok) throw new Error(SHEET_OPEN_ERROR);
  return response.text();
}

async function pdfBase64(uri: string): Promise<string> {
  if (isDeviceFile(uri)) return new File(uri).base64();
  const response = await fetch(uri);
  if (!response.ok) throw new Error(SHEET_OPEN_ERROR);
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}

/** Library and worker ship in the app. The page draws the sheet itself. */
export async function loadSheetHtml(uri: string): Promise<string> {
  const [pdf, library, worker] = await Promise.all([
    pdfBase64(uri),
    bundledScript(LIBRARY),
    bundledScript(WORKER),
  ]);
  return sheetViewHtml(pdf, library, worker);
}
