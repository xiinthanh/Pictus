import type { Vec3 } from '$lib/core/grid';
import { floodFill, mirrorCells } from '$lib/core/tools';
import { app, editor, type BoxMode } from '$lib/state/app.svelte';

/**
 * Applies an add/erase/paint to cells (plus their mirror images).
 * Add only fills empty cells; paint only recolors existing voxels.
 */
export function editCells(cells: Vec3[], mode: BoxMode): number {
  const g = editor.grid;
  const pairs: [number, number][] = [];
  for (const [x, y, z] of mirrorCells(g, cells, app.mirror)) {
    const i = g.index(x, y, z);
    const cur = g.data[i];
    if (mode === 'add') {
      if (!cur) pairs.push([i, app.color]);
    } else if (mode === 'erase') {
      if (cur) pairs.push([i, 0]);
    } else if (cur) pairs.push([i, app.color]);
  }
  return editor.apply(pairs);
}

/** Flood-fills from a cell (and its mirrors). Within a layer it can also fill empty areas. */
export function fillAt(cell: Vec3, layer?: number): number {
  const g = editor.grid;
  const idx = new Set<number>();
  for (const start of mirrorCells(g, [cell], app.mirror)) for (const i of floodFill(g, start, layer)) idx.add(i);
  return editor.fill(idx, app.color);
}

export function pickAt(cell: Vec3): void {
  const v = editor.grid.get(cell[0], cell[1], cell[2]);
  if (v) app.color = v;
}

/** Cells of a rectangle in the plane `axis = start[axis]`, extruded `height` layers along `dirSign`. */
export function boxRegion(start: Vec3, end: Vec3, axis: number, dirSign: number, height: number): Vec3[] {
  const g = editor.grid;
  const lo = [0, 1, 2].map((k) => Math.min(start[k], end[k]));
  const hi = [0, 1, 2].map((k) => Math.max(start[k], end[k]));
  const a0 = start[axis];
  const a1 = start[axis] + dirSign * (Math.max(1, height) - 1);
  lo[axis] = Math.min(a0, a1);
  hi[axis] = Math.max(a0, a1);
  const dims = [g.sx, g.sy, g.sz];
  for (let k = 0; k < 3; k++) {
    lo[k] = Math.max(0, lo[k]);
    hi[k] = Math.min(dims[k] - 1, hi[k]);
  }
  const out: Vec3[] = [];
  for (let z = lo[2]; z <= hi[2]; z++)
    for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) out.push([x, y, z]);
  return out;
}

export function undo(): void {
  if (!editor.undo()) app.flash('Nothing to undo');
}

export function redo(): void {
  if (!editor.redo()) app.flash('Nothing to redo');
}
