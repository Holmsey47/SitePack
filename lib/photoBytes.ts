/** Longest side, in pixels. */
export const PHOTO_MAX_EDGE = 2000;
/** 1.5 MiB. The storage bucket uses the same cap. */
export const PHOTO_MAX_BYTES = 1_572_864;

export function fittedSize(
  width: number,
  height: number,
  maxEdge = PHOTO_MAX_EDGE
): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const edge = Math.max(safeWidth, safeHeight);
  if (edge <= maxEdge) return { width: safeWidth, height: safeHeight };
  const scale = maxEdge / edge;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

/**
 * Drop JPEG APP1 (EXIF and XMP). GPS lives there.
 * The image data after the start-of-scan marker is kept.
 */
export function stripJpegExif(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      parts.push(bytes.subarray(offset));
      break;
    }
    const marker = bytes[offset + 1] ?? 0;
    if (marker === 0xd9) {
      parts.push(bytes.subarray(offset, offset + 2));
      break;
    }
    if (marker === 0xda) {
      parts.push(bytes.subarray(offset));
      break;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      parts.push(bytes.subarray(offset, offset + 2));
      offset += 2;
      continue;
    }
    if (offset + 3 >= bytes.length) break;
    const length = ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
    if (length < 2 || offset + 2 + length > bytes.length) {
      parts.push(bytes.subarray(offset));
      break;
    }
    if (marker !== 0xe1) parts.push(bytes.subarray(offset, offset + 2 + length));
    offset += 2 + length;
  }
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

export function jpegHasExifGps(bytes: Uint8Array): boolean {
  const text = new TextDecoder().decode(bytes);
  return text.includes('GPSLatitude') || text.includes('GPSLongitude') || text.includes('GPSInfo');
}
