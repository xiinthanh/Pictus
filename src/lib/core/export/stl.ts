import type { Body } from '../mesher';

/** Binary STL of one or more bodies, scaled from voxel units to millimetres. */
export function writeStl(bodies: Body[], scale: number): Uint8Array {
  let triangles = 0;
  for (const b of bodies) triangles += b.indices.length / 3;
  const buf = new ArrayBuffer(84 + triangles * 50);
  const view = new DataView(buf);
  const header = 'Pictus binary STL';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triangles, true);
  let o = 84;
  for (const b of bodies) {
    const p = b.positions;
    for (let t = 0; t < b.indices.length; t += 3) {
      const ia = b.indices[t] * 3,
        ib = b.indices[t + 1] * 3,
        ic = b.indices[t + 2] * 3;
      const ux = p[ib] - p[ia],
        uy = p[ib + 1] - p[ia + 1],
        uz = p[ib + 2] - p[ia + 2];
      const vx = p[ic] - p[ia],
        vy = p[ic + 1] - p[ia + 1],
        vz = p[ic + 2] - p[ia + 2];
      let nx = uy * vz - uz * vy,
        ny = uz * vx - ux * vz,
        nz = ux * vy - uy * vx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      view.setFloat32(o, nx, true);
      view.setFloat32(o + 4, ny, true);
      view.setFloat32(o + 8, nz, true);
      o += 12;
      for (const i of [ia, ib, ic]) {
        view.setFloat32(o, p[i] * scale, true);
        view.setFloat32(o + 4, p[i + 1] * scale, true);
        view.setFloat32(o + 8, p[i + 2] * scale, true);
        o += 12;
      }
      view.setUint16(o, 0, true);
      o += 2;
    }
  }
  return new Uint8Array(buf);
}
