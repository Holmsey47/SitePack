import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function glyphList() {
  return fs
    .readFileSync(path.join(root, 'assets/fonts/MaterialSymbols-glyphs.txt'), 'utf8')
    .split('\n')
    .map((line) => line.replace(/#.*/, '').trim())
    .filter(Boolean);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

test('Material Symbols keeps the Apache licence and only the icons the app draws', () => {
  const license = fs.readFileSync(path.join(root, 'assets/fonts/MaterialSymbols-LICENSE.txt'), 'utf8');
  assert.match(license, /Copyright 2026 Google LLC/);
  assert.match(license, /Apache License/);
  assert.match(license, /Version 2\.0, January 2004/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);

  const names = glyphList();
  assert.ok(names.includes('inbox'));
  assert.ok(names.includes('inventory_2'));
  assert.ok(names.includes('download'));

  const font = fs.readFileSync(path.join(root, 'assets/fonts/MaterialSymbolsRounded.ttf'));
  assert.ok(font.length < 200_000, `font is ${font.length} bytes`);
  for (const name of names) {
    assert.ok(font.includes(Buffer.from(name)), name);
  }

  const script = fs.readFileSync(path.join(root, 'scripts/subset-icons.sh'), 'utf8');
  assert.match(script, /pyftsubset/);
  assert.match(script, /--no-layout-closure/);
  assert.match(script, /--layout-features=rlig/);

  const aliases = {
    'report-problem': 'report',
    'compare-arrows': 'compare_arrows',
    'chevron-right': 'chevron_right',
    'file-download': 'download',
  };
  const used = new Set();
  const files = [
    ...walk(path.join(root, 'app')),
    ...walk(path.join(root, 'src')),
    ...walk(path.join(root, 'components')),
    path.join(root, 'data/siteListSeen.ts'),
  ];
  for (const file of files) {
    if (file.endsWith(`${path.sep}icon-symbol.tsx`) || file.endsWith(`${path.sep}icon-symbol.ios.tsx`)) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bicon\s*[:=]\s*['"]([a-z0-9_-]+)['"]/g)) used.add(match[1]);
    for (const match of source.matchAll(/<Icon\b[^>]*\bname=["']([a-z0-9_-]+)["']/g)) used.add(match[1]);
    for (const match of source.matchAll(/<Icon\b[^>]*\bname=\{([^}\n]*)\}/g)) {
      for (const inner of match[1].matchAll(/['"]([a-z0-9_-]+)['"]/g)) used.add(inner[1]);
    }
  }
  const iconSource = fs.readFileSync(path.join(root, 'components/icon.tsx'), 'utf8');
  for (const match of iconSource.matchAll(/'([a-z0-9_-]+)':\s*'([a-z0-9_]+)'/g)) {
    aliases[match[1]] = match[2];
    used.add(match[1]);
  }
  assert.ok(used.has('inbox'));
  assert.ok(used.has('report-problem'));
  const missing = [...used]
    .map((name) => aliases[name] ?? name)
    .filter((name) => !names.includes(name));
  assert.deepEqual(missing, []);
});
