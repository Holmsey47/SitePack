/** A place the PDF cache can write. Tests use memory. The phone uses the app cache directory. */
export type PdfCachePort = {
  write(name: string, bytes: Uint8Array): Promise<void>;
  names(): Promise<string[]>;
  remove(name: string): Promise<void>;
};

export function createMemoryPdfCache(): PdfCachePort & { snapshot(): string[] } {
  const files = new Map<string, Uint8Array>();
  return {
    async write(name, bytes) {
      files.set(name, bytes.slice());
    },
    async names() {
      return [...files.keys()];
    },
    async remove(name) {
      files.delete(name);
    },
    snapshot() {
      return [...files.keys()];
    },
  };
}

/** Drops every cached PDF. Sign-out calls this so the next person cannot open them. */
export async function clearPdfCache(port: PdfCachePort): Promise<void> {
  const names = await port.names();
  for (const name of names) {
    await port.remove(name);
  }
}

/** Cache file name. Slashes and dots that could leave the cache directory are stripped. */
export function pdfCacheName(documentId: string, versionId: string): string {
  const safe = `${documentId}-${versionId}`.replace(/[^a-zA-Z0-9-]/g, '');
  return `${safe || 'document'}.pdf`;
}

export function pdfFileName(name: string): string {
  const base = name.replace(/[\\/]/g, ' ').replace(/[^\w.\- ]+/g, '').trim() || 'document';
  return base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`;
}
