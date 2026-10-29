// Fails if an exported JS bundle or an unpacked APK contains a secret or a seed login.
// Findings name the file and offset. They never include the matched secret.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const forbidden = [
  'service_role',
  'owner@sitepack.test',
  'cm@sitepack.test',
  'amy@sitepack.test',
  'ben@sitepack.test',
  'chris@sitepack.test',
  'SitePack123!',
  'sitepack.dev.forceOffline',
];

const maxBytes = 50_000_000;
const jwtPattern = /[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
// A real sb_secret_ value has a long suffix and a digit. The Hermes string
// table packs the SDK's "sb_secret_" prefix against the next identifier, which
// is letters, underscores, and hyphens with no digit.
const secretKeyPattern = /sb_secret_(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{20,}/g;
const pemPattern = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY-----/g;

export function inspectBundleText(text) {
  const findings = [];
  for (const word of forbidden) {
    let from = 0;
    while (from <= text.length) {
      const at = text.indexOf(word, from);
      if (at < 0) break;
      findings.push({ offset: at, kind: 'literal', detail: word });
      from = at + word.length;
    }
  }
  for (const match of text.matchAll(jwtPattern)) {
    const problem = jwtProblem(match[0]);
    if (!problem) continue;
    findings.push({ offset: match.index ?? 0, kind: 'jwt', detail: problem });
  }
  for (const match of text.matchAll(secretKeyPattern)) {
    findings.push({ offset: match.index ?? 0, kind: 'sb_secret', detail: 'sb_secret key' });
  }
  for (const match of text.matchAll(pemPattern)) {
    findings.push({ offset: match.index ?? 0, kind: 'pem', detail: 'private key block' });
  }
  return findings;
}

function jwtProblem(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let decoded = '';
  try {
    decoded = Buffer.from(parts[1], 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.prototype.hasOwnProperty.call(payload, 'role')) {
      return null;
    }
    if (payload.role === 'anon') return null;
    return 'jwt role is not anon';
  } catch {
    if (/"role"\s*:/.test(decoded)) return 'undecodable jwt with a role claim';
    return null;
  }
}

export function formatFinding(file, finding) {
  return `${file}: offset ${finding.offset}: ${finding.detail}`;
}

export function scanDirectory(root) {
  const lines = [];
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
      const seen = new Set();
      for (const text of [bytes.toString('latin1'), bytes.toString('utf16le')]) {
        for (const finding of inspectBundleText(text)) {
          const line = formatFinding(full, finding);
          if (seen.has(line)) continue;
          seen.add(line);
          lines.push(line);
        }
      }
    }
  }
  walk(root);
  return lines;
}

function main() {
  const root = path.resolve(process.argv[2] ?? '');
  if (!root || !fs.existsSync(root)) {
    console.error('Pass the exported bundle directory or the unpacked APK directory.');
    process.exit(1);
  }
  const hits = scanDirectory(root);
  if (hits.length > 0) {
    console.error('JS bundle contains a secret or a seed login:');
    for (const hit of hits) console.error(hit);
    process.exit(1);
  }
  console.log('JS bundle has no service_role, secret key, private key, or seed login.');
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) main();
