/** Colors as 0xRRGGBB. Index 0 is reserved for "empty"; usable colors are 1..255. */
export type Palette = number[];

export const MAX_COLORS = 255;

export const DEFAULT_PALETTE: Palette = [
  0x000000, // 0 = empty (unused)
  0xf5f5f5, 0x212121, 0x9e9e9e, 0xe53935, 0xfb8c00, 0xfdd835, 0x7cb342, 0x2e7d32,
  0x00acc1, 0x1e88e5, 0x3949ab, 0x8e24aa, 0xec407a, 0x6d4c41, 0xffccbc, 0xa1887f,
];

export function defaultPalette(): Palette {
  return DEFAULT_PALETTE.slice();
}

export function toCss(c: number): string {
  return '#' + (c & 0xffffff).toString(16).padStart(6, '0');
}

export function fromCss(s: string): number {
  return parseInt(s.replace('#', '').slice(0, 6), 16) & 0xffffff;
}

/** Perceived brightness 0..1, used to pick readable text over a swatch. */
export function luminance(c: number): number {
  return (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;
}
