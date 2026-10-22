"""SitePack launcher, adaptive icon, and splash. Regenerates the PNGs in assets/images."""

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / "assets" / "images"
BG = (18, 24, 32, 255)
GOLD = (232, 184, 74, 255)
FOLD = (244, 212, 154, 255)
INK = (26, 20, 4, 255)
WHITE = (255, 255, 255, 255)

# 5x7 glyphs. '#' is ink.
GLYPHS = {
    "S": [
        " ### ",
        "#   #",
        "#    ",
        " ### ",
        "    #",
        "#   #",
        " ### ",
    ],
    "P": [
        "#### ",
        "#   #",
        "#   #",
        "#### ",
        "#    ",
        "#    ",
        "#    ",
    ],
}


def new_canvas(size, color):
    return Image.new("RGBA", (size, size), color)


def glyph_boxes(size, scale):
    sheet = int(size * 0.46)
    left = (size - sheet) // 2
    top = (size - sheet) // 2
    letters = "SP"
    gap = scale
    glyph_w = 5 * scale
    block_w = glyph_w * 2 + gap
    origin_x = (size - block_w) // 2
    origin_y = top + int(sheet * 0.46)
    boxes = []
    for index, letter in enumerate(letters):
        ox = origin_x + index * (glyph_w + gap)
        for row, line in enumerate(GLYPHS[letter]):
            for col, pixel in enumerate(line):
                if pixel != "#":
                    continue
                x = ox + col * scale
                y = origin_y + row * scale
                pad = max(2, scale // 8)
                boxes.append((x, y, x + scale - pad, y + scale - pad))
    rule_y = top + int(sheet * 0.34)
    inset = int(sheet * 0.16)
    boxes.append((left + inset, rule_y, left + sheet - inset, rule_y + max(4, scale // 6)))
    return boxes


def draw_mark(base, color, ink, scale=28):
    size = base.size[0]
    draw = ImageDraw.Draw(base)
    # Keep the sheet inside the adaptive-icon safe zone (center 66%).
    sheet = int(size * 0.46)
    left = (size - sheet) // 2
    top = (size - sheet) // 2
    radius = int(sheet * 0.12)
    draw.rounded_rectangle((left, top, left + sheet, top + sheet), radius=radius, fill=color)
    fold = int(sheet * 0.22)
    corner = [
        (left + sheet - fold, top),
        (left + sheet, top + fold),
        (left + sheet - fold, top + fold),
    ]
    draw.polygon(corner, fill=FOLD if color == GOLD else ink)
    for box in glyph_boxes(size, scale):
        draw.rectangle(box, fill=ink)


def mono_mark(base, scale=26):
    draw_mark(base, WHITE, WHITE, scale)
    cut = Image.new("L", base.size, 0)
    cutter = ImageDraw.Draw(cut)
    for box in glyph_boxes(base.size[0], scale):
        cutter.rectangle(box, fill=255)
    red, green, blue, alpha = base.split()
    alpha = Image.frombytes("L", base.size, bytes(0 if mask else value for value, mask in zip(alpha.tobytes(), cut.tobytes())))
    base.putalpha(alpha)


def save(image, name):
    image.save(ROOT / name, "PNG")


def main():
    foreground = new_canvas(1024, (0, 0, 0, 0))
    draw_mark(foreground, GOLD, INK, 26)
    save(foreground, "android-icon-foreground.png")

    background = new_canvas(1024, BG)
    save(background, "android-icon-background.png")

    mono = new_canvas(1024, (0, 0, 0, 0))
    mono_mark(mono, 26)
    save(mono, "android-icon-monochrome.png")

    icon = new_canvas(1024, BG)
    draw_mark(icon, GOLD, INK, 26)
    save(icon, "icon.png")
    save(icon, "splash-icon.png")
    icon.resize((196, 196), Image.Resampling.LANCZOS).save(ROOT / "favicon.png", "PNG")

    # Launcher-sized preview for a visual check. Not shipped as its own asset.
    icon.resize((192, 192), Image.Resampling.LANCZOS).save("/tmp/sitepack-icon-48dp.png", "PNG")
    icon.resize((48, 48), Image.Resampling.NEAREST).save("/tmp/sitepack-icon-48.png", "PNG")


if __name__ == "__main__":
    main()
