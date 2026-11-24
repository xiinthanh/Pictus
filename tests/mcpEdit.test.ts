import { describe, expect, it } from 'vitest';
import { Editor } from '../src/lib/core/editor';
import { VoxelGrid } from '../src/lib/core/grid';
import { defaultPalette, MAX_COLORS } from '../src/lib/core/palette';
import { MAX_VOXELS_PER_CALL } from '../src/lib/mcp/editTools';
import { handleHttp } from '../src/lib/mcp/protocol';
import { TOOLS, type ToolCtx } from '../src/lib/mcp/tools';

/** 4 × 3 × 2 empty grid with the default palette (colors 1..16). */
function makeCtx(isDirty = false): ToolCtx {
  const editor = new Editor({ grid: new VoxelGrid(4, 3, 2), palette: defaultPalette(), voxelSize: 1 });
  return {
    editor,
    info: () => ({ name: 'Untitled', isDirty, isLayerMode: false, layer: 0, color: 1 }),
    newModel: (sx, sy, sz) => editor.load({ grid: new VoxelGrid(sx, sy, sz), palette: defaultPalette(), voxelSize: 1 }),
    aiSteps: [],
    notify: () => undefined,
  };
}

async function run(name: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<string> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  const [first] = await tool.run(args, ctx);
  if (first.type !== 'text') throw new Error(`${name} returned ${first.type}, expected text`);
  return first.text;
}

const at = (ctx: ToolCtx, x: number, y: number, z: number) => ctx.editor.grid.get(x, y, z);
const filled = (ctx: ToolCtx) => ctx.editor.grid.count();

describe('set_voxels', () => {
  it('sets each listed cell to its color', async () => {
    const ctx = makeCtx();
    await run(
      'set_voxels',
      {
        voxels: [
          [0, 0, 0, 4],
          [3, 2, 1, 16],
        ],
      },
      ctx,
    );
    expect([at(ctx, 0, 0, 0), at(ctx, 3, 2, 1)]).toEqual([4, 16]);
  });

  it('erases cells given color 0', async () => {
    const ctx = makeCtx();
    await run('set_voxels', { voxels: [[1, 1, 1, 5]] }, ctx);
    await run('set_voxels', { voxels: [[1, 1, 1, 0]] }, ctx);
    expect(filled(ctx)).toBe(0);
  });

  it('makes one call one undo step', async () => {
    const ctx = makeCtx();
    await run(
      'set_voxels',
      {
        voxels: [
          [0, 0, 0, 1],
          [1, 0, 0, 2],
          [2, 0, 0, 3],
        ],
      },
      ctx,
    );
    ctx.editor.undo();
    expect(filled(ctx)).toBe(0);
  });

  it('remembers the step as an AI edit', async () => {
    const ctx = makeCtx();
    await run('set_voxels', { voxels: [[0, 0, 0, 1]] }, ctx);
    expect(ctx.aiSteps).toEqual([ctx.editor.history.lastUndo]);
  });

  it('records no step when nothing changes', async () => {
    const ctx = makeCtx();
    const out = await run('set_voxels', { voxels: [[0, 0, 0, 0]] }, ctx);
    expect([out.startsWith('Changed 0 of 1'), ctx.aiSteps.length]).toEqual([true, 0]);
  });

  it.each([
    ['x past the edge', [4, 0, 0, 1], /'voxels\[1\] x' must be a whole number from 0 to 3/],
    ['a negative z', [0, 0, -1, 1], /'voxels\[1\] z' must be a whole number from 0 to 1/],
    ['a color not in the palette', [0, 0, 0, 17], /'voxels\[1\] color' must be a whole number from 0 to 16/],
    ['an entry of the wrong shape', [0, 0, 0], /'voxels\[1\]' must be \[x, y, z, color\]/],
  ])('rejects %s and changes nothing', async (_case, bad, message) => {
    const ctx = makeCtx();
    await expect(run('set_voxels', { voxels: [[1, 1, 0, 2], bad] }, ctx)).rejects.toThrow(message);
    expect(filled(ctx)).toBe(0);
  });

  it('rejects an empty list', async () => {
    await expect(run('set_voxels', { voxels: [] }, makeCtx())).rejects.toThrow(/list of 1 to/);
  });

  it(`rejects more than ${MAX_VOXELS_PER_CALL} entries`, async () => {
    const voxels = Array.from({ length: MAX_VOXELS_PER_CALL + 1 }, () => [0, 0, 0, 1]);
    await expect(run('set_voxels', { voxels }, makeCtx())).rejects.toThrow(`got ${MAX_VOXELS_PER_CALL + 1} entries`);
  });

  it('refuses while the user is drawing and changes nothing', async () => {
    const ctx = makeCtx();
    ctx.editor.beginStroke();
    await expect(run('set_voxels', { voxels: [[0, 0, 0, 1]] }, ctx)).rejects.toThrow(/user is drawing/);
    expect(filled(ctx)).toBe(0);
  });
});

describe('fill_box', () => {
  it('fills every cell between the corners, given in any order', async () => {
    const ctx = makeCtx();
    await run('fill_box', { from: [2, 1, 1], to: [0, 0, 0], color: 3 }, ctx);
    expect([filled(ctx), at(ctx, 2, 1, 1), at(ctx, 3, 0, 0)]).toEqual([12, 3, 0]);
  });

  it('erases with color 0', async () => {
    const ctx = makeCtx();
    await run('fill_box', { from: [0, 0, 0], to: [3, 2, 1], color: 1 }, ctx);
    await run('fill_box', { from: [0, 0, 0], to: [3, 2, 0], color: 0 }, ctx);
    expect(filled(ctx)).toBe(12);
  });

  it('makes one call one undo step', async () => {
    const ctx = makeCtx();
    await run('fill_box', { from: [0, 0, 0], to: [3, 2, 1], color: 1 }, ctx);
    ctx.editor.undo();
    expect(filled(ctx)).toBe(0);
  });

  it('rejects a corner outside the grid and changes nothing', async () => {
    const ctx = makeCtx();
    await expect(run('fill_box', { from: [0, 0, 0], to: [3, 3, 1], color: 1 }, ctx)).rejects.toThrow(
      /'to y' must be a whole number from 0 to 2/,
    );
    expect(filled(ctx)).toBe(0);
  });
});

describe('new_model', () => {
  it('replaces the model with an empty grid of the given size', async () => {
    const ctx = makeCtx();
    await run('new_model', { sx: 10, sy: 20, sz: 30 }, ctx);
    expect(ctx.editor.grid.dims).toEqual([10, 20, 30]);
  });

  it('forgets earlier AI steps, which the new model cannot undo', async () => {
    const ctx = makeCtx();
    await run('set_voxels', { voxels: [[0, 0, 0, 1]] }, ctx);
    await run('new_model', { sx: 2, sy: 2, sz: 2 }, ctx);
    expect(ctx.aiSteps).toEqual([]);
  });

  it('refuses while the open model has unsaved changes', async () => {
    const ctx = makeCtx(true);
    await expect(run('new_model', { sx: 2, sy: 2, sz: 2 }, ctx)).rejects.toThrow(/unsaved changes/);
    expect(ctx.editor.grid.dims).toEqual([4, 3, 2]);
  });

  it.each([0, 129])('rejects a side of %i', async (side) => {
    await expect(run('new_model', { sx: side, sy: 2, sz: 2 }, makeCtx())).rejects.toThrow(
      /'sx' must be a whole number from 1 to 128/,
    );
  });
});

describe('set_color', () => {
  it('changes an existing color', async () => {
    const ctx = makeCtx();
    await run('set_color', { hex: '#123456', index: 2 }, ctx);
    expect(ctx.editor.palette[2]).toBe(0x123456);
  });

  it('adds a new color and reports its index', async () => {
    const ctx = makeCtx();
    const out = await run('set_color', { hex: 'ABCDEF' }, ctx);
    expect([ctx.editor.palette[17], out]).toEqual([0xabcdef, 'Added #abcdef as color 17.']);
  });

  it('rejects a malformed hex color', async () => {
    await expect(run('set_color', { hex: 'red' }, makeCtx())).rejects.toThrow(/'hex' must be a color like/);
  });

  it('rejects an index that is not in the palette', async () => {
    await expect(run('set_color', { hex: '#000000', index: 17 }, makeCtx())).rejects.toThrow(
      /'index' must be a whole number from 1 to 16/,
    );
  });

  it('reports a full palette', async () => {
    const ctx = makeCtx();
    while (ctx.editor.palette.length <= MAX_COLORS) ctx.editor.addColor(0);
    await expect(run('set_color', { hex: '#000000' }, ctx)).rejects.toThrow(/palette is full/);
  });
});

describe('undo', () => {
  it("reverts the AI's last edit", async () => {
    const ctx = makeCtx();
    await run('set_voxels', { voxels: [[0, 0, 0, 1]] }, ctx);
    await run('undo', {}, ctx);
    expect([filled(ctx), ctx.aiSteps.length]).toEqual([0, 0]);
  });

  it('walks back several AI edits in order', async () => {
    const ctx = makeCtx();
    await run('set_voxels', { voxels: [[0, 0, 0, 1]] }, ctx);
    await run('set_voxels', { voxels: [[1, 0, 0, 1]] }, ctx);
    await run('undo', {}, ctx);
    await run('undo', {}, ctx);
    expect(filled(ctx)).toBe(0);
  });

  it("leaves the user's newer edit alone", async () => {
    const ctx = makeCtx();
    await run('set_voxels', { voxels: [[0, 0, 0, 1]] }, ctx);
    ctx.editor.apply([[ctx.editor.grid.index(3, 2, 1), 7]]);
    await expect(run('undo', {}, ctx)).rejects.toThrow(/not an AI edit/);
    expect([at(ctx, 0, 0, 0), at(ctx, 3, 2, 1)]).toEqual([1, 7]);
  });

  it('says so when there is no AI edit to undo', async () => {
    await expect(run('undo', {}, makeCtx())).rejects.toThrow(/no AI edit left/);
  });
});

describe('edit tools over MCP', () => {
  it('reports a rejected edit as an isError result', async () => {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'fill_box', arguments: { from: [0, 0, 0], to: [9, 0, 0], color: 1 } },
    });
    const r = await handleHttp({ body }, TOOLS, makeCtx());
    expect(JSON.parse(r.body).result).toMatchObject({ isError: true });
  });
});
