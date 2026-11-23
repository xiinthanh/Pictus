export const MAX_DIM = 128;

export type Vec3 = [number, number, number];

/**
 * Dense voxel grid. Each cell stores a palette index; 0 means empty.
 * Coordinates are Z-up (the 3D-printing convention): x/y horizontal, z = layer.
 */
export class VoxelGrid {
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
  readonly data: Uint8Array;

  constructor(sx: number, sy: number, sz: number, data?: Uint8Array) {
    for (const d of [sx, sy, sz]) {
      if (!Number.isInteger(d) || d < 1 || d > MAX_DIM) {
        throw new Error(`Grid size must be a whole number from 1 to ${MAX_DIM} per side`);
      }
    }
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    const n = sx * sy * sz;
    if (data && data.length !== n) throw new Error('Voxel data does not match the grid size');
    this.data = data ?? new Uint8Array(n);
  }

  get dims(): Vec3 {
    return [this.sx, this.sy, this.sz];
  }

  inBounds(x: number, y: number, z: number): boolean {
    return x >= 0 && y >= 0 && z >= 0 && x < this.sx && y < this.sy && z < this.sz;
  }

  index(x: number, y: number, z: number): number {
    return x + this.sx * (y + this.sy * z);
  }

  coords(i: number): Vec3 {
    const x = i % this.sx;
    const t = (i - x) / this.sx;
    const y = t % this.sy;
    return [x, y, (t - y) / this.sy];
  }

  /** Value at a cell; out-of-bounds cells read as empty. */
  get(x: number, y: number, z: number): number {
    return this.inBounds(x, y, z) ? this.data[this.index(x, y, z)] : 0;
  }

  set(x: number, y: number, z: number, v: number): void {
    if (this.inBounds(x, y, z)) this.data[this.index(x, y, z)] = v;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.data.length; i++) if (this.data[i] !== 0) n++;
    return n;
  }

  clone(): VoxelGrid {
    return new VoxelGrid(this.sx, this.sy, this.sz, this.data.slice());
  }

  /** Copy of this grid resized to new dimensions, keeping voxels that still fit. */
  resized(sx: number, sy: number, sz: number): VoxelGrid {
    const g = new VoxelGrid(sx, sy, sz);
    const mx = Math.min(sx, this.sx), my = Math.min(sy, this.sy), mz = Math.min(sz, this.sz);
    for (let z = 0; z < mz; z++)
      for (let y = 0; y < my; y++)
        for (let x = 0; x < mx; x++) g.data[g.index(x, y, z)] = this.data[this.index(x, y, z)];
    return g;
  }
}
