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

const vercelPath = path.join(root, 'vercel.json');
if (!fs.existsSync(vercelPath)) {
  console.error('dist/vercel.json is missing.');
  process.exit(1);
}

const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
const rewrites = Array.isArray(vercel.rewrites) ? vercel.rewrites : [];
const headers = Array.isArray(vercel.headers) ? vercel.headers : [];
const hasVendor = rewrites.some(
  (rule) => rule.source === '/assets/node_modules/(.*)' && rule.destination === '/assets/vendor_modules/$1'
);
const hasSpa = rewrites.some((rule) => rule.source === '/(.*)' && rule.destination === '/index.html');
const hasReferrer = headers.some(
  (rule) =>
    rule.source === '/(.*)' &&
    Array.isArray(rule.headers) &&
    rule.headers.some((header) => header.key === 'Referrer-Policy' && header.value === 'no-referrer')
);

if (!hasVendor || !hasSpa || !hasReferrer) {
  console.error('dist/vercel.json needs the SPA rewrites and Referrer-Policy: no-referrer on /(*).');
  process.exit(1);
}

console.log('Production bundle has no seed emails or seed password.');
console.log('dist/vercel.json has the SPA rewrites and Referrer-Policy.');
