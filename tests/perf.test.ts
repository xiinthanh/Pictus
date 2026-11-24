import { describe, expect, it } from 'vitest';
import { analyze } from '../src/lib/core/analysis';
import { VoxelGrid } from '../src/lib/core/grid';
import { buildChunk, CHUNK, colorBodies, mergedBody } from '../src/lib/core/mesher';

/** Worst realistic case: a full 128³ grid shaped like a hollow-ish blob with 4 colors. */
function bigModel(): VoxelGrid {
  const g = new VoxelGrid(128, 128, 128);
  for (let z = 0; z < 128; z++)
    for (let y = 0; y < 128; y++)
      for (let x = 0; x < 128; x++) {
        const d = Math.hypot(x - 64, y - 64, z - 64);
        if (d < 60 && (d > 50 || (x + y + z) % 7 === 0)) g.set(x, y, z, 1 + (((x >> 4) + (y >> 4)) % 4));
      }
  return g;
}

describe('performance at the 128³ limit', () => {
  const g = bigModel();

  it('builds all viewport chunks quickly', () => {
    const rgb = new Float32Array(256 * 3).fill(0.5);
    const t = performance.now();
    const n = 128 / CHUNK;
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) buildChunk(g, rgb, x, y, z);
    const ms = performance.now() - t;
    console.log(`viewport mesh (all ${n ** 3} chunks): ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });

  it('builds export meshes and analysis in reasonable time', () => {
    let t = performance.now();
    const m = mergedBody(g);
    console.log(`merged export mesh: ${(performance.now() - t).toFixed(0)} ms, ${m.indices.length / 3} triangles`);
    t = performance.now();
    const bodies = colorBodies(g);
    console.log(`per-color export meshes: ${(performance.now() - t).toFixed(0)} ms, ${bodies.length} bodies`);
    t = performance.now();
    const r = analyze(g);
    console.log(
      `print analysis: ${(performance.now() - t).toFixed(0)} ms, ${r.parts.length} parts, ${r.contacts.length} contacts`,
    );
    expect(m.indices.length).toBeGreaterThan(0);
  }, 60_000);
});
