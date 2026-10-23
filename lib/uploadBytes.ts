import { decode } from 'base64-arraybuffer';

/**
 * Native storage upload.
 * Hermes throws "Creating blobs from 'ArrayBuffer' and 'ArrayBufferView' are not supported"
 * and Supabase tells React Native to upload an ArrayBuffer, not a Blob.
 * Web still sends a Blob.
 */

export type UploadBody = ArrayBuffer | Blob;

type PickedFile = {
  uri?: string | null;
  file?: { arrayBuffer(): Promise<ArrayBuffer> } | null;
};

function platformOS(): string {
  // Metro supplies require. Tests pass `os` and do not call this.
  const reactNative = require('react-native') as { Platform: { OS: string } };
  return reactNative.Platform.OS;
}

function copyArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export function bodyForUpload(bytes: Uint8Array, contentType: string, os: string): UploadBody {
  const buffer = copyArrayBuffer(bytes);
  if (os === 'web') {
    return new Blob([buffer], { type: contentType });
  }
  return buffer;
}

export async function uploadBytes<T>(
  upload: (path: string, body: UploadBody, options: { contentType: string; upsert: boolean }) => Promise<T>,
  path: string,
  bytes: Uint8Array,
  options: { contentType: string; upsert: boolean; os?: string }
): Promise<T> {
  const os = options.os ?? platformOS();
  return upload(path, bodyForUpload(bytes, options.contentType, os), {
    contentType: options.contentType,
    upsert: options.upsert,
  });
}

/** Bytes from an expo-file-system base64 read. Strips a data-URL prefix and whitespace. */
export function bytesFromBase64(base64: string): Uint8Array {
  const payload = base64.replace(/^data:[^,]*,/, '').replace(/\s/g, '');
  return new Uint8Array(decode(payload));
}

/** Read a device file as base64. Native code does not build a Blob. */
export async function readLocalBytes(uri: string): Promise<Uint8Array> {
  const { File } = await import('expo-file-system');
  const base64 = await new File(uri).base64();
  return bytesFromBase64(base64);
}

export async function readPickedBytes(asset: PickedFile, os: string = platformOS()): Promise<Uint8Array> {
  if (os === 'web') {
    if (asset.file) return new Uint8Array(await asset.file.arrayBuffer());
    if (asset.uri) {
      const response = await fetch(asset.uri);
      if (!response.ok) throw new Error('Could not read that file.');
      return new Uint8Array(await response.arrayBuffer());
    }
    throw new Error('Could not read that file.');
  }
  if (!asset.uri) throw new Error('Could not read that file.');
  return readLocalBytes(asset.uri);
}
