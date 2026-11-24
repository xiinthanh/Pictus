import type { Vec3, VoxelGrid } from './grid';

export interface RayHit {
  /** Solid voxel that was hit, or null when the ray hit the floor. */
  cell: Vec3 | null;
  /** Normal of the face that was hit (points out of `cell`). */
  normal: Vec3;
  /** Empty cell in front of the hit face — where a new voxel would go. */
  place: Vec3 | null;
  /** Ray distance to the hit. */
  t: number;
}

/**
 * Exact grid traversal (Amanatides & Woo). Voxel (x,y,z) spans [x,x+1]×[y,y+1]×[z,z+1].
 * Voxels above `maxZ` are ignored (layer mode). If no voxel is hit but the ray leaves
 * through the bottom of the grid, the floor cell at z=0 is returned as a place target.
 */
export function raycast(grid: VoxelGrid, o: Vec3, d: Vec3, maxZ = grid.sz - 1): RayHit | null {
  const size = [grid.sx, grid.sy, grid.sz];
  let tEnter = 0;
  let tExit = Infinity;
  let enterAxis = -1;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-12) {
      if (o[a] < 0 || o[a] > size[a]) return null;
      continue;
    }
    let t1 = -o[a] / d[a];
    let t2 = (size[a] - o[a]) / d[a];
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tEnter) {
      tEnter = t1;
      enterAxis = a;
    }
    tExit = Math.min(tExit, t2);
  }
  if (tEnter > tExit) return null;

  const cell = [0, 0, 0];
  const step = [0, 0, 0];
  const tMax = [Infinity, Infinity, Infinity];
  const tDelta = [Infinity, Infinity, Infinity];
  for (let a = 0; a < 3; a++) {
    const p = o[a] + d[a] * tEnter;
    cell[a] = Math.min(size[a] - 1, Math.max(0, Math.floor(p)));
    if (a === enterAxis) cell[a] = d[a] > 0 ? 0 : size[a] - 1;
    if (d[a] > 0) {
      step[a] = 1;
      tMax[a] = (cell[a] + 1 - o[a]) / d[a];
      tDelta[a] = 1 / d[a];
    } else if (d[a] < 0) {
      step[a] = -1;
      tMax[a] = (cell[a] - o[a]) / d[a];
      tDelta[a] = -1 / d[a];
    }
  }

  let normal: Vec3 = [0, 0, 0];
  if (enterAxis >= 0) normal[enterAxis] = -step[enterAxis];
  let t = tEnter;
  const maxSteps = size[0] + size[1] + size[2] + 3;
  for (let n = 0; n < maxSteps; n++) {
    const [x, y, z] = cell;
    if (z <= maxZ && grid.data[grid.index(x, y, z)] !== 0) {
      const p: Vec3 = [x + normal[0], y + normal[1], z + normal[2]];
      const hasNormal = normal[0] !== 0 || normal[1] !== 0 || normal[2] !== 0;
      const place = hasNormal && grid.isInBounds(p[0], p[1], p[2]) && p[2] <= maxZ ? p : null;
      return { cell: [x, y, z], normal, place, t };
    }
    const a = tMax[0] < tMax[1] ? (tMax[0] < tMax[2] ? 0 : 2) : tMax[1] < tMax[2] ? 1 : 2;
    t = tMax[a];
    const prev: Vec3 = [x, y, z];
    cell[a] += step[a];
    tMax[a] += tDelta[a];
    normal = [0, 0, 0];
    normal[a] = -step[a];
    if (cell[a] < 0 || cell[a] >= size[a]) {
      if (a === 2 && step[2] < 0) return { cell: null, normal: [0, 0, 1], place: prev, t };
      return null;
    }
  }
  return null;
}

/** Intersects a ray with the axis plane `coord[axis] = value`; returns t or null if parallel/behind. */
export function rayPlane(o: Vec3, d: Vec3, axis: number, value: number): number | null {
  if (Math.abs(d[axis]) < 1e-9) return null;
  const t = (value - o[axis]) / d[axis];
  return t >= 0 ? t : null;
}
