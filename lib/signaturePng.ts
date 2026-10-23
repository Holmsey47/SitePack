export type SignaturePoint = { x: number; y: number };
export type SignatureStroke = SignaturePoint[];

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i] ?? 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + (bytes[i] ?? 0)) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new Uint8Array(type.split('').map((char) => char.charCodeAt(0)));
  const body = new Uint8Array(name.length + data.length);
  body.set(name, 0);
  body.set(data, name.length);
  const out = new Uint8Array(12 + data.length);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 8 + data.length);
  return out;
}

function storedDeflate(data: Uint8Array): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (let offset = 0; offset < data.length || offset === 0; offset += 65535) {
    const slice = data.subarray(offset, Math.min(data.length, offset + 65535));
    const final = offset + 65535 >= data.length;
    const block = new Uint8Array(5 + slice.length);
    block[0] = final ? 1 : 0;
    block[1] = slice.length & 255;
    block[2] = (slice.length >>> 8) & 255;
    block[3] = block[1] ^ 255;
    block[4] = block[2] ^ 255;
    block.set(slice, 5);
    blocks.push(block);
    if (data.length === 0) break;
  }
  const bodyLength = blocks.reduce((sum, block) => sum + block.length, 0);
  const zlib = new Uint8Array(2 + bodyLength + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let at = 2;
  for (const block of blocks) {
    zlib.set(block, at);
    at += block.length;
  }
  const checksum = adler32(data);
  zlib.set(u32(checksum), at);
  return zlib;
}

/** RGB PNG with no text chunks, so it cannot carry EXIF GPS. */
export function encodeRgbPng(width: number, height: number, rgb: Uint8Array): Uint8Array {
  if (width < 1 || height < 1 || rgb.length !== width * height * 3) {
    throw new Error('invalid_input');
  }
  const scan = new Uint8Array(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const dest = y * (1 + width * 3);
    scan[dest] = 0;
    scan.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), dest + 1);
  }
  const ihdr = new Uint8Array(13);
  ihdr.set(u32(width), 0);
  ihdr.set(u32(height), 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const parts = [
    new Uint8Array(PNG_SIGNATURE),
    chunk('IHDR', ihdr),
    chunk('IDAT', storedDeflate(scan)),
    chunk('IEND', new Uint8Array()),
  ];
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const png = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    png.set(part, offset);
    offset += part.length;
  }
  return png;
}

export function solidPng(width: number, height: number, rgb: [number, number, number]): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = rgb[0];
    pixels[i + 1] = rgb[1];
    pixels[i + 2] = rgb[2];
  }
  return encodeRgbPng(width, height, pixels);
}

function paint(pixels: Uint8Array, width: number, height: number, x: number, y: number) {
  const radius = 2;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx * dx + dy * dy > radius * radius + 1) continue;
      const px = Math.round(x + dx);
      const py = Math.round(y + dy);
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const at = (py * width + px) * 3;
      pixels[at] = 17;
      pixels[at + 1] = 17;
      pixels[at + 2] = 17;
    }
  }
}

function strokeLine(pixels: Uint8Array, width: number, height: number, from: SignaturePoint, to: SignaturePoint) {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y)));
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    paint(pixels, width, height, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
  }
}

export function rasterSignature(strokes: SignatureStroke[], width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  pixels.fill(255);
  for (const stroke of strokes) {
    if (stroke.length === 1) {
      const only = stroke[0];
      if (only) paint(pixels, width, height, only.x, only.y);
    }
    for (let i = 1; i < stroke.length; i += 1) {
      const from = stroke[i - 1];
      const to = stroke[i];
      if (from && to) strokeLine(pixels, width, height, from, to);
    }
  }
  return encodeRgbPng(width, height, pixels);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

export function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${bytesToBase64(bytes)}`;
}

export function strokesToPngDataUrl(strokes: SignatureStroke[], width = 320, height = 160): string {
  return pngDataUrl(rasterSignature(strokes, width, height));
}

export function dataUrlBytes(dataUrl: string): Uint8Array | null {
  const marker = 'base64,';
  const at = dataUrl.indexOf(marker);
  if (at < 0) return null;
  const payload = dataUrl.slice(at + marker.length);
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(payload, 'base64'));
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
