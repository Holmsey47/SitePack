function escapePdfText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/[()]/g, ' ');
}

export function makePdfBytes(title: string, revision: string, dated: string): Uint8Array {
  const line1 = escapePdfText(title);
  const line2 = escapePdfText(`Rev ${revision}  ${dated}  CURRENT PACK`);
  const stream = [
    'BT',
    '/F1 22 Tf',
    '72 720 Td',
    `(${line1}) Tj`,
    '0 -32 Td',
    '/F1 16 Tf',
    `(${line2}) Tj`,
    '0 -28 Td',
    '(SitePack v0 — not a superseded sheet) Tj',
    'ET',
  ].join('\n');

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefPos = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) {
    xref += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  }
  body += xref;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return new TextEncoder().encode(body);
}

const blobUrls = new Map<string, string>();

export function pdfObjectUrl(drawingId: string, title: string, revision: string, dated: string): string {
  const existing = blobUrls.get(drawingId);
  if (existing) return existing;
  const bytes = makePdfBytes(title, revision, dated);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  blobUrls.set(drawingId, url);
  return url;
}
