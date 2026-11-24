import { describe, expect, it } from 'vitest';
import { Editor } from '../src/lib/core/editor';
import { VoxelGrid } from '../src/lib/core/grid';
import { raycast } from '../src/lib/core/raycast';
import { boxCells, floodFill, lineCells, mirrorCells } from '../src/lib/core/tools';

describe('VoxelGrid', () => {
  it('indexes and bounds-checks', () => {
    const g = new VoxelGrid(4, 5, 6);
    expect(g.index(3, 4, 5)).toBe(g.data.length - 1);
    expect(g.coords(g.index(1, 2, 3))).toEqual([1, 2, 3]);
    g.set(1, 2, 3, 7);
    expect(g.get(1, 2, 3)).toBe(7);
    expect(g.get(-1, 0, 0)).toBe(0);
    g.set(9, 9, 9, 1); // ignored
    expect(g.count()).toBe(1);
  });

  it('rejects invalid sizes', () => {
    expect(() => new VoxelGrid(0, 1, 1)).toThrow();
    expect(() => new VoxelGrid(129, 1, 1)).toThrow();
  });

  it('resizes keeping voxels that fit', () => {
    const g = new VoxelGrid(4, 4, 4);
    g.set(1, 1, 1, 2);
    g.set(3, 3, 3, 3);
    const r = g.resized(2, 2, 2);
    expect(r.get(1, 1, 1)).toBe(2);
    expect(r.count()).toBe(1);
  });
});

describe('Editor history', () => {
  it('undoes and redoes strokes as single steps', () => {
    const e = new Editor({ grid: new VoxelGrid(4, 4, 4), palette: [0, 0xff0000], voxelSize: 1 });
    e.beginStroke();
    e.apply([[0, 1]]);
    e.apply([
      [1, 1],
      [0, 1],
    ]);
    e.endStroke();
    e.fill([2, 3], 1);
    expect(e.grid.count()).toBe(4);
    e.undo();
    expect(e.grid.count()).toBe(2);
    e.undo();
    expect(e.grid.count()).toBe(0);
    expect(e.undo()).toBe(false);
    e.redo();
    expect(e.grid.count()).toBe(2);
    e.fill([5], 1); // new edit clears redo
    expect(e.redo()).toBe(false);
  });

  it('drops no-op strokes', () => {
    const e = new Editor();
    e.beginStroke();
    e.apply([[0, 1]]);
    e.apply([[0, 0]]);
    e.endStroke();
    expect(e.history.canUndo).toBe(false);
  });
});

describe('tools', () => {
  const g = new VoxelGrid(5, 4, 3);

  it('mirrors across enabled axes without duplicates', () => {
    expect(mirrorCells(g, [[0, 0, 0]], { x: true, y: false, z: false })).toEqual([
      [0, 0, 0],
      [4, 0, 0],
    ]);
    expect(mirrorCells(g, [[0, 0, 0]], { x: true, y: true, z: true })).toHaveLength(8);
    // Center column maps onto itself.
    expect(mirrorCells(g, [[2, 0, 0]], { x: true, y: false, z: false })).toEqual([[2, 0, 0]]);
  });

  it('flood fills a same-color region', () => {
    const f = new VoxelGrid(4, 4, 2);
    for (let x = 0; x < 3; x++) f.set(x, 0, 0, 1);
    f.set(0, 0, 1, 1);
    f.set(3, 3, 0, 1); // separate
    f.set(1, 1, 0, 2);
    expect(floodFill(f, [0, 0, 0]).sort((a, b) => a - b)).toEqual(
      [f.index(0, 0, 0), f.index(1, 0, 0), f.index(2, 0, 0), f.index(0, 0, 1)].sort((a, b) => a - b),
    );
    expect(floodFill(f, [0, 0, 0], 0)).toHaveLength(3); // layer only
    expect(floodFill(f, [3, 0, 1])).toEqual([]); // empty in 3D
    expect(floodFill(f, [3, 0, 1], 1)).toHaveLength(15); // empty within a layer
  });

  it('builds boxes and lines', () => {
    expect(boxCells(g, [3, 2, 1], [1, 1, 1])).toHaveLength(6);
    expect(boxCells(g, [-5, 0, 0], [0, 0, 0])).toHaveLength(1);
    expect(lineCells([0, 0, 2], [3, 1, 2])).toEqual([
      [0, 0, 2],
      [1, 0, 2],
      [2, 1, 2],
      [3, 1, 2],
    ]);
  });
});

describe('raycast', () => {
  const g = new VoxelGrid(8, 8, 8);
  g.set(3, 3, 0, 1);
  g.set(3, 3, 1, 1);

  it('hits the top face of a column from above', () => {
    const h = raycast(g, [3.5, 3.5, 20], [0, 0, -1])!;
    expect(h.cell).toEqual([3, 3, 1]);
    expect(h.normal).toEqual([0, 0, 1]);
    expect(h.place).toEqual([3, 3, 2]);
  });

  it('hits a side face diagonally', () => {
    const h = raycast(g, [-2, 3.5, 0.5], [1, 0, 0])!;
    expect(h.cell).toEqual([3, 3, 0]);
    expect(h.normal).toEqual([-1, 0, 0]);
    expect(h.place).toEqual([2, 3, 0]);
  });

  it('falls through to the floor', () => {
    const h = raycast(g, [1.5, 1.5, 20], [0.01, 0.02, -1])!;
    expect(h.cell).toBeNull();
    expect(h.place).toEqual([1, 1, 0]);
  });

  it('ignores voxels above the layer limit', () => {
    const h = raycast(g, [3.5, 3.5, 20], [0, 0, -1], 0)!;
    expect(h.cell).toEqual([3, 3, 0]);
    expect(h.place).toBeNull(); // z=1 is above the layer
  });

  it('misses when the ray points away', () => {
    expect(raycast(g, [3.5, 3.5, 20], [0, 0, 1])).toBeNull();
  });
});
