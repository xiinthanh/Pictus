import { strToU8, zipSync } from 'fflate';
import type { Body } from '../mesher';
import type { Palette } from '../palette';
import { hex6, num } from './format';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** The 3D/3dmodel.model XML: one mesh object per body, grouped into one multi-part object. */
export function modelXml(bodies: Body[], palette: Palette, scale: number, name: string): string {
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ' <metadata name="Application">Pictus</metadata>',
    ` <metadata name="Title">${escapeXml(name)}</metadata>`,
    ' <resources>',
    '  <basematerials id="1">',
  ];
  for (const b of bodies) {
    const c = b.color ? palette[b.color] : 0xcccccc;
    out.push(`   <base name="${b.color ? `Color ${b.color}` : 'Model'}" displaycolor="#${hex6(c)}FF"/>`);
  }
  out.push('  </basematerials>');
  bodies.forEach((b, k) => {
    const label = b.color ? `Color ${b.color} #${hex6(palette[b.color])}` : escapeXml(name);
    out.push(
      `  <object id="${k + 2}" type="model" pid="1" pindex="${k}" name="${label}">`,
      '   <mesh>',
      '    <vertices>',
    );
    const p = b.positions;
    for (let i = 0; i < p.length; i += 3) {
      out.push(`     <vertex x="${num(p[i] * scale)}" y="${num(p[i + 1] * scale)}" z="${num(p[i + 2] * scale)}"/>`);
    }
    out.push('    </vertices>', '    <triangles>');
    for (let t = 0; t < b.indices.length; t += 3) {
      out.push(`     <triangle v1="${b.indices[t]}" v2="${b.indices[t + 1]}" v3="${b.indices[t + 2]}"/>`);
    }
    out.push('    </triangles>', '   </mesh>', '  </object>');
  });
  let buildId = 2;
  if (bodies.length > 1) {
    buildId = bodies.length + 2;
    out.push(`  <object id="${buildId}" type="model" name="${escapeXml(name)}">`, '   <components>');
    bodies.forEach((_, k) => out.push(`    <component objectid="${k + 2}"/>`));
    out.push('   </components>', '  </object>');
  }
  out.push(' </resources>', ' <build>', `  <item objectid="${buildId}"/>`, ' </build>', '</model>');
  return out.join('\n');
}

/** A 3MF package. Multi-color models become one object with a part per color. */
export function write3mf(bodies: Body[], palette: Palette, scale: number, name: string): Uint8Array {
  return zipSync(
    {
      '[Content_Types].xml': strToU8(CONTENT_TYPES),
      '_rels/.rels': strToU8(RELS),
      '3D/3dmodel.model': strToU8(modelXml(bodies, palette, scale, name)),
    },
    { level: 6 },
  );
}
