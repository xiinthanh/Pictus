import type { Body } from '../mesher';
import type { Palette } from '../palette';
import { num } from './format';

/** Wavefront OBJ (+ MTL): one object and material per body. */
export function writeObj(
  bodies: Body[],
  palette: Palette,
  scale: number,
  mtlFileName: string,
): { obj: string; mtl: string } {
  const obj: string[] = ['# Pictus', `mtllib ${mtlFileName}`];
  const mtl: string[] = ['# Pictus'];
  let offset = 1;
  for (const b of bodies) {
    const name = b.color ? `color_${b.color}` : 'model';
    obj.push(`o ${name}`);
    const p = b.positions;
    for (let i = 0; i < p.length; i += 3) {
      obj.push(`v ${num(p[i] * scale)} ${num(p[i + 1] * scale)} ${num(p[i + 2] * scale)}`);
    }
    obj.push(`usemtl ${name}`);
    for (let t = 0; t < b.indices.length; t += 3) {
      obj.push(`f ${b.indices[t] + offset} ${b.indices[t + 1] + offset} ${b.indices[t + 2] + offset}`);
    }
    offset += p.length / 3;

    const c = b.color ? palette[b.color] : 0xcccccc;
    const r = ((c >> 16) & 255) / 255,
      g = ((c >> 8) & 255) / 255,
      bl = (c & 255) / 255;
    mtl.push(`newmtl ${name}`, `Kd ${num(r)} ${num(g)} ${num(bl)}`, 'Ka 0 0 0', 'Ks 0 0 0', 'd 1', 'illum 1', '');
  }
  return { obj: obj.join('\n') + '\n', mtl: mtl.join('\n') };
}
