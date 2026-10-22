// Fails if an exported JS bundle or an unpacked APK contains a service role or a seed login.
import fs from 'node:fs';
import path from 'node:path';

const forbidden = [
  'service_role',
  'owner@sitepack.test',
  'cm@sitepack.test',
  'amy@sitepack.test',
  'ben@sitepack.test',
  'chris@sitepack.test',
  'SitePack123!',
];

const root = path.resolve(process.argv[2] ?? '');
if (!root || !fs.existsSync(root)) {
  console.error('Pass the exported bundle directory or the unpacked APK directory.');
  process.exit(1);
}

const hits = [];
const maxBytes = 50_000_000;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(full);
    if (stat.size > maxBytes) continue;
    const bytes = fs.readFileSync(full);
    const utf8 = bytes.toString('utf8');
    const latin1 = bytes.toString('latin1');
    const utf16 = bytes.toString('utf16le');
    for (const word of forbidden) {
      if (utf8.includes(word) || latin1.includes(word) || utf16.includes(word)) {
        hits.push(`${full}: ${word}`);
      }
    }
  }
}

walk(root);

if (hits.length > 0) {
  console.error('JS bundle contains service_role or a seed login:');
  for (const hit of hits) console.error(hit);
  process.exit(1);
}

console.log('JS bundle has no service_role and no seed logins.');
