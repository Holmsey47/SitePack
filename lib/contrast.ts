function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const normalized = hex.replace('#', '');
  const raw = Number.parseInt(normalized, 16);
  const red = channel((raw >> 16) & 255);
  const green = channel((raw >> 8) & 255);
  const blue = channel(raw & 255);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** WCAG relative contrast. 1 is identical. Body text needs 4.5. */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
