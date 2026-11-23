import { deflateSync, inflateSync } from 'fflate';
import type { Model } from '../editor';
import { VoxelGrid } from '../grid';
import { MAX_COLORS } from '../palette';

/*
 * .pictus layout (little endian):
 *   "PCTS" | u16 version | u16 sx, sy, sz | f32 voxelSize(mm)
 *   u16 colorCount | colorCount × RGB (palette indices 1..colorCount)
 *   u32 byteLength | deflate(voxel bytes, x fastest, then y, then z)
 */
const MAGIC = 'PCTS';
const VERSION = 1;

export function encodePictus(m: Model): Uint8Array {
  const colors = m.palette.length - 1;
  const voxels = deflateSync(m.grid.data, { level: 9 });
  const headerSize = 4 + 2 + 6 + 4 + 2 + colors * 3 + 4;
  const out = new Uint8Array(headerSize + voxels.length);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = MAGIC.charCodeAt(i);
  let o = 4;
  view.setUint16(o, VERSION, true); o += 2;
  view.setUint16(o, m.grid.sx, true); o += 2;
  view.setUint16(o, m.grid.sy, true); o += 2;
  view.setUint16(o, m.grid.sz, true); o += 2;
  view.setFloat32(o, m.voxelSize, true); o += 4;
  view.setUint16(o, colors, true); o += 2;
  for (let i = 1; i <= colors; i++) {
    const c = m.palette[i];
    out[o++] = (c >> 16) & 255;
    out[o++] = (c >> 8) & 255;
    out[o++] = c & 255;
  }
  view.setUint32(o, voxels.length, true); o += 4;
  out.set(voxels, o);
  return out;
}

export function decodePictus(bytes: Uint8Array): Model {
  const fail = (why: string): never => {
    throw new Error(`Not a valid Pictus file (${why})`);
  };
  if (bytes.length < 20) fail('too short');
  for (let i = 0; i < 4; i++) if (bytes[i] !== MAGIC.charCodeAt(i)) fail('wrong header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 4;
  const version = view.getUint16(o, true); o += 2;
  if (version > VERSION) fail(`made by a newer Pictus, format v${version}`);
  const sx = view.getUint16(o, true); o += 2;
  const sy = view.getUint16(o, true); o += 2;
  const sz = view.getUint16(o, true); o += 2;
  const voxelSize = view.getFloat32(o, true); o += 4;
  const colors = view.getUint16(o, true); o += 2;
  if (colors > MAX_COLORS) fail('too many colors');
  if (o + colors * 3 + 4 > bytes.length) fail('truncated');
  const palette = [0];
  for (let i = 0; i < colors; i++, o += 3) palette.push((bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2]);
  const len = view.getUint32(o, true); o += 4;
  if (o + len > bytes.length) fail('truncated');
  let data: Uint8Array;
  try {
    data = inflateSync(bytes.subarray(o, o + len));
  } catch {
    return fail('corrupt voxel data');
  }
  if (data.length !== sx * sy * sz) fail('voxel data size mismatch');
  for (let i = 0; i < data.length; i++) if (data[i] > colors) data[i] = 0;
  return {
    grid: new VoxelGrid(sx, sy, sz, data),
    palette,
    voxelSize: voxelSize > 0 && Number.isFinite(voxelSize) ? voxelSize : 1,
  };
}
