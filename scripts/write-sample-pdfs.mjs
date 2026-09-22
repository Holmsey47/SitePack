import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const COMPANY = '11111111-1111-1111-1111-111111111111';
const OAK = '66666666-6666-6666-6666-666666666666';
const WAREHOUSE = '88888888-8888-8888-8888-888888888888';

const files = [
  {
    id: '99999999-9999-9999-9999-999999999991',
    site: OAK,
    title: 'Ground Floor GA',
    revision: 'B',
    dated: '2026-08-02',
  },
  {
    id: '99999999-9999-9999-9999-999999999992',
    site: OAK,
    title: 'Ground Floor GA',
    revision: 'C',
    dated: '2026-09-10',
  },
  {
    id: '99999999-9999-9999-9999-999999999993',
    site: OAK,
    title: 'First Floor GA',
    revision: 'A',
    dated: '2026-09-04',
  },
  {
    id: '99999999-9999-9999-9999-999999999994',
    site: WAREHOUSE,
    title: 'Compound Layout',
    revision: 'A',
    dated: '2026-09-12',
  },
];

function makePdf(title, revision, dated) {
  const line1 = String(title).replace(/[()\\]/g, ' ');
  const line2 = `Rev ${revision}  ${dated}  SITEPACK`;
  const stream = [
    'BT',
    '/F1 22 Tf',
    '72 720 Td',
    `(${line1}) Tj`,
    '0 -32 Td',
    '/F1 16 Tf',
    `(${line2}) Tj`,
    '0 -28 Td',
    '(Current pack sample) Tj',
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
  return body;
}

for (const file of files) {
  const rel = join('supabase', 'seed-files', 'drawings', COMPANY, file.site, `${file.id}.pdf`);
  mkdirSync(dirname(rel), { recursive: true });
  writeFileSync(rel, makePdf(file.title, file.revision, file.dated));
}

console.log(`Wrote ${files.length} sample PDFs under supabase/seed-files/drawings`);
