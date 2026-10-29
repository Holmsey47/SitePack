import { pdfFileName } from '@/lib/pdfCache';
import { writeCachedPdf } from '@/lib/pdfCacheFiles';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Share or save a PDF the app already holds.
 * The signed URL is never the link the person saves or shares.
 */
export async function sharePdfBytes(name: string, bytes: Uint8Array): Promise<void> {
  const safe = pdfFileName(name);
  if (Platform.OS === 'web') {
    const blob = new Blob([bytes.slice()], { type: 'application/pdf' });
    const file = new globalThis.File([blob], safe, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], title: safe });
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safe;
    anchor.rel = 'noopener';
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const uri = await writeCachedPdf(safe, bytes);
  if (!uri) throw new Error('Could not share the PDF.');
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: safe });
}
