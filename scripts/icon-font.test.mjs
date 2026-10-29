import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

const MAC_GLYPHS = `
.notdef
.null
nonmarkingreturn
space
exclam
quotedbl
numbersign
dollar
percent
ampersand
quotesingle
parenleft
parenright
asterisk
plus
comma
hyphen
period
slash
zero
one
two
three
four
five
six
seven
eight
nine
colon
semicolon
less
equal
greater
question
at
A
B
C
D
E
F
G
H
I
J
K
L
M
N
O
P
Q
R
S
T
U
V
W
X
Y
Z
bracketleft
backslash
bracketright
asciicircum
underscore
grave
a
b
c
d
e
f
g
h
i
j
k
l
m
n
o
p
q
r
s
t
u
v
w
x
y
z
braceleft
bar
braceright
asciitilde
Adieresis
Aring
Ccedilla
Eacute
Ntilde
Odieresis
Udieresis
aacute
agrave
acircumflex
adieresis
atilde
aring
ccedilla
eacute
egrave
ecircumflex
edieresis
iacute
igrave
icircumflex
idieresis
ntilde
oacute
ograve
ocircumflex
odieresis
otilde
uacute
ugrave
ucircumflex
udieresis
dagger
degree
cent
sterling
section
bullet
paragraph
germandbls
registered
copyright
trademark
acute
dieresis
notequal
AE
Oslash
infinity
plusminus
lessequal
greaterequal
yen
mu
partialdiff
summation
product
pi
integral
ordfeminine
ordmasculine
Omega
ae
oslash
questiondown
exclamdown
logicalnot
radical
florin
approxequal
Delta
guillemotleft
guillemotright
ellipsis
nonbreakingspace
Agrave
Atilde
Otilde
OE
oe
endash
emdash
quotedblleft
quotedblright
quoteleft
quoteright
divide
lozenge
ydieresis
Ydieresis
fraction
currency
guilsinglleft
guilsinglright
fi
fl
daggerdbl
periodcentered
quotesinglbase
quotedblbase
perthousand
Acircumflex
Ecircumflex
Aacute
Edieresis
Egrave
Iacute
Icircumflex
Idieresis
Igrave
Oacute
Ocircumflex
apple
Ograve
Uacute
Ucircumflex
Ugrave
dotlessi
circumflex
tilde
macron
breve
dotaccent
ring
cedilla
hungarumlaut
ogonek
caron
Lslash
lslash
Scaron
scaron
Zcaron
zcaron
brokenbar
Eth
eth
Yacute
yacute
Thorn
thorn
minus
multiply
onesuperior
twosuperior
threesuperior
onehalf
onequarter
threequarters
franc
Gbreve
gbreve
Idotaccent
Scedilla
scedilla
Cacute
cacute
Ccaron
ccaron
dcroat
`.trim().split('\n');

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

function iconUsage() {
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
  return { aliases, used };
}

function u16(buf, offset) {
  return buf.readUInt16BE(offset);
}

function u32(buf, offset) {
  return buf.readUInt32BE(offset);
}

function tableMap(buf) {
  const count = u16(buf, 4);
  const tables = new Map();
  for (let index = 0; index < count; index += 1) {
    const at = 12 + index * 16;
    tables.set(buf.toString('latin1', at, at + 4), { offset: u32(buf, at + 8), length: u32(buf, at + 12) });
  }
  return tables;
}

function glyphNames(buf) {
  const post = tableMap(buf).get('post');
  assert.ok(post, 'post table');
  assert.equal(u32(buf, post.offset), 0x00020000);
  const numGlyphs = u16(buf, post.offset + 32);
  const indexAt = post.offset + 34;
  const indexes = [];
  for (let index = 0; index < numGlyphs; index += 1) indexes.push(u16(buf, indexAt + index * 2));
  let cursor = indexAt + numGlyphs * 2;
  const customCount = Math.max(0, Math.max(...indexes) - 257);
  const custom = [];
  for (let index = 0; index < customCount; index += 1) {
    const length = buf[cursor];
    custom.push(buf.toString('latin1', cursor + 1, cursor + 1 + length));
    cursor += 1 + length;
  }
  return indexes.map((index) => (index < 258 ? MAC_GLYPHS[index] : custom[index - 258]));
}

function coverageGlyphs(buf, at) {
  const format = u16(buf, at);
  if (format === 1) {
    const count = u16(buf, at + 2);
    return Array.from({ length: count }, (_, index) => u16(buf, at + 4 + index * 2));
  }
  if (format === 2) {
    const count = u16(buf, at + 2);
    const ids = [];
    for (let index = 0; index < count; index += 1) {
      const record = at + 4 + index * 6;
      const start = u16(buf, record);
      const end = u16(buf, record + 2);
      for (let glyph = start; glyph <= end; glyph += 1) ids.push(glyph);
    }
    return ids;
  }
  throw new Error(`coverage format ${format}`);
}

function ligatureRules(buf, names) {
  const gsub = tableMap(buf).get('GSUB');
  assert.ok(gsub, 'GSUB table');
  const base = gsub.offset;
  const lookupList = base + u16(buf, base + 8);
  const lookupCount = u16(buf, lookupList);
  const rules = new Map();
  for (let index = 0; index < lookupCount; index += 1) {
    const lookup = lookupList + u16(buf, lookupList + 2 + index * 2);
    const lookupType = u16(buf, lookup);
    const flag = u16(buf, lookup + 2);
    const subCount = u16(buf, lookup + 4);
    let cursor = lookup + 6;
    if (flag & 0x10) cursor += 2;
    const subOffsets = [];
    for (let subIndex = 0; subIndex < subCount; subIndex += 1) {
      subOffsets.push(u16(buf, cursor));
      cursor += 2;
    }
    for (const relative of subOffsets) {
      let sub = lookup + relative;
      let subType = lookupType;
      if (subType === 7) {
        assert.equal(u16(buf, sub), 1);
        subType = u16(buf, sub + 2);
        sub = sub + u32(buf, sub + 4);
      }
      if (subType !== 4) continue;
      assert.equal(u16(buf, sub), 1);
      const firsts = coverageGlyphs(buf, sub + u16(buf, sub + 2));
      const setCount = u16(buf, sub + 4);
      assert.equal(firsts.length, setCount);
      for (let setIndex = 0; setIndex < setCount; setIndex += 1) {
        const set = sub + u16(buf, sub + 6 + setIndex * 2);
        const ligatureCount = u16(buf, set);
        for (let ligatureIndex = 0; ligatureIndex < ligatureCount; ligatureIndex += 1) {
          const ligature = set + u16(buf, set + 2 + ligatureIndex * 2);
          const ligGlyph = u16(buf, ligature);
          const componentCount = u16(buf, ligature + 2);
          const sequence = [names[firsts[setIndex]]];
          for (let component = 0; component < componentCount - 1; component += 1) {
            sequence.push(names[u16(buf, ligature + 4 + component * 2)]);
          }
          rules.set(sequence.join(' '), names[ligGlyph]);
        }
      }
    }
  }
  return rules;
}

const DIGITS = [
  'digit_zero',
  'digit_one',
  'digit_two',
  'digit_three',
  'digit_four',
  'digit_five',
  'digit_six',
  'digit_seven',
  'digit_eight',
  'digit_nine',
];

function components(name) {
  return [...name].map((char) => {
    if (char === '_') return 'underscore';
    if (char >= '0' && char <= '9') return DIGITS[Number(char)];
    return char;
  });
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
  assert.ok(script.indexOf('pyftsubset') < script.indexOf('instantiateVariableFont'));
  assert.match(script, /\{"FILL": 0, "GRAD": 0, "opsz": 24, "wght": 400\}/);

  const { aliases, used } = iconUsage();
  assert.ok(used.has('inbox'));
  assert.ok(used.has('report-problem'));
  const missing = [...used].map((name) => aliases[name] ?? name).filter((name) => !names.includes(name));
  assert.deepEqual(missing, []);
});

test('the committed Material Symbols face is static and every icon ligature resolves', () => {
  const font = fs.readFileSync(path.join(root, 'assets/fonts/MaterialSymbolsRounded.ttf'));
  const tags = [...tableMap(font).keys()];
  for (const tag of ['fvar', 'gvar', 'STAT', 'avar', 'HVAR']) {
    assert.equal(tags.includes(tag), false, tag);
  }
  assert.ok(tags.includes('GSUB'));
  assert.ok(tags.includes('glyf'));

  const names = glyphNames(font);
  const rules = ligatureRules(font, names);
  const { aliases, used } = iconUsage();
  const unresolved = [];
  for (const name of used) {
    const glyph = aliases[name] ?? name;
    if (rules.get(components(glyph).join(' ')) !== glyph) unresolved.push(name);
  }
  assert.deepEqual(unresolved, []);
});

test('a font load error is logged and Text.defaultProps is not mutated', () => {
  const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  const fonts = fs.readFileSync(path.join(root, 'src/theme/fonts.ts'), 'utf8');
  const tokens = fs.readFileSync(path.join(root, 'src/theme/tokens.ts'), 'utf8');
  assert.equal(layout.includes('defaultProps'), false);
  assert.match(fonts, /useFonts\(/);
  assert.match(fonts, /console\.warn\(/);
  assert.match(fonts, /Continuing with the system font/);
  assert.doesNotMatch(fonts, /throw error/);
  assert.doesNotMatch(layout, /throw fontError/);
  assert.match(layout, /SplashScreen\.hideAsync\(\)/);
  assert.match(layout, /fontError != null/);
  assert.equal(tokens.includes('fontWeight'), false);
  assert.doesNotMatch(layout, /fontFamily:\s*fontFamily\.bold,\s*fontWeight/);
});
