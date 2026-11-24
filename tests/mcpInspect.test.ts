import { describe, expect, it } from 'vitest';
import { analyze } from '../src/lib/core/analysis';
import { Editor } from '../src/lib/core/editor';
import { VoxelGrid, type Vec3 } from '../src/lib/core/grid';
import { defaultPalette } from '../src/lib/core/palette';
import type { SnapshotView } from '../src/lib/render/viewport';
import { SNAPSHOT_MAX_PX } from '../src/lib/mcp/inspectTools';
import { TOOLS, type Content, type ToolCtx } from '../src/lib/mcp/tools';

interface TestCtx extends ToolCtx {
  highlighted: Vec3[][];
  snapshots: [SnapshotView, number][];
}

/** Grid with the given cells set to color 1; `png` is what the 3D view "captures". */
function makeCtx(cells: Vec3[], size: Vec3 = [6, 6, 3], png: string | null = 'iVBOR', isBusy = false): TestCtx {
  const grid = new VoxelGrid(...size);
  for (const [x, y, z] of cells) grid.set(x, y, z, 1);
  const highlighted: Vec3[][] = [];
  const snapshots: [SnapshotView, number][] = [];
  return {
    editor: new Editor({ grid, palette: defaultPalette(), voxelSize: 1 }),
    info: () => ({ name: 'Untitled', isDirty: false, isBusy, isLayerMode: false, layer: 0, color: 1 }),
    newModel: () => {
      throw new Error('newModel is not used by these tests');
    },
    aiSteps: [],
    highlight: (c) => highlighted.push(c),
    snapshot: (view, maxPx) => (snapshots.push([view, maxPx]), png),
    notify: () => undefined,
    highlighted,
    snapshots,
  };
}

async function run(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<Content[]> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  return tool.run(args, ctx);
}

async function runJson(name: string, args: Record<string, unknown>, ctx: ToolCtx) {
  const [first] = await run(name, args, ctx);
  if (first.type !== 'text') throw new Error(`${name} returned ${first.type}, expected text`);
  return JSON.parse(first.text);
}

async function runText(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const [first] = await run(name, args, ctx);
  if (first.type !== 'text') throw new Error(`${name} returned ${first.type}, expected text`);
  return first.text;
}

const CUBE: Vec3[] = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [1, 1, 0],
];
/** Two voxels sharing only a vertical edge: a thin contact, and two loose parts. */
const DIAGONAL: Vec3[] = [
  [1, 1, 0],
  [2, 2, 0],
];

describe('print_check', () => {
  it('reports a single solid part as having no problems', async () => {
    const r = await runJson('print_check', {}, makeCtx(CUBE));
    expect([r.hasProblems, r.partCount, r.thinContactCount]).toEqual([false, 1, 0]);
  });

  it('locates a loose part by its bounding box', async () => {
    const r = await runJson('print_check', {}, makeCtx([...CUBE, [5, 5, 2]]));
    expect(r.parts[1]).toEqual({ voxels: 1, min: [5, 5, 2], max: [5, 5, 2], sampleCell: [5, 5, 2] });
  });

  it('lists a thin contact with the cells that meet there', async () => {
    const r = await runJson('print_check', {}, makeCtx(DIAGONAL));
    expect(r.thinContacts[0].cells).toEqual(expect.arrayContaining(DIAGONAL));
  });

  it('lists at most 50 parts but counts them all', async () => {
    const dots: Vec3[] = [];
    for (let x = 0; x < 20; x += 2) for (let y = 0; y < 20; y += 2) dots.push([x, y, 0]);
    const r = await runJson('print_check', {}, makeCtx(dots, [20, 20, 1]));
    expect([r.partCount, r.parts.length]).toEqual([100, 50]);
  });

  it('highlights the problem cells by default', async () => {
    const ctx = makeCtx([...CUBE, [5, 5, 2]]);
    await run('print_check', {}, ctx);
    expect(ctx.highlighted).toEqual([[[5, 5, 2]]]);
  });

  it('clears the highlight when there are no problems', async () => {
    const ctx = makeCtx(CUBE);
    await run('print_check', {}, ctx);
    expect(ctx.highlighted).toEqual([[]]);
  });

  it('leaves the 3D view alone when asked not to highlight', async () => {
    const ctx = makeCtx(DIAGONAL);
    await run('print_check', { highlight: false }, ctx);
    expect(ctx.highlighted).toEqual([]);
  });

  it('rejects a highlight value that is not true or false', async () => {
    await expect(run('print_check', { highlight: 'yes' }, makeCtx(CUBE))).rejects.toThrow(
      /'highlight' must be true or false/,
    );
  });
});

describe('fix_thin_contacts', () => {
  it('removes every thin contact it can', async () => {
    const ctx = makeCtx(DIAGONAL);
    await run('fix_thin_contacts', {}, ctx);
    expect(analyze(ctx.editor.grid).contacts).toEqual([]);
  });

  it('makes the fix one undo step', async () => {
    const ctx = makeCtx(DIAGONAL);
    await run('fix_thin_contacts', {}, ctx);
    ctx.editor.undo();
    expect(ctx.editor.grid.count()).toBe(DIAGONAL.length);
  });

  it('remembers the fix as an AI edit', async () => {
    const ctx = makeCtx(DIAGONAL);
    await run('fix_thin_contacts', {}, ctx);
    expect(ctx.aiSteps).toEqual([ctx.editor.history.lastUndo]);
  });

  it('says nothing was added when there is nothing to fix', async () => {
    const out = await runText('fix_thin_contacts', {}, makeCtx(CUBE));
    expect(out).toBe('Added 0 voxels to thicken thin contacts.');
  });

  it('refuses while Pictus is busy and changes nothing', async () => {
    const ctx = makeCtx(DIAGONAL, [6, 6, 3], 'iVBOR', true);
    await expect(run('fix_thin_contacts', {}, ctx)).rejects.toThrow(/Pictus is busy/);
    expect(ctx.editor.grid.count()).toBe(DIAGONAL.length);
  });
});

describe('snapshot', () => {
  it('returns the captured PNG as image content', async () => {
    expect(await run('snapshot', {}, makeCtx(CUBE))).toEqual([{ type: 'image', data: 'iVBOR', mimeType: 'image/png' }]);
  });

  it(`asks for an overview no larger than ${SNAPSHOT_MAX_PX} px by default`, async () => {
    const ctx = makeCtx(CUBE);
    await run('snapshot', {}, ctx);
    expect(ctx.snapshots).toEqual([['overview', SNAPSHOT_MAX_PX]]);
  });

  it("can capture the user's current view", async () => {
    const ctx = makeCtx(CUBE);
    await run('snapshot', { view: 'current' }, ctx);
    expect(ctx.snapshots[0][0]).toBe('current');
  });

  it('rejects an unknown view', async () => {
    await expect(run('snapshot', { view: 'top' }, makeCtx(CUBE))).rejects.toThrow(
      /'view' must be one of "overview", "current"/,
    );
  });

  it('explains when the view cannot be captured', async () => {
    await expect(run('snapshot', {}, makeCtx(CUBE, [6, 6, 3], null))).rejects.toThrow(/minimized or hidden/);
  });
});

describe('highlight after AI edits', () => {
  it('clears the print_check highlight once an edit changes cells', async () => {
    const ctx = makeCtx(DIAGONAL);
    await run('print_check', {}, ctx);
    await run('fix_thin_contacts', {}, ctx);
    expect(ctx.highlighted.at(-1)).toEqual([]);
  });

  it('keeps the highlight when an edit changes nothing', async () => {
    const ctx = makeCtx(DIAGONAL);
    await run('print_check', {}, ctx);
    await run('set_voxels', { voxels: [[0, 0, 0, 0]] }, ctx);
    expect(ctx.highlighted).toHaveLength(1);
  });

  it('clears the highlight when the AI undoes an edit', async () => {
    const ctx = makeCtx(CUBE);
    await run('set_voxels', { voxels: [[5, 5, 2, 1]] }, ctx);
    await run('print_check', {}, ctx);
    await run('undo', {}, ctx);
    expect(ctx.highlighted.at(-1)).toEqual([]);
  });
});
