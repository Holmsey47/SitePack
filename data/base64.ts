const TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const third = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const triple = (first << 16) | (second << 8) | third;
    out += TABLE[(triple >> 18) & 63];
    out += TABLE[(triple >> 12) & 63];
    out += index + 1 < bytes.length ? TABLE[(triple >> 6) & 63] : '=';
    out += index + 2 < bytes.length ? TABLE[triple & 63] : '=';
  }
  return out;
}
