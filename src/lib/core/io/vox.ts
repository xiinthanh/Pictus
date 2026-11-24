import type { Model } from '../editor';
import { MAX_DIM, VoxelGrid } from '../grid';

/*
 * MagicaVoxel .vox: "VOX " + version, then a MAIN chunk with SIZE / XYZI / RGBA children.
 * Chunk = id(4) + contentBytes(u32) + childrenBytes(u32) + content + children.
 * XYZI color index i (1..255) uses RGBA entry i-1. MagicaVoxel is Z-up, like Pictus.
 */

export interface VoxImport {
  model: Model;
  warnings: string[];
}

export function readVox(bytes: Uint8Array): VoxImport {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const id = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (bytes.length < 20 || id(0) !== 'VOX ') throw new Error('Not a MagicaVoxel .vox file');
  const warnings: string[] = [];
  let size: [number, number, number] | null = null;
  let xyzi: { o: number; n: number } | null = null;
  let rgba: number[] | null = null;
  let models = 0;

  // Walk all chunks flatly; MAIN's children follow its (empty) content.
  let o = 8;
  while (o + 12 <= bytes.length) {
    const cid = id(o);
    const content = view.getUint32(o + 4, true);
    const body = o + 12;
    if (cid === 'MAIN') {
      o = body + content;
      continue;
    }
    if (body + content > bytes.length) throw new Error('The .vox file is truncated');
    if (cid === 'SIZE') {
      models++;
      if (models === 1)
        size = [view.getUint32(body, true), view.getUint32(body + 4, true), view.getUint32(body + 8, true)];
    } else if (cid === 'XYZI' && !xyzi) {
      xyzi = { o: body + 4, n: view.getUint32(body, true) };
    } else if (cid === 'RGBA') {
      rgba = [];
      for (let i = 0; i < 255; i++) {
        const p = body + i * 4;
        rgba.push((bytes[p] << 16) | (bytes[p + 1] << 8) | bytes[p + 2]);
      }
    }
    o = body + content + view.getUint32(o + 8, true);
  }
  if (!size || !xyzi) throw new Error('The .vox file has no model');
  if (models > 1) warnings.push(`Only the first of ${models} models was imported.`);
  if (size.some((s) => s > MAX_DIM)) warnings.push(`The model was cropped to ${MAX_DIM}³ voxels.`);
  if (!rgba) {
    warnings.push('The file has no palette, so a grey ramp was used.');
    rgba = Array.from({ length: 255 }, (_, i) => {
      const g = 255 - i;
      return (g << 16) | (g << 8) | g;
    });
  }

  const [sx, sy, sz] = size.map((s) => Math.max(1, Math.min(MAX_DIM, s)));
  const grid = new VoxelGrid(sx, sy, sz);
  // Compact the palette to the colors actually used.
  const remap = new Map<number, number>();
  const palette = [0];
  if (xyzi.o + xyzi.n * 4 > bytes.length) throw new Error('The .vox file is truncated');
  for (let k = 0; k < xyzi.n; k++) {
    const p = xyzi.o + k * 4;
    const x = bytes[p],
      y = bytes[p + 1],
      z = bytes[p + 2],
      c = bytes[p + 3];
    if (c === 0 || !grid.isInBounds(x, y, z)) continue;
    let mapped = remap.get(c);
    if (mapped === undefined) {
      mapped = palette.length;
      palette.push(rgba[c - 1]);
      remap.set(c, mapped);
    }
    grid.set(x, y, z, mapped);
  }
  if (palette.length === 1) palette.push(0xf5f5f5);
  return { model: { grid, palette, voxelSize: 1 }, warnings };
}

export function writeVox(m: Model): Uint8Array {
  const { grid, palette } = m;
  const count = grid.count();
  const sizeChunk = 12 + 12;
  const xyziChunk = 12 + 4 + count * 4;
  const rgbaChunk = 12 + 256 * 4;
  const children = sizeChunk + xyziChunk + rgbaChunk;
  const out = new Uint8Array(8 + 12 + children);
  const view = new DataView(out.buffer);
  let o = 0;
  const tag = (s: string) => {
    for (let i = 0; i < 4; i++) out[o++] = s.charCodeAt(i);
  };
  const u32 = (v: number) => {
    view.setUint32(o, v, true);
    o += 4;
  };
  tag('VOX ');
  u32(150);
  tag('MAIN');
  u32(0);
  u32(children);
  tag('SIZE');
  u32(12);
  u32(0);
  u32(grid.sx);
  u32(grid.sy);
  u32(grid.sz);
  tag('XYZI');
  u32(4 + count * 4);
  u32(0);
  u32(count);
  for (let z = 0; z < grid.sz; z++)
    for (let y = 0; y < grid.sy; y++)
      for (let x = 0; x < grid.sx; x++) {
        const v = grid.data[grid.index(x, y, z)];
        if (!v) continue;
        out[o++] = x;
        out[o++] = y;
        out[o++] = z;
        out[o++] = v;
      }
  tag('RGBA');
  u32(256 * 4);
  u32(0);
  for (let i = 1; i <= 256; i++) {
    const c = i < palette.length ? palette[i] : 0;
    out[o++] = (c >> 16) & 255;
    out[o++] = (c >> 8) & 255;
    out[o++] = c & 255;
    out[o++] = 255;
  }
  return out;
}
