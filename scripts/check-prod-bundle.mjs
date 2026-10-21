// Fails if a production web export still contains fixture seed secrets.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('dist');
const forbidden = [
  'owner@sitepack.test',
  'cm@sitepack.test',
  'amy@sitepack.test',
  'ben@sitepack.test',
  'chris@sitepack.test',
  'SitePack123!',
];

if (!fs.existsSync(root)) {
  console.error('dist/ is missing. Run the production web export first.');
  process.exit(1);
}

const hits = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
      continue;
    }
    if (!/\.(js|html|json|css|map|txt)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    for (const word of forbidden) {
      if (text.includes(word)) hits.push(`${full}: ${word}`);
    }
  }
}

walk(root);

if (hits.length > 0) {
  console.error('Production bundle contains seed credentials:');
  for (const hit of hits) console.error(hit);
  process.exit(1);
}

console.log('Production bundle has no seed emails or seed password.');
