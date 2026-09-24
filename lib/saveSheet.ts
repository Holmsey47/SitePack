import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

function pdfName(filename: string): string {
  const safe = filename.replace(/[^\w.\- ]+/g, '').trim() || 'sheet.pdf';
  return safe.toLowerCase().endsWith('.pdf') ? safe : `${safe}.pdf`;
}

/** Saves the sheet. Opening the sheet does not call this. */
export async function saveSheet(uri: string, filename: string): Promise<void> {
  const name = pdfName(filename);
  if (Platform.OS === 'web') {
    const anchor = document.createElement('a');
    anchor.href = uri;
    anchor.download = name;
    anchor.click();
    return;
  }
  let local = uri;
  if (uri.startsWith('http')) {
    const downloaded = await File.downloadFileAsync(uri, new File(Paths.cache, name), { idempotent: true });
    local = downloaded.uri;
  }
  await Sharing.shareAsync(local, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
}
