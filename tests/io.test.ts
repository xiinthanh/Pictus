import { describe, expect, it } from 'vitest';
import { VoxelGrid } from '../src/lib/core/grid';
import { DEFAULT_IMAGE_OPTIONS, fitSize, imageToModel, quantize, resizeNearest } from '../src/lib/core/io/image';
import { decodePictus, encodePictus } from '../src/lib/core/io/pictus';
import { readVox, writeVox } from '../src/lib/core/io/vox';
import { randomGrid } from './helpers';

describe('.pictus', () => {
  it('round-trips voxels, palette and voxel size', () => {
    const grid = randomGrid(7, 20, 0.3, 5);
    const palette = [0, 1, 2, 3, 4, 0xabcdef];
    const m = decodePictus(encodePictus({ grid, palette, voxelSize: 0.5 }));
    expect([m.grid.sx, m.grid.sy, m.grid.sz]).toEqual([20, 20, 20]);
    expect(m.grid.data).toEqual(grid.data);
    expect(m.palette).toEqual(palette);
    expect(m.voxelSize).toBe(0.5);
  });

  it('rejects garbage', () => {
    expect(() => decodePictus(new Uint8Array(40))).toThrow(/Not a valid Pictus file/);
  });
});

describe('.vox', () => {
  it('round-trips through MagicaVoxel format', () => {
    const grid = randomGrid(3, 10, 0.4, 4);
    const palette = [0, 0x112233, 0x445566, 0x778899, 0xaabbcc];
    const { model, warnings } = readVox(writeVox({ grid, palette, voxelSize: 1 }));
    expect(warnings).toEqual([]);
    // Palette is compacted to used colors, so compare colors rather than indices.
    for (let i = 0; i < grid.data.length; i++) {
      const a = grid.data[i], b = model.grid.data[i];
      expect(a === 0 ? 0 : palette[a]).toBe(b === 0 ? 0 : model.palette[b]);
    }
  });

  it('rejects non-vox files', () => {
    expect(() => readVox(new Uint8Array(100))).toThrow();
  });
});

describe('image import', () => {
  // 3×2 image: red, transparent, blue / green, green, green
  const px = new Uint8Array([
    255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255,
    0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255,
  ]);

  it('extrudes opaque pixels with the top row at the top', () => {
    const m = imageToModel(px, 3, 2, { ...DEFAULT_IMAGE_OPTIONS, plateThickness: 0, depth: 3 });
    expect([m.grid.sx, m.grid.sy, m.grid.sz]).toEqual([3, 2, 3]);
    expect(m.grid.count()).toBe(5 * 3);
    expect(m.palette[m.grid.get(0, 1, 0)]).toBe(0xff0000); // top-left pixel → y = 1
    expect(m.grid.get(1, 1, 2)).toBe(0);
    expect(m.palette[m.grid.get(1, 0, 2)]).toBe(0x00ff00);
  });

  it('adds an outline plate with margin', () => {
    const m = imageToModel(px, 3, 2, { ...DEFAULT_IMAGE_OPTIONS, plateThickness: 1, depth: 1, margin: 1 });
    expect([m.grid.sx, m.grid.sy, m.grid.sz]).toEqual([5, 4, 2]);
    expect(m.grid.get(0, 0, 0)).toBe(1); // plate color is index 1
    expect(m.palette[1]).toBe(DEFAULT_IMAGE_OPTIONS.plateColor);
  });

  it('adds a keyring loop with a hole', () => {
    const m = imageToModel(px, 3, 2, { ...DEFAULT_IMAGE_OPTIONS, keyring: true });
    expect(m.grid.sy).toBeGreaterThan(4);
    const cx = Math.floor(m.grid.sx / 2);
    // Somewhere in the ring column there is a hole above solid ring material.
    let sawHole = false, sawRing = false;
    for (let y = 4; y < m.grid.sy; y++) {
      if (m.grid.get(cx, y, 0)) sawRing = true;
      else if (sawRing) sawHole = true;
    }
    expect(sawRing && sawHole).toBe(true);
  });

  it('quantizes to the color limit', () => {
    const counts = new Map<number, number>();
    for (let i = 0; i < 1000; i++) counts.set(i * 997, 1);
    const q = quantize(counts, 16);
    expect(new Set(q.values()).size).toBeLessThanOrEqual(16);
    expect(q.size).toBe(1000);
  });

  it('downscales large images to fit', () => {
    const s = fitSize(500, 250, { ...DEFAULT_IMAGE_OPTIONS, margin: 2 });
    expect(s.w).toBeLessThanOrEqual(124);
    expect(Math.abs(s.w / s.h - 2)).toBeLessThan(0.05);
    expect(resizeNearest(new Uint8Array(4 * 4 * 4).fill(9), 4, 4, 2, 2)).toHaveLength(16);
  });

  it('rejects empty images', () => {
    expect(() => imageToModel(new Uint8Array(16), 2, 2, DEFAULT_IMAGE_OPTIONS)).toThrow();
  });
});

describe('grid helpers used by import', () => {
  it('keeps VoxelGrid data shared with typed arrays', () => {
    const g = new VoxelGrid(2, 2, 2, new Uint8Array(8).fill(1));
    expect(g.count()).toBe(8);
  });
});
