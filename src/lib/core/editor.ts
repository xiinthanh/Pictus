import { VoxelGrid } from './grid';
import { History } from './history';
import { defaultPalette, MAX_COLORS, type Palette } from './palette';

export interface Model {
  grid: VoxelGrid;
  palette: Palette;
  /** Edge length of one voxel in millimetres. */
  voxelSize: number;
}

export type EditEvent =
  | { kind: 'cells'; idx: ArrayLike<number> }
  | { kind: 'palette' }
  /** Model settings changed (e.g. voxel size) — no geometry or colors affected. */
  | { kind: 'meta' }
  | { kind: 'reset' };

/**
 * Owns the current model and its undo history. Every mutation goes through here
 * so the renderer and UI can react to change events.
 */
export class Editor {
  grid: VoxelGrid;
  palette: Palette;
  voxelSize: number;
  readonly history = new History();
  private listeners = new Set<(e: EditEvent) => void>();
  private stroke: Map<number, number> | null = null;

  constructor(model?: Model) {
    this.grid = model?.grid ?? new VoxelGrid(32, 32, 32);
    this.palette = model?.palette ?? defaultPalette();
    this.voxelSize = model?.voxelSize ?? 1;
  }

  on(fn: (e: EditEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(e: EditEvent): void {
    for (const fn of this.listeners) fn(e);
  }

  get inStroke(): boolean {
    return this.stroke !== null;
  }

  /** Start grouping applied cells into a single undo step (e.g. a drag). */
  beginStroke(): void {
    if (!this.stroke) this.stroke = new Map();
  }

  /** Apply [index, value] pairs immediately. Outside a stroke each call is its own undo step. */
  apply(cells: Iterable<readonly [number, number]>): number {
    const own = !this.stroke;
    if (own) this.beginStroke();
    const stroke = this.stroke!;
    const data = this.grid.data;
    const changed: number[] = [];
    for (const [i, v] of cells) {
      const old = data[i];
      if (old === v) continue;
      if (!stroke.has(i)) stroke.set(i, old);
      data[i] = v;
      changed.push(i);
    }
    if (changed.length) this.emit({ kind: 'cells', idx: changed });
    if (own) this.endStroke();
    return changed.length;
  }

  /** Set every index in `idx` to `value` as one undo step (or as part of the open stroke). */
  fill(idx: Iterable<number>, value: number): number {
    const pairs: [number, number][] = [];
    for (const i of idx) pairs.push([i, value]);
    return this.apply(pairs);
  }

  endStroke(): void {
    const stroke = this.stroke;
    this.stroke = null;
    if (!stroke) return;
    const idx: number[] = [];
    const before: number[] = [];
    for (const [i, b] of stroke) {
      if (this.grid.data[i] === b) continue; // cell ended where it started
      idx.push(i);
      before.push(b);
    }
    if (!idx.length) return;
    const after = idx.map((i) => this.grid.data[i]);
    this.history.push({
      idx: Int32Array.from(idx),
      before: Uint8Array.from(before),
      after: Uint8Array.from(after),
    });
  }

  undo(): boolean {
    if (this.stroke) return false;
    const c = this.history.undo(this.grid.data);
    if (c) this.emit({ kind: 'cells', idx: c.idx });
    return !!c;
  }

  redo(): boolean {
    if (this.stroke) return false;
    const c = this.history.redo(this.grid.data);
    if (c) this.emit({ kind: 'cells', idx: c.idx });
    return !!c;
  }

  load(model: Model): void {
    this.stroke = null;
    this.grid = model.grid;
    this.palette = model.palette.slice();
    this.voxelSize = model.voxelSize;
    this.history.clear();
    this.emit({ kind: 'reset' });
  }

  model(): Model {
    return { grid: this.grid, palette: this.palette, voxelSize: this.voxelSize };
  }

  setColor(index: number, color: number): void {
    if (index < 1 || index >= this.palette.length || this.palette[index] === color) return;
    this.palette[index] = color;
    this.emit({ kind: 'palette' });
  }

  /** Adds a color and returns its index, or -1 if the palette is full. */
  addColor(color: number): number {
    if (this.palette.length > MAX_COLORS) return -1;
    this.palette.push(color);
    this.emit({ kind: 'palette' });
    return this.palette.length - 1;
  }

  setVoxelSize(mm: number): void {
    if (mm > 0 && mm !== this.voxelSize) {
      this.voxelSize = mm;
      this.emit({ kind: 'meta' });
    }
  }
}
