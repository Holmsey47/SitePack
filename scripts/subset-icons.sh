#!/bin/sh
# Rebuild assets/fonts/MaterialSymbolsRounded.ttf from the glyph list.
# The face is ligature-based (rlig). pyftsubset keeps those rules only when
# layout closure is off and both the icon glyphs and their letter parts are named.
# Requires: pip install fonttools
set -eu
cd "$(dirname "$0")/.."

if ! command -v pyftsubset >/dev/null 2>&1; then
  echo "pyftsubset is not on PATH. Install it with: pip install fonttools" >&2
  exit 1
fi

FONT=assets/fonts/MaterialSymbolsRounded.ttf
LIST=assets/fonts/MaterialSymbols-glyphs.txt
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

python3 - "$LIST" "$WORK/glyphs.txt" << 'PY'
import sys
from pathlib import Path

src, dest = sys.argv[1:]
digits = (
    "digit_zero",
    "digit_one",
    "digit_two",
    "digit_three",
    "digit_four",
    "digit_five",
    "digit_six",
    "digit_seven",
    "digit_eight",
    "digit_nine",
)
names = []
for line in Path(src).read_text().splitlines():
    name = line.split("#", 1)[0].strip()
    if name:
        names.append(name)
if not names:
    raise SystemExit("glyph list is empty")
parts = {".notdef", "space", "underscore"}
parts.update("abcdefghijklmnopqrstuvwxyz")
for name in names:
    for char in name:
        if char == "_":
            parts.add("underscore")
        elif char.isdigit():
            parts.add(digits[int(char)])
        elif char.isascii() and char.isalpha() and char.islower():
            parts.add(char)
        else:
            raise SystemExit(f"unsupported character {char!r} in {name}")
Path(dest).write_text("\n".join(names) + "\n" + "\n".join(sorted(parts)) + "\n")
print(f"{len(names)} icons")
PY

BEFORE=$(wc -c < "$FONT" | tr -d ' ')
pyftsubset "$FONT" \
  --glyphs-file="$WORK/glyphs.txt" \
  --no-layout-closure \
  --layout-features=rlig \
  --glyph-names \
  --notdef-glyph \
  --notdef-outline \
  --recommended-glyphs \
  --name-IDs='*' \
  --name-legacy \
  --name-languages='*' \
  --output-file="$WORK/MaterialSymbolsRounded.ttf"

python3 - "$LIST" "$WORK/MaterialSymbolsRounded.ttf" << 'PY'
import sys
from pathlib import Path
from fontTools.ttLib import TTFont

list_path, font_path = sys.argv[1:]
digits = (
    "digit_zero",
    "digit_one",
    "digit_two",
    "digit_three",
    "digit_four",
    "digit_five",
    "digit_six",
    "digit_seven",
    "digit_eight",
    "digit_nine",
)
names = [
    line.split("#", 1)[0].strip()
    for line in Path(list_path).read_text().splitlines()
    if line.split("#", 1)[0].strip()
]
font = TTFont(font_path)
order = set(font.getGlyphOrder())
missing = [name for name in names if name not in order]
if missing:
    raise SystemExit("missing glyphs: " + ", ".join(missing))

def components(name):
    out = []
    for char in name:
        if char == "_":
            out.append("underscore")
        elif char.isdigit():
            out.append(digits[int(char)])
        else:
            out.append(char)
    return out

rules = {}
gsub = font["GSUB"].table
for lookup in gsub.LookupList.Lookup:
    subtables = lookup.SubTable
    for sub in subtables:
        inner = getattr(sub, "ExtSubTable", sub)
        ligatures = getattr(inner, "ligatures", None)
        if not ligatures:
            continue
        for first, records in ligatures.items():
            for record in records:
                sequence = (first, *record.Component)
                rules[sequence] = record.LigGlyph

failed = []
for name in names:
    sequence = tuple(components(name))
    if rules.get(sequence) != name:
        failed.append(name)
if failed:
    raise SystemExit("ligatures did not resolve: " + ", ".join(failed))
print(f"glyphs {len(order)}")
print(f"bytes {Path(font_path).stat().st_size}")
PY

mv "$WORK/MaterialSymbolsRounded.ttf" "$FONT"
AFTER=$(wc -c < "$FONT" | tr -d ' ')
echo "MaterialSymbolsRounded.ttf $BEFORE -> $AFTER bytes"
