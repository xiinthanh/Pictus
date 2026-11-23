import { VoxelGrid } from '../src/lib/core/grid';
import type { Body } from '../src/lib/core/mesher';

/** Deterministic PRNG so failures are reproducible. */
export function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

export function randomGrid(seed: number, size = 6, fill = 0.45, colors = 3): VoxelGrid {
  const r = rng(seed);
  const g = new VoxelGrid(size, size, size);
  for (let i = 0; i < g.data.length; i++) if (r() < fill) g.data[i] = 1 + Math.floor(r() * colors);
  return g;
}

/**
 * Every directed edge must appear exactly once and its reverse exactly once:
 * a closed, consistently oriented 2-manifold mesh.
 */
export function checkWatertight(b: Body): string | null {
  const edges = new Map<string, number>();
  const tri = b.indices;
  for (let t = 0; t < tri.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const a = tri[t + k], c = tri[t + ((k + 1) % 3)];
      if (a === c) return `degenerate triangle ${t / 3}`;
      const key = `${a}>${c}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of edges) {
    if (n !== 1) return `edge ${key} used ${n} times`;
    const [a, c] = key.split('>');
    if (edges.get(`${c}>${a}`) !== 1) return `edge ${key} has no opposite`;
  }
  return null;
}

/** Signed volume via the divergence theorem (voxel units³). */
export function volume(b: Body): number {
  const p = b.positions;
  let v = 0;
  for (let t = 0; t < b.indices.length; t += 3) {
    const a = b.indices[t] * 3, c = b.indices[t + 1] * 3, d = b.indices[t + 2] * 3;
    v += p[a] * (p[c + 1] * p[d + 2] - p[c + 2] * p[d + 1])
      - p[a + 1] * (p[c] * p[d + 2] - p[c + 2] * p[d])
      + p[a + 2] * (p[c] * p[d + 1] - p[c + 1] * p[d]);
  }
  return v / 6;
}
