/**
 * Lookup tables describing the 8 cells around a lattice vertex (a 2×2×2 block).
 * Bit b of a mask is cell (b&1, (b>>1)&1, (b>>2)&1) relative to vertex − (1,1,1).
 *
 * A vertex is non-manifold (an edge- or corner-only contact) when the solid cells,
 * or the empty cells, of its block are not face-connected within the block.
 */

const N = 256;

/** 1 if the mask describes a non-manifold vertex. */
export const NON_MANIFOLD = new Uint8Array(N);
/** Component id (0..7) of each cell among same-state cells, indexed mask*8+bit. */
export const COMPONENT = new Uint8Array(N * 8);
/** Number of solid / empty components per mask. */
export const SOLID_COMPONENTS = new Uint8Array(N);
export const EMPTY_COMPONENTS = new Uint8Array(N);

for (let mask = 0; mask < N; mask++) {
  const comp = new Int8Array(8).fill(-1);
  let solidCount = 0;
  let emptyCount = 0;
  for (let b = 0; b < 8; b++) {
    if (comp[b] >= 0) continue;
    const solid = (mask >> b) & 1;
    const id = solid ? solidCount++ : emptyCount++;
    const stack = [b];
    comp[b] = id;
    while (stack.length) {
      const c = stack.pop()!;
      for (const bit of [1, 2, 4]) {
        const n = c ^ bit;
        if (comp[n] < 0 && ((mask >> n) & 1) === solid) {
          comp[n] = id;
          stack.push(n);
        }
      }
    }
  }
  for (let b = 0; b < 8; b++) COMPONENT[mask * 8 + b] = comp[b];
  SOLID_COMPONENTS[mask] = solidCount;
  EMPTY_COMPONENTS[mask] = emptyCount;
  NON_MANIFOLD[mask] = mask !== 0 && mask !== 255 && (solidCount > 1 || emptyCount > 1) ? 1 : 0;
}

type SolidFn = (x: number, y: number, z: number) => boolean;

/**
 * Splits the faces around a non-manifold lattice vertex into separate "sheets".
 * Returns a map from face key (ownerBit*8 + outwardBit, bits relative to the
 * vertex block) to a sheet id.
 *
 * Faces around the vertex are linked through the 6 edges leaving it. A normal
 * edge links its 2 faces. An edge-only contact has 4 faces; they are paired by
 * solid cell unless the two solid cells are connected around both ends of the
 * edge (then by empty cell). The rule depends only on the edge, so both of its
 * endpoints agree, and the mesh stays 2-manifold.
 */
export function vertexSheets(vx: number, vy: number, vz: number, solidAt: SolidFn): Map<number, number> {
  const s: boolean[] = [];
  for (let b = 0; b < 8; b++) s[b] = solidAt(vx - 1 + (b & 1), vy - 1 + ((b >> 1) & 1), vz - 1 + ((b >> 2) & 1));

  // Faces: pairs of block cells differing in one bit with exactly one solid.
  const faceOwner: number[] = [];
  const faceOut: number[] = [];
  const faceIndex = new Map<string, number>();
  for (let b = 0; b < 8; b++)
    for (const bit of [1, 2, 4]) {
      const n = b ^ bit;
      if (b < n && s[b] !== s[n]) {
        faceIndex.set(`${b},${n}`, faceOwner.length);
        faceOwner.push(s[b] ? b : n);
        faceOut.push(s[b] ? n : b);
      }
    }
  const parent = faceOwner.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => {
    parent[find(a)] = find(b);
  };

  for (let axis = 0; axis < 3; axis++) {
    const eb = 1 << axis;
    for (const side of [0, 1]) {
      const cells = [0, 1, 2, 3, 4, 5, 6, 7].filter((b) => (b & eb ? 1 : 0) === side);
      const faces: number[] = [];
      for (const a of cells)
        for (const c of cells) {
          const f = faceIndex.get(`${a},${c}`);
          if (f !== undefined) faces.push(f);
        }
      if (faces.length === 2) {
        union(faces[0], faces[1]);
        continue;
      }
      if (faces.length !== 4) continue;
      // Edge-only contact. Are the two solid cells connected around each end of the edge?
      const solidCells = cells.filter((b) => s[b]);
      const emptyCells = cells.filter((b) => !s[b]);
      const shifted = (b: number, delta: number): boolean => {
        const c = [vx - 1 + (b & 1), vy - 1 + ((b >> 1) & 1), vz - 1 + ((b >> 2) & 1)];
        c[axis] += delta;
        return solidAt(c[0], c[1], c[2]);
      };
      // Near layer is the other half of this block; far layer lies beyond the edge's other end.
      const nearDelta = side ? -1 : 1;
      const farDelta = side ? 1 : -1;
      const connected = (delta: number) =>
        shifted(solidCells[0], delta) &&
        shifted(solidCells[1], delta) &&
        (shifted(emptyCells[0], delta) || shifted(emptyCells[1], delta));
      const bySolid = !(connected(nearDelta) && connected(farDelta));
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const fi = faces[i],
            fj = faces[j];
          if (bySolid ? faceOwner[fi] === faceOwner[fj] : faceOut[fi] === faceOut[fj]) union(fi, fj);
        }
    }
  }

  const ids = new Map<number, number>();
  const out = new Map<number, number>();
  faceOwner.forEach((o, i) => {
    const r = find(i);
    if (!ids.has(r)) ids.set(r, ids.size);
    out.set(o * 8 + faceOut[i], ids.get(r)!);
  });
  return out;
}

/** Mask of the 2×2×2 block around lattice vertex (vx,vy,vz) for a solid-test function. */
export function vertexMask(
  vx: number,
  vy: number,
  vz: number,
  solid: (x: number, y: number, z: number) => boolean,
): number {
  let m = 0;
  for (let b = 0; b < 8; b++) {
    if (solid(vx - 1 + (b & 1), vy - 1 + ((b >> 1) & 1), vz - 1 + ((b >> 2) & 1))) m |= 1 << b;
  }
  return m;
}
