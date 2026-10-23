import zlib from 'node:zlib';

type PdfObject = { dict: string; stream: Buffer | null };

/** Read page text. Each embedded face has its own glyph ids, so a run is decoded with the font selected by Tf. */
export function decodedPdfText(bytes: Uint8Array): string {
  const objects = readPdfObjects(Buffer.from(bytes));
  const cmapById = new Map<number, Map<string, string>>();
  for (const [id, obj] of objects) {
    if (!obj.stream) continue;
    const text = obj.stream.toString('latin1');
    if (!text.includes('beginbfchar') && !text.includes('beginbfrange')) continue;
    cmapById.set(id, unicodeGlyphs(text));
  }
  const fontCmap = new Map<number, Map<string, string>>();
  for (const [id, obj] of objects) {
    const ref = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(obj.dict);
    if (!ref) continue;
    const map = cmapById.get(Number(ref[1]));
    if (map) fontCmap.set(id, map);
  }
  const parts: string[] = [];
  for (const obj of objects.values()) {
    if (!/\/Type\s*\/Page(?!s)/.test(obj.dict)) continue;
    const fontBlock = /\/Font\s*<<([\s\S]*?)>>/.exec(obj.dict)?.[1] ?? '';
    const fonts = new Map<string, Map<string, string>>();
    for (const ref of fontBlock.matchAll(/\/([^\s/<>[\]]+)\s+(\d+)\s+0\s+R/g)) {
      const map = fontCmap.get(Number(ref[2]));
      if (map && ref[1]) fonts.set(ref[1], map);
    }
    const ids: number[] = [];
    for (const match of obj.dict.matchAll(/\/Contents\s*(?:(\d+)\s+0\s+R|\[([\s\S]*?)\])/g)) {
      if (match[1]) ids.push(Number(match[1]));
      for (const id of match[2]?.matchAll(/(\d+)\s+0\s+R/g) ?? []) ids.push(Number(id[1]));
    }
    for (const id of ids) {
      const stream = objects.get(id)?.stream;
      if (stream) parts.push(decodeContent(stream.toString('latin1'), fonts));
    }
  }
  return parts.join('\n');
}

function readPdfObjects(raw: Buffer): Map<number, PdfObject> {
  const marker = raw.lastIndexOf('startxref');
  const xrefAt = Number(/startxref\s+(\d+)/.exec(raw.subarray(marker).toString('latin1'))?.[1]);
  const xref = readObjectAt(raw, xrefAt);
  if (!xref.stream) throw new Error('pdf xref missing');
  const widths = /\/W\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(xref.dict);
  const w = widths ? [Number(widths[1]), Number(widths[2]), Number(widths[3])] : [1, 3, 2];
  const indexBody = /\/Index\s*\[([\s\S]*?)\]/.exec(xref.dict)?.[1] ?? '';
  const indexNums = indexBody.trim().split(/\s+/).filter(Boolean).map(Number);
  const ranges: Array<{ start: number; count: number }> = [];
  if (indexNums.length >= 2 && indexNums.every((value) => Number.isFinite(value))) {
    for (let i = 0; i < indexNums.length; i += 2) ranges.push({ start: indexNums[i] ?? 0, count: indexNums[i + 1] ?? 0 });
  } else {
    const size = Number(/\/Size\s+(\d+)/.exec(xref.dict)?.[1] ?? 0);
    ranges.push({ start: 0, count: size });
  }
  const objects = new Map<number, PdfObject>();
  const entry = w[0] + w[1] + w[2];
  let cursor = 0;
  for (const range of ranges) {
    for (let i = 0; i < range.count; i += 1) {
      const at = cursor;
      cursor += entry;
      const type = w[0] ? readBe(xref.stream, at, w[0]) : 1;
      const field = readBe(xref.stream, at + w[0], w[1]);
      if (type === 1) objects.set(range.start + i, readObjectAt(raw, field));
    }
  }
  for (const obj of [...objects.values()]) {
    if (!obj.stream || !/\/Type\s*\/ObjStm/.test(obj.dict)) continue;
    const count = Number(/\/N\s+(\d+)/.exec(obj.dict)?.[1]);
    const first = Number(/\/First\s+(\d+)/.exec(obj.dict)?.[1]);
    if (!Number.isFinite(count) || !Number.isFinite(first)) continue;
    const header = obj.stream.subarray(0, first).toString('latin1').trim().split(/\s+/).map(Number);
    for (let i = 0; i < count; i += 1) {
      const id = header[i * 2];
      const offset = header[i * 2 + 1];
      if (id === undefined || offset === undefined) continue;
      const start = first + offset;
      const next = header[(i + 1) * 2 + 1];
      const end = next === undefined ? obj.stream.length : first + next;
      objects.set(id, { dict: obj.stream.subarray(start, end).toString('latin1'), stream: null });
    }
  }
  return objects;
}

function readObjectAt(raw: Buffer, offset: number): PdfObject {
  const dictStart = raw.indexOf('<<', offset);
  if (dictStart < 0) return { dict: '', stream: null };
  let depth = 0;
  let cursor = dictStart;
  for (; cursor < raw.length; cursor += 1) {
    if (raw[cursor] === 0x3c && raw[cursor + 1] === 0x3c) {
      depth += 1;
      cursor += 1;
      continue;
    }
    if (raw[cursor] === 0x3e && raw[cursor + 1] === 0x3e) {
      depth -= 1;
      cursor += 1;
      if (depth === 0) {
        cursor += 1;
        break;
      }
    }
  }
  const dict = raw.subarray(dictStart, cursor).toString('latin1');
  let after = cursor;
  while (raw[after] === 0x0d || raw[after] === 0x0a || raw[after] === 0x20) after += 1;
  if (raw.subarray(after, after + 6).toString('latin1') !== 'stream') return { dict, stream: null };
  let dataStart = after + 6;
  if (raw[dataStart] === 0x0d && raw[dataStart + 1] === 0x0a) dataStart += 2;
  else if (raw[dataStart] === 0x0a) dataStart += 1;
  const length = Number(/\/Length\s+(\d+)/.exec(dict)?.[1]);
  if (!Number.isFinite(length)) return { dict, stream: null };
  let stream: Buffer = raw.subarray(dataStart, dataStart + length);
  if (dict.includes('/FlateDecode')) stream = zlib.inflateSync(stream);
  return { dict, stream };
}

function readBe(buf: Buffer, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) value = (value << 8) | (buf[offset + index] ?? 0);
  return value;
}

function decodeContent(source: string, fonts: Map<string, Map<string, string>>): string {
  let glyphs = new Map<string, string>();
  let text = '';
  const pattern = /\/([A-Za-z0-9_.+-]+)\s+[0-9.]+\s+Tf|\[([\s\S]*?)\]\s*TJ|<([0-9A-Fa-f\s]+)>\s*Tj/g;
  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      glyphs = fonts.get(match[1]) ?? glyphs;
      continue;
    }
    const hexes = match[3] ? [match[3]] : [...(match[2]?.matchAll(/<([0-9A-Fa-f\s]+)>/g) ?? [])].map((item) => item[1] ?? '');
    for (const hex of hexes) text += decodePdfHex(hex.replace(/\s/g, ''), glyphs);
  }
  return text;
}

function unicodeGlyphs(source: string): Map<string, string> {
  const map = new Map<string, string>();
  const remember = (code: string, unicode: string) => {
    const point = parseInt(unicode, 16);
    if (!Number.isFinite(point)) return;
    map.set(code.toUpperCase().padStart(4, '0'), String.fromCodePoint(point));
  };
  for (const block of source.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const pair of block[1]?.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
      remember(pair[1] ?? '', pair[2] ?? '');
    }
  }
  for (const block of source.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const range of block[1]?.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) ?? []) {
      const start = parseInt(range[1] ?? '', 16);
      const end = parseInt(range[2] ?? '', 16);
      const dest = parseInt(range[3] ?? '', 16);
      if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(dest) || end < start || end - start > 512) continue;
      for (let code = start; code <= end; code += 1) {
        map.set(code.toString(16).toUpperCase().padStart(4, '0'), String.fromCodePoint(dest + (code - start)));
      }
    }
  }
  return map;
}

function decodePdfHex(hex: string, glyphs: Map<string, string>): string {
  if (glyphs.size > 0 && hex.length % 4 === 0) {
    let text = '';
    for (let index = 0; index < hex.length; index += 4) {
      const char = glyphs.get(hex.slice(index, index + 4).toUpperCase());
      if (!char) return Buffer.from(hex, 'hex').toString('latin1');
      text += char;
    }
    return text;
  }
  return Buffer.from(hex, 'hex').toString('latin1');
}
