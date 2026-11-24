import type { Vec3, VoxelGrid } from './grid';

export interface Mirror {
  x: boolean;
  y: boolean;
  z: boolean;
}

export const NO_MIRROR: Mirror = { x: false, y: false, z: false };

/** Expands cells with their mirror images across the enabled grid-center planes. */
export function mirrorCells(grid: VoxelGrid, cells: Iterable<Vec3>, m: Mirror): Vec3[] {
  const seen = new Set<number>();
  const out: Vec3[] = [];
  const push = (c: Vec3) => {
    if (!grid.inBounds(c[0], c[1], c[2])) return;
    const i = grid.index(c[0], c[1], c[2]);
    if (seen.has(i)) return;
    seen.add(i);
    out.push(c);
  };
  for (const [x, y, z] of cells) {
    const xs = m.x ? [x, grid.sx - 1 - x] : [x];
    const ys = m.y ? [y, grid.sy - 1 - y] : [y];
    const zs = m.z ? [z, grid.sz - 1 - z] : [z];
    for (const a of xs) for (const b of ys) for (const c of zs) push([a, b, c]);
  }
  return out;
}

export function cellsToIndices(grid: VoxelGrid, cells: Iterable<Vec3>): number[] {
  const out: number[] = [];
  for (const [x, y, z] of cells) if (grid.inBounds(x, y, z)) out.push(grid.index(x, y, z));
  return out;
}

/**
 * Connected region of cells with the same value as `start` (6-connected in 3D,
 * 4-connected within a single layer when `layer` is given).
 * Filling empty space is only allowed within a layer — in 3D it would flood the air.
 */
export function floodFill(grid: VoxelGrid, start: Vec3, layer?: number): number[] {
  const [x0, y0, z0] = start;
  if (!grid.inBounds(x0, y0, z0)) return [];
  const target = grid.get(x0, y0, z0);
  const planar = layer !== undefined;
  if (target === 0 && !planar) return [];
  const { sx, sy, sz, data } = grid;
  const visited = new Uint8Array(data.length);
  const startIdx = grid.index(x0, y0, z0);
  const stack = [startIdx];
  visited[startIdx] = 1;
  const out: number[] = [];
  const layerSize = sx * sy;
  while (stack.length) {
    const i = stack.pop()!;
    out.push(i);
    const x = i % sx;
    const y = ((i - x) / sx) % sy;
    const z = Math.floor(i / layerSize);
    const visit = (j: number) => {
      if (!visited[j] && data[j] === target) {
        visited[j] = 1;
        stack.push(j);
      }
    };
    if (x > 0) visit(i - 1);
    if (x < sx - 1) visit(i + 1);
    if (y > 0) visit(i - sx);
    if (y < sy - 1) visit(i + sx);
    if (!planar) {
      if (z > 0) visit(i - layerSize);
      if (z < sz - 1) visit(i + layerSize);
    }
  }
  return out;
}

/** All in-bounds cells of the axis-aligned box spanning a and b (inclusive). */
export function boxCells(grid: VoxelGrid, a: Vec3, b: Vec3): Vec3[] {
  const lo = [0, 1, 2].map((k) => Math.max(0, Math.min(a[k], b[k])));
  const hi = [grid.sx, grid.sy, grid.sz].map((s, k) => Math.min(s - 1, Math.max(a[k], b[k])));
  const out: Vec3[] = [];
  for (let z = lo[2]; z <= hi[2]; z++)
    for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) out.push([x, y, z]);
  return out;
}

/** Cells on a 2D line between two points of the same layer (Bresenham), for smooth drags. */
export function lineCells(a: Vec3, b: Vec3): Vec3[] {
  const out: Vec3[] = [];
  let [x0, y0] = a;
  const [x1, y1, z] = b;
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0, z]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return out;
}
