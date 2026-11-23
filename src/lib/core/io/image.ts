import type { Model } from '../editor';
import { MAX_DIM, VoxelGrid } from '../grid';
import { MAX_COLORS } from '../palette';

export interface ImageOptions {
  /** Height of the extruded pixels, in voxels. */
  depth: number;
  /** Base plate thickness in voxels (0 = no plate). */
  plateThickness: number;
  plateShape: 'outline' | 'rectangle';
  /** Border around the art, in voxels. */
  margin: number;
  plateColor: number;
  keyring: boolean;
}

export const DEFAULT_IMAGE_OPTIONS: ImageOptions = {
  depth: 2,
  plateThickness: 1,
  plateShape: 'outline',
  margin: 1,
  plateColor: 0x212121,
  keyring: false,
};

const RING_OUTER = 3.2;
const RING_INNER = 1.6;

/** Reduces pixel colors to at most `max` using median cut. Returns a color → palette-color map. */
export function quantize(counts: Map<number, number>, max: number): Map<number, number> {
  const colors = [...counts.keys()];
  if (colors.length <= max) return new Map(colors.map((c) => [c, c]));
  const ch = (c: number, k: number) => (c >> (16 - 8 * k)) & 255;
  let boxes: number[][] = [colors];
  while (boxes.length < max) {
    // Split the box with the widest channel range.
    let bi = -1, bk = 0, bRange = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (let k = 0; k < 3; k++) {
        let lo = 255, hi = 0;
        for (const c of box) { const v = ch(c, k); if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > bRange) { bRange = hi - lo; bi = i; bk = k; }
      }
    });
    if (bi < 0) break;
    const box = boxes[bi].sort((a, b) => ch(a, bk) - ch(b, bk));
    const total = box.reduce((s, c) => s + counts.get(c)!, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += counts.get(box[i])!;
      cut = i + 1;
      if (acc >= total / 2) break;
    }
    boxes = [...boxes.slice(0, bi), box.slice(0, cut), box.slice(cut), ...boxes.slice(bi + 1)];
  }
  const map = new Map<number, number>();
  for (const box of boxes) {
    let r = 0, g = 0, b = 0, n = 0;
    for (const c of box) {
      const w = counts.get(c)!;
      r += ch(c, 0) * w; g += ch(c, 1) * w; b += ch(c, 2) * w; n += w;
    }
    const avg = (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
    for (const c of box) map.set(c, avg);
  }
  return map;
}

/** Largest size (keeping aspect) at which an image fits the grid with the given options. */
export function fitSize(w: number, h: number, o: ImageOptions): { w: number; h: number } {
  const extra = 2 * o.margin;
  const ringRows = o.keyring ? Math.ceil(RING_OUTER * 2) : 0;
  const scale = Math.min(1, (MAX_DIM - extra) / w, (MAX_DIM - extra - ringRows) / h);
  return { w: Math.max(1, Math.floor(w * scale)), h: Math.max(1, Math.floor(h * scale)) };
}

/** Nearest-neighbour downscale of RGBA pixels. */
export function resizeNearest(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, nw: number, nh: number): Uint8Array {
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const s = (Math.floor(((y + 0.5) * h) / nh) * w + Math.floor(((x + 0.5) * w) / nw)) * 4;
      out.set(rgba.subarray(s, s + 4), (y * nw + x) * 4);
    }
  return out;
}

/**
 * Turns pixel art into a model: each opaque pixel becomes a column of voxels,
 * optionally on a base plate with a keyring loop. Image row 0 is the top (largest y).
 */
export function imageToModel(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number, o: ImageOptions): Model {
  const depth = Math.max(1, Math.round(o.depth));
  const plate = Math.max(0, Math.round(o.plateThickness));
  const margin = plate > 0 ? Math.max(0, Math.round(o.margin)) : 0;
  const opaque = (x: number, y: number) => rgba[(y * w + x) * 4 + 3] >= 128;
  const pixel = (x: number, y: number) => {
    const p = (y * w + x) * 4;
    return (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
  };

  const counts = new Map<number, number>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (opaque(x, y)) counts.set(pixel(x, y), (counts.get(pixel(x, y)) ?? 0) + 1);
  if (!counts.size) throw new Error('The image has no visible pixels');

  const palette = [0];
  let plateIndex = 0;
  if (plate > 0 || o.keyring) {
    palette.push(o.plateColor);
    plateIndex = 1;
  }
  const qmap = quantize(counts, MAX_COLORS - palette.length + 1);
  const colorIndex = new Map<number, number>();
  for (const [c, q] of qmap) {
    let idx = palette.indexOf(q);
    if (idx < 1) { idx = palette.length; palette.push(q); }
    colorIndex.set(c, idx);
  }
  if (!plateIndex) plateIndex = colorIndex.values().next().value!;

  const W = w + 2 * margin;
  const baseH = h + 2 * margin;
  // Plate footprint in grid coords (y up).
  const footprint = new Uint8Array(W * baseH);
  for (let gy = 0; gy < baseH; gy++)
    for (let gx = 0; gx < W; gx++) {
      if (o.plateShape === 'rectangle') { footprint[gy * W + gx] = 1; continue; }
      // Outline: any opaque pixel within `margin` (Chebyshev distance).
      search: for (let dy = -margin; dy <= margin; dy++)
        for (let dx = -margin; dx <= margin; dx++) {
          const px = gx - margin + dx, py = h - 1 - (gy - margin + dy);
          if (px >= 0 && py >= 0 && px < w && py < h && opaque(px, py)) { footprint[gy * W + gx] = 1; break search; }
        }
    }

  let ring: { cx: number; cy: number } | null = null;
  let H = baseH;
  if (o.keyring) {
    const cx = Math.floor(W / 2);
    let top = -1;
    for (let gy = baseH - 1; gy >= 0 && top < 0; gy--) if (footprint[gy * W + cx]) top = gy;
    if (top < 0) for (let gy = baseH - 1; gy >= 0 && top < 0; gy--) for (let gx = 0; gx < W; gx++) if (footprint[gy * W + gx]) { top = gy; break; }
    const cy = top + RING_OUTER - 0.5;
    ring = { cx: cx + 0.5, cy: cy + 0.5 };
    H = Math.max(baseH, Math.ceil(ring.cy + RING_OUTER));
  }
  const D = plate + depth;
  if (W > MAX_DIM || H > MAX_DIM || D > MAX_DIM) {
    throw new Error(`The result would be ${W}×${H}×${D}; the maximum is ${MAX_DIM} per side`);
  }

  const grid = new VoxelGrid(W, H, D);
  for (let gy = 0; gy < baseH; gy++)
    for (let gx = 0; gx < W; gx++) {
      if (!footprint[gy * W + gx]) continue;
      for (let z = 0; z < plate; z++) grid.set(gx, gy, z, plateIndex);
    }
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      if (!opaque(px, py)) continue;
      const c = colorIndex.get(pixel(px, py))!;
      const gx = px + margin, gy = h - 1 - py + margin;
      for (let z = plate; z < D; z++) grid.set(gx, gy, z, c);
    }
  if (ring) {
    const ringTop = plate > 0 ? plate : D;
    for (let gy = 0; gy < H; gy++)
      for (let gx = 0; gx < W; gx++) {
        const d = Math.hypot(gx + 0.5 - ring.cx, gy + 0.5 - ring.cy);
        const inHole = d < RING_INNER;
        if (inHole) {
          for (let z = 0; z < D; z++) grid.set(gx, gy, z, 0);
        } else if (d <= RING_OUTER) {
          for (let z = 0; z < ringTop; z++) if (!grid.get(gx, gy, z)) grid.set(gx, gy, z, plateIndex);
        }
      }
  }
  return { grid, palette, voxelSize: 1 };
}
