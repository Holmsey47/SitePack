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
const spaSource = '/((?!\\.well-known/).*)';
const hasVendor = rewrites.some(
  (rule) => rule.source === '/assets/node_modules/(.*)' && rule.destination === '/assets/vendor_modules/$1'
);
const hasSpa = rewrites.some((rule) => rule.source === spaSource && rule.destination === '/index.html');
const swallowsWellKnown = rewrites.some((rule) => rule.source === '/(.*)' && rule.destination === '/index.html');
const hasReferrer = headers.some(
  (rule) =>
    rule.source === '/(.*)' &&
    Array.isArray(rule.headers) &&
    rule.headers.some((header) => header.key === 'Referrer-Policy' && header.value === 'no-referrer')
);
const hasAssetLinksType = headers.some(
  (rule) =>
    rule.source === '/.well-known/assetlinks.json' &&
    Array.isArray(rule.headers) &&
    rule.headers.some((header) => header.key === 'Content-Type' && header.value === 'application/json')
);

if (!hasVendor || !hasSpa || swallowsWellKnown || !hasReferrer || !hasAssetLinksType) {
  console.error(
    'dist/vercel.json needs the vendor rewrite, a SPA rewrite that excludes .well-known, Referrer-Policy: no-referrer, and Content-Type application/json for assetlinks.json.'
  );
  process.exit(1);
}

const assetPath = path.join(root, '.well-known/assetlinks.json');
if (!fs.existsSync(assetPath)) {
  console.error('dist/.well-known/assetlinks.json is missing.');
  process.exit(1);
}
const assetLinks = JSON.parse(fs.readFileSync(assetPath, 'utf8'));
const fingerprint =
  '83:C8:DD:E7:8A:3A:2B:A4:26:B6:CC:B4:DF:ED:CF:53:DC:DD:64:54:3C:28:11:A6:29:07:8F:07:49:16:57:B6';
const statement = Array.isArray(assetLinks)
  ? assetLinks.find(
      (row) =>
        Array.isArray(row.relation) &&
        row.relation.includes('delegate_permission/common.handle_all_urls') &&
        row.target?.namespace === 'android_app' &&
        row.target?.package_name === 'uk.sitepack.app' &&
        Array.isArray(row.target?.sha256_cert_fingerprints) &&
        row.target.sha256_cert_fingerprints.includes(fingerprint)
    )
  : null;
if (!statement) {
  console.error('dist/.well-known/assetlinks.json is missing uk.sitepack.app or the release fingerprint.');
  process.exit(1);
}

const roleHits = [];
function walkRoles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRoles(full);
      continue;
    }
    if (!/\.(js|html)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, 'utf8');
    if (text.includes('service_role')) roleHits.push(full);
  }
}
walkRoles(root);
if (roleHits.length > 0) {
  console.error('Production bundle contains service_role:');
  for (const hit of roleHits) console.error(hit);
  process.exit(1);
}

console.log('Production bundle has no seed emails, seed password, or service_role.');
console.log('dist/vercel.json excludes .well-known from the SPA rewrite and serves assetlinks.json as JSON.');
