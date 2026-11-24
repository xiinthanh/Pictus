import type { VoxelGrid } from './grid';
import { NON_MANIFOLD, vertexMask, vertexSheets } from './topology';

export const CHUNK = 16;

/** The 6 cube faces: normal + 4 corners, counter-clockwise seen from outside. */
export const FACES: { n: [number, number, number]; c: [number, number, number][]; shade: number }[] = [
  {
    n: [1, 0, 0],
    c: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
    shade: 0.8,
  },
  {
    n: [-1, 0, 0],
    c: [
      [0, 0, 0],
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
    ],
    shade: 0.7,
  },
  {
    n: [0, 1, 0],
    c: [
      [0, 1, 0],
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
    ],
    shade: 0.9,
  },
  {
    n: [0, -1, 0],
    c: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
    shade: 0.65,
  },
  {
    n: [0, 0, 1],
    c: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
    shade: 1.0,
  },
  {
    n: [0, 0, -1],
    c: [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
    shade: 0.55,
  },
];

export interface ChunkMesh {
  positions: Float32Array;
  colors: Float32Array;
  indices: Uint32Array;
}

/**
 * Viewport mesh for one CHUNK³ block: one quad per visible face, with flat
 * per-face shading baked into vertex colors (cheap, crisp "pixel" look).
 * `rgb` holds linear RGB triplets per palette index. Voxels above maxZ are hidden.
 */
export function buildChunk(
  grid: VoxelGrid,
  rgb: Float32Array,
  cx: number,
  cy: number,
  cz: number,
  maxZ = grid.sz - 1,
): ChunkMesh | null {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const { sx, sy, data } = grid;
  const x0 = cx * CHUNK,
    y0 = cy * CHUNK,
    z0 = cz * CHUNK;
  const x1 = Math.min(x0 + CHUNK, sx);
  const y1 = Math.min(y0 + CHUNK, sy);
  const z1 = Math.min(z0 + CHUNK, grid.sz, maxZ + 1);
  const solid = (x: number, y: number, z: number) => z <= maxZ && grid.get(x, y, z) !== 0;
  for (let z = z0; z < z1; z++) {
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const v = data[x + sx * (y + sy * z)];
        if (v === 0) continue;
        for (const f of FACES) {
          if (solid(x + f.n[0], y + f.n[1], z + f.n[2])) continue;
          const base = pos.length / 3;
          const r = rgb[v * 3] * f.shade,
            g = rgb[v * 3 + 1] * f.shade,
            b = rgb[v * 3 + 2] * f.shade;
          for (const c of f.c) {
            pos.push(x + c[0], y + c[1], z + c[2]);
            col.push(r, g, b);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
  }
  if (!idx.length) return null;
  return {
    positions: new Float32Array(pos),
    colors: new Float32Array(col),
    indices: new Uint32Array(idx),
  };
}

/** An indexed, closed triangle mesh in voxel units. `color` is a palette index (0 = all colors merged). */
export interface Body {
  color: number;
  positions: number[];
  indices: number[];
}

/**
 * Print mesh for the cells where `isSolid(value)` holds.
 *
 * Coplanar faces are merged into rectangles (greedy meshing). To stay watertight
 * without T-junctions, every rectangle keeps a vertex at each unit step of its
 * perimeter and is triangulated as a fan around its center. At edge/corner-only
 * contacts, vertices are split per touching "sheet" so every edge is shared by
 * exactly two triangles.
 */
export function buildBody(grid: VoxelGrid, isSolid: (v: number) => boolean, color = 0): Body {
  const size = [grid.sx, grid.sy, grid.sz];
  const solidAt = (x: number, y: number, z: number) => isSolid(grid.get(x, y, z));
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexIds = new Map<number, number>();
  const D = 130;

  const sheetCache = new Map<number, Map<number, number>>();

  const latticeVertex = (L: number[], owner: number[], outward: number[]): number => {
    const lkey = (L[0] * D + L[1]) * D + L[2];
    let sheet = 0;
    if (NON_MANIFOLD[vertexMask(L[0], L[1], L[2], solidAt)]) {
      let sheets = sheetCache.get(lkey);
      if (!sheets) {
        sheets = vertexSheets(L[0], L[1], L[2], solidAt);
        sheetCache.set(lkey, sheets);
      }
      const bitOf = (c: number[]) => (c[0] - L[0] + 1) | ((c[1] - L[1] + 1) << 1) | ((c[2] - L[2] + 1) << 2);
      sheet = 1 + (sheets.get(bitOf(owner) * 8 + bitOf(outward)) ?? 0);
    }
    const key = lkey * 32 + sheet;
    let id = vertexIds.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      positions.push(L[0], L[1], L[2]);
      vertexIds.set(key, id);
    }
    return id;
  };

  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    const su = size[u],
      sv = size[v];
    const mask = new Uint8Array(su * sv);
    for (const dir of [1, -1]) {
      for (let s = 0; s < size[a]; s++) {
        // Faces in this slice whose outside is empty for this body.
        const c = [0, 0, 0];
        for (let j = 0; j < sv; j++) {
          for (let i = 0; i < su; i++) {
            c[a] = s;
            c[u] = i;
            c[v] = j;
            const isInside = solidAt(c[0], c[1], c[2]);
            c[a] = s + dir;
            mask[i + j * su] = isInside && !solidAt(c[0], c[1], c[2]) ? 1 : 0;
          }
        }
        const plane = dir > 0 ? s + 1 : s;
        for (let j = 0; j < sv; j++) {
          for (let i = 0; i < su;) {
            if (!mask[i + j * su]) {
              i++;
              continue;
            }
            let w = 1;
            while (i + w < su && mask[i + w + j * su]) w++;
            let h = 1;
            grow: while (j + h < sv) {
              for (let k = 0; k < w; k++) if (!mask[i + k + (j + h) * su]) break grow;
              h++;
            }
            for (let jj = 0; jj < h; jj++) for (let k = 0; k < w; k++) mask[i + k + (j + jj) * su] = 0;
            emitRect(a, u, v, dir, s, plane, i, j, w, h);
            i += w;
          }
        }
      }
    }
  }

  function emitRect(
    a: number,
    u: number,
    v: number,
    dir: number,
    s: number,
    plane: number,
    i: number,
    j: number,
    w: number,
    h: number,
  ) {
    // Perimeter points, counter-clockwise in (u,v) — which faces +a since u×v = a.
    const ring: [number, number][] = [];
    for (let k = 0; k < w; k++) ring.push([i + k, j]);
    for (let k = 0; k < h; k++) ring.push([i + w, j + k]);
    for (let k = w; k > 0; k--) ring.push([i + k, j + h]);
    for (let k = h; k > 0; k--) ring.push([i, j + k]);
    if (dir < 0) ring.reverse();
    const ids = ring.map(([pu, pv]) => {
      const L = [0, 0, 0],
        owner = [0, 0, 0],
        out = [0, 0, 0];
      L[a] = plane;
      L[u] = pu;
      L[v] = pv;
      owner[a] = s;
      owner[u] = Math.min(Math.max(pu, i), i + w - 1);
      owner[v] = Math.min(Math.max(pv, j), j + h - 1);
      out[a] = s + dir;
      out[u] = owner[u];
      out[v] = owner[v];
      return latticeVertex(L, owner, out);
    });
    if (w === 1 && h === 1) {
      indices.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]);
      return;
    }
    const center = positions.length / 3;
    const p = [0, 0, 0];
    p[a] = plane;
    p[u] = i + w / 2;
    p[v] = j + h / 2;
    positions.push(p[0], p[1], p[2]);
    for (let k = 0; k < ids.length; k++) indices.push(center, ids[k], ids[(k + 1) % ids.length]);
  }

  return { color, positions, indices };
}

/** All voxels as one body (single-material print). */
export function mergedBody(grid: VoxelGrid): Body {
  return buildBody(grid, (v) => v !== 0, 0);
}

/** One closed body per used color (multi-material print). */
export function colorBodies(grid: VoxelGrid): Body[] {
  const used = new Set<number>();
  for (const v of grid.data) if (v) used.add(v);
  return [...used].sort((a, b) => a - b).map((c) => buildBody(grid, (v) => v === c, c));
}
