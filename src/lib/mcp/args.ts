// Checks tool arguments from the AI. Every failure throws an Error whose
// message names the argument, the valid range and the value received, so the
// AI can correct itself from the isError result.
import type { Vec3, VoxelGrid } from '../core/grid';
import type { Content } from './tools';

const AXES = ['x', 'y', 'z'] as const;
const HEX_COLOR = /^#?([0-9a-f]{6})$/i;

export function text(value: string): Content {
  return { type: 'text', text: value };
}

function shown(v: unknown): string {
  return JSON.stringify(v) ?? 'nothing';
}

/** `v` as a whole number from `min` to `max`. */
export function intValue(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`'${label}' must be a whole number from ${min} to ${max} (got ${shown(v)}).`);
  }
  return v;
}

export function intArg(args: Record<string, unknown>, key: string, min: number, max: number): number {
  return intValue(args[key], key, min, max);
}

/** A cell `[x, y, z]` inside the grid. */
export function cellValue(v: unknown, label: string, grid: VoxelGrid): Vec3 {
  if (!Array.isArray(v) || v.length !== AXES.length) {
    throw new Error(`'${label}' must be [x, y, z] (got ${shown(v)}).`);
  }
  const dims = grid.dims;
  const [x, y, z] = AXES.map((axis, k) => intValue(v[k], `${label} ${axis}`, 0, dims[k] - 1));
  return [x, y, z];
}

/** A palette index: 0 (empty) up to the last color. */
export function colorValue(v: unknown, label: string, paletteLength: number): number {
  return intValue(v, label, 0, paletteLength - 1);
}

/** An optional true/false argument; `fallback` when omitted. */
export function boolArg(args: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const v = args[key];
  if (v === undefined) return fallback;
  if (typeof v !== 'boolean') throw new Error(`'${key}' must be true or false (got ${shown(v)}).`);
  return v;
}

/** An optional argument that must be one of `options`; `fallback` when omitted. */
export function choiceArg<T extends string>(
  args: Record<string, unknown>,
  key: string,
  options: readonly T[],
  fallback: T,
): T {
  const v = args[key];
  if (v === undefined) return fallback;
  const match = options.find((o) => o === v);
  if (match === undefined) {
    throw new Error(`'${key}' must be one of ${options.map((o) => `"${o}"`).join(', ')} (got ${shown(v)}).`);
  }
  return match;
}

/** "#rrggbb" (the # is optional) as 0xRRGGBB. */
export function hexArg(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  const m = typeof v === 'string' ? HEX_COLOR.exec(v) : null;
  if (!m) throw new Error(`'${key}' must be a color like "#ff8800" (got ${shown(v)}).`);
  return parseInt(m[1], 16);
}
