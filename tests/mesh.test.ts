import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { analyze, findParts, findThinContacts, fixThinContacts } from '../src/lib/core/analysis';
import { writeObj } from '../src/lib/core/export/obj';
import { writeStl } from '../src/lib/core/export/stl';
import { write3mf } from '../src/lib/core/export/threemf';
import { VoxelGrid } from '../src/lib/core/grid';
import { buildChunk, colorBodies, mergedBody } from '../src/lib/core/mesher';
import { checkWatertight, randomGrid, volume } from './helpers';

describe('print mesh', () => {
  it('meshes a single cube as 12 triangles', () => {
    const g = new VoxelGrid(3, 3, 3);
    g.set(1, 1, 1, 1);
    const b = mergedBody(g);
    expect(b.indices.length / 3).toBe(12);
    expect(checkWatertight(b)).toBeNull();
    expect(volume(b)).toBeCloseTo(1);
  });

  it('merges a flat plate into few triangles', () => {
    const g = new VoxelGrid(64, 64, 1);
    g.data.fill(1);
    const b = mergedBody(g);
    expect(checkWatertight(b)).toBeNull();
    expect(volume(b)).toBeCloseTo(64 * 64);
    // 2 big faces as fans of 256 perimeter points + 4 side strips — far fewer than 2*(64*64*2 + 4*64).
    expect(b.indices.length / 3).toBeLessThan(1200);
  });

  it('is watertight with correct volume for random shapes (merged and per color)', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = randomGrid(seed, 6, 0.5, 3);
      const m = mergedBody(g);
      expect(checkWatertight(m), `merged seed ${seed}`).toBeNull();
      expect(volume(m)).toBeCloseTo(g.count(), 6);
      let total = 0;
      for (const b of colorBodies(g)) {
        expect(checkWatertight(b), `color ${b.color} seed ${seed}`).toBeNull();
        total += volume(b);
      }
      expect(total).toBeCloseTo(g.count(), 6);
    }
  });

  it('stays watertight under heavy random stress and a 3D checkerboard', () => {
    for (let seed = 1000; seed < 1600; seed++) {
      const fill = [0.2, 0.35, 0.5, 0.65, 0.8][seed % 5];
      const g = randomGrid(seed, 5, fill, 2);
      for (const b of [mergedBody(g), ...colorBodies(g)]) {
        expect(checkWatertight(b), `seed ${seed} color ${b.color}`).toBeNull();
      }
    }
    const c = new VoxelGrid(6, 6, 6);
    for (let i = 0; i < c.data.length; i++) {
      const [x, y, z] = c.coords(i);
      if ((x + y + z) % 2 === 0) c.data[i] = 1;
    }
    const b = mergedBody(c);
    expect(checkWatertight(b)).toBeNull();
    expect(volume(b)).toBeCloseTo(c.count());
  });

  it('handles edge-only and corner-only contacts', () => {
    const edge = new VoxelGrid(2, 2, 1);
    edge.set(0, 0, 0, 1);
    edge.set(1, 1, 0, 1);
    expect(checkWatertight(mergedBody(edge))).toBeNull();
    const corner = new VoxelGrid(2, 2, 2);
    corner.set(0, 0, 0, 1);
    corner.set(1, 1, 1, 1);
    expect(checkWatertight(mergedBody(corner))).toBeNull();
  });
});

describe('analysis', () => {
  it('finds separate parts, largest first', () => {
    const g = new VoxelGrid(6, 6, 6);
    g.set(0, 0, 0, 1);
    g.set(1, 0, 0, 1);
    g.set(4, 4, 4, 2);
    const parts = findParts(g);
    expect(parts.map((p) => p.size)).toEqual([2, 1]);
  });

  it('detects and fixes thin contacts', () => {
    const g = new VoxelGrid(4, 4, 4);
    g.set(1, 1, 1, 1);
    g.set(2, 2, 2, 2); // corner contact
    g.set(0, 3, 0, 1);
    g.set(1, 2, 0, 1); // edge contact
    expect(findThinContacts(g).length).toBeGreaterThan(0);
    const fix = fixThinContacts(g);
    expect(fix.remaining).toBe(0);
    for (const [i, v] of fix.changes) g.data[i] = v;
    expect(findThinContacts(g)).toEqual([]);
    expect(analyze(g).parts.length).toBe(1);
  });

  it('fixes random shapes', () => {
    for (let seed = 100; seed < 110; seed++) {
      const g = randomGrid(seed, 8, 0.3, 2);
      const fix = fixThinContacts(g);
      for (const [i, v] of fix.changes) g.data[i] = v;
      expect(findThinContacts(g).length, `seed ${seed}`).toBe(fix.remaining);
      expect(fix.remaining, `seed ${seed}`).toBe(0);
    }
  });
});

describe('exporters', () => {
  const g = new VoxelGrid(4, 4, 4);
  g.set(0, 0, 0, 1);
  g.set(1, 0, 0, 2);
  const palette = [0, 0xff0000, 0x00ff00];

  it('writes binary STL with the right triangle count and scale', () => {
    const b = mergedBody(g);
    const stl = writeStl([b], 2);
    const view = new DataView(stl.buffer);
    const tris = view.getUint32(80, true);
    expect(tris).toBe(b.indices.length / 3);
    expect(stl.length).toBe(84 + tris * 50);
    let maxX = 0;
    for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) maxX = Math.max(maxX, view.getFloat32(84 + t * 50 + 12 + k * 12, true));
    expect(maxX).toBe(4); // 2 voxels × 2 mm
  });

  it('writes OBJ with a material per color', () => {
    const { obj, mtl } = writeObj(colorBodies(g), palette, 1, 'm.mtl');
    expect(obj.match(/^o /gm)).toHaveLength(2);
    expect(mtl).toContain('Kd 1 0 0');
    const maxIndex = Math.max(...[...obj.matchAll(/^f (\d+) (\d+) (\d+)/gm)].flatMap((m) => m.slice(1).map(Number)));
    expect(maxIndex).toBe(obj.match(/^v /gm)!.length);
  });

  it('writes a 3MF with one part per color', () => {
    const zip = unzipSync(write3mf(colorBodies(g), palette, 1, 'Test & co'));
    expect(Object.keys(zip).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const xml = strFromU8(zip['3D/3dmodel.model']);
    expect(xml.match(/<mesh>/g)).toHaveLength(2);
    expect(xml.match(/<component /g)).toHaveLength(2);
    expect(xml).toContain('displaycolor="#FF0000FF"');
    expect(xml).toContain('Test &#38; co');
    expect(xml).toContain('<item objectid="4"/>');
  });
});

describe('viewport chunk mesh', () => {
  it('emits only exposed faces', () => {
    const g = new VoxelGrid(16, 16, 16);
    g.set(0, 0, 0, 1);
    g.set(1, 0, 0, 1);
    const rgb = new Float32Array(256 * 3).fill(1);
    const m = buildChunk(g, rgb, 0, 0, 0)!;
    expect(m.indices.length / 6).toBe(10);
    expect(buildChunk(g, rgb, 0, 0, 0, -1)).toBeNull();
  });
});
