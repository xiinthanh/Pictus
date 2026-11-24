import type { Vec3, VoxelGrid } from './grid';
import { EMPTY_COMPONENTS, NON_MANIFOLD, SOLID_COMPONENTS, vertexMask } from './topology';

export interface Part {
  size: number;
  indices: Int32Array;
}

/** Face-connected (6-neighbour) parts, largest first. */
export function findParts(grid: VoxelGrid): Part[] {
  const { sx, sy, sz, data } = grid;
  const layer = sx * sy;
  const label = new Int32Array(data.length).fill(-1);
  const parts: Part[] = [];
  const stack: number[] = [];
  for (let start = 0; start < data.length; start++) {
    if (data[start] === 0 || label[start] >= 0) continue;
    const id = parts.length;
    const members: number[] = [];
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      members.push(i);
      const x = i % sx;
      const y = ((i - x) / sx) % sy;
      const z = Math.floor(i / layer);
      const visit = (j: number) => {
        if (data[j] !== 0 && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < sx - 1) visit(i + 1);
      if (y > 0) visit(i - sx);
      if (y < sy - 1) visit(i + sx);
      if (z > 0) visit(i - layer);
      if (z < sz - 1) visit(i + layer);
    }
    parts.push({ size: members.length, indices: Int32Array.from(members) });
  }
  return parts.sort((a, b) => b.size - a.size);
}

/** Lattice vertices where voxels touch only by an edge or a corner (non-manifold geometry). */
export function findThinContacts(grid: VoxelGrid): Vec3[] {
  const solid = (x: number, y: number, z: number) => grid.get(x, y, z) !== 0;
  const out: Vec3[] = [];
  for (let z = 0; z <= grid.sz; z++)
    for (let y = 0; y <= grid.sy; y++)
      for (let x = 0; x <= grid.sx; x++) if (NON_MANIFOLD[vertexMask(x, y, z, solid)]) out.push([x, y, z]);
  return out;
}

/** The voxels that meet at a lattice vertex (for highlighting a contact). */
export function cellsAtVertex(grid: VoxelGrid, [vx, vy, vz]: Vec3): Vec3[] {
  const out: Vec3[] = [];
  for (let b = 0; b < 8; b++) {
    const c: Vec3 = [vx - 1 + (b & 1), vy - 1 + ((b >> 1) & 1), vz - 1 + ((b >> 2) & 1)];
    if (grid.get(c[0], c[1], c[2]) !== 0) out.push(c);
  }
  return out;
}

export interface FixResult {
  /** [index, new value] pairs to apply. */
  changes: [number, number][];
  /** Contacts that could not be fixed (e.g. at the grid boundary). */
  remaining: number;
}

/**
 * Bridges edge/corner-only contacts by filling empty cells next to them with a
 * neighbouring color. Works on a copy; returns the cells to change.
 */
export function fixThinContacts(grid: VoxelGrid, maxPasses = 30): FixResult {
  const g = grid.clone();
  const changes = new Map<number, number>();
  const solid = (x: number, y: number, z: number) => g.get(x, y, z) !== 0;
  let contacts = findThinContacts(g);
  for (let pass = 0; pass < maxPasses && contacts.length; pass++) {
    for (const [vx, vy, vz] of contacts) {
      const mask = vertexMask(vx, vy, vz, solid);
      if (!NON_MANIFOLD[mask]) continue;
      let best = -1;
      let bestScore = Infinity;
      for (let b = 0; b < 8; b++) {
        if ((mask >> b) & 1) continue;
        const cx = vx - 1 + (b & 1),
          cy = vy - 1 + ((b >> 1) & 1),
          cz = vz - 1 + ((b >> 2) & 1);
        if (!g.isInBounds(cx, cy, cz)) continue;
        const m2 = mask | (1 << b);
        let solidNeighbours = 0;
        for (const bit of [1, 2, 4]) if ((mask >> (b ^ bit)) & 1) solidNeighbours++;
        // Prefer fills that resolve the contact, then fewer components, then lower cells (better support).
        const score =
          NON_MANIFOLD[m2] * 100 +
          SOLID_COMPONENTS[m2] * 10 +
          EMPTY_COMPONENTS[m2] * 10 -
          solidNeighbours * 3 +
          ((b >> 2) & 1);
        if (score < bestScore) {
          bestScore = score;
          best = b;
        }
      }
      if (best < 0) continue;
      const cx = vx - 1 + (best & 1),
        cy = vy - 1 + ((best >> 1) & 1),
        cz = vz - 1 + ((best >> 2) & 1);
      const color = neighbourColor(g, cx, cy, cz);
      const i = g.index(cx, cy, cz);
      g.data[i] = color;
      changes.set(i, color);
    }
    contacts = findThinContacts(g);
  }
  return { changes: [...changes], remaining: contacts.length };
}

/** Most common color among the 26 neighbours (face neighbours weighted higher). */
function neighbourColor(g: VoxelGrid, x: number, y: number, z: number): number {
  const votes = new Map<number, number>();
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const v = g.get(x + dx, y + dy, z + dz);
        if (!v) continue;
        const w = Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1 ? 3 : 1;
        votes.set(v, (votes.get(v) ?? 0) + w);
      }
  let best = 1,
    bestVotes = -1;
  for (const [v, n] of votes)
    if (n > bestVotes) {
      best = v;
      bestVotes = n;
    }
  return best;
}

export interface PrintReport {
  voxels: number;
  parts: Part[];
  contacts: Vec3[];
}

export function analyze(grid: VoxelGrid): PrintReport {
  return { voxels: grid.count(), parts: findParts(grid), contacts: findThinContacts(grid) };
}
