// MCP tools that change the model. Each call is exactly one undo step, is
// refused while the user is mid-drag or Pictus is busy, and validates every argument before
// touching the model, so a rejected call changes nothing.
import { fixThinContacts } from '../core/analysis';
import { MAX_DIM, type VoxelGrid } from '../core/grid';
import { MAX_COLORS, toCss } from '../core/palette';
import { boxCells, cellsToIndices } from '../core/tools';
import { cellValue, colorValue, hexArg, intArg, intValue, text } from './args';
import type { Tool, ToolCtx } from './tools';

/** The AI sends each cell explicitly; larger shapes should use fill_box or several calls. */
export const MAX_VOXELS_PER_CALL = 20_000;
/** A `set_voxels` entry: [x, y, z, color]. */
const VOXEL_ENTRY_LENGTH = 4;
const CELL_LENGTH = VOXEL_ENTRY_LENGTH - 1;

/** Only an edit that recorded an undo step can be undone; don't suggest it otherwise. */
function undoHint(changed: number): string {
  return changed > 0 ? ' The user can undo it with Ctrl+Z; you can with the undo tool.' : '';
}

/**
 * Edits must wait while the user draws (they'd merge into the user's stroke) and
 * while a dialog, file picker or save is open (a save could mark them as saved
 * without writing them, or an open/new could replace them without asking).
 */
function refuseWhileBusy(ctx: ToolCtx): void {
  if (ctx.editor.isInStroke) throw new Error('The user is drawing in Pictus right now. Retry in a moment.');
  if (ctx.info().isBusy) {
    throw new Error('Pictus is busy (a dialog, file picker or save is open). Retry once the user has finished.');
  }
}

/**
 * Drops AI steps History no longer keeps (trimmed by its size limits, cleared
 * by a new or opened model, or replaced after an undo), so they don't pin memory.
 */
function forgetDroppedSteps(ctx: ToolCtx): void {
  const { aiSteps, editor } = ctx;
  const kept = aiSteps.filter((s) => editor.history.holds(s));
  aiSteps.splice(0, aiSteps.length, ...kept);
}

/**
 * Runs `change` as one undo step and remembers that step as the AI's. Returns
 * the cells in the recorded step, i.e. those whose value really changed (writes
 * that cancel out, like setting a cell then clearing it, don't count).
 */
function edit(ctx: ToolCtx, change: () => void): number {
  refuseWhileBusy(ctx);
  const { editor, aiSteps } = ctx;
  const before = editor.history.lastUndo;
  editor.beginStroke();
  try {
    change();
  } finally {
    editor.endStroke();
  }
  const step = editor.history.lastUndo;
  const isNewStep = step !== null && step !== before;
  if (isNewStep) {
    aiSteps.push(step);
    // A print_check highlight marks problems in the old model; left on, it would show fixed problems.
    ctx.highlight([]);
  }
  forgetDroppedSteps(ctx);
  return isNewStep ? step.idx.length : 0;
}

/** `[index, color]` pairs for `voxels`, or an error naming the first bad entry. */
function voxelsArg(args: Record<string, unknown>, grid: VoxelGrid, paletteLength: number): [number, number][] {
  const list = args.voxels;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_VOXELS_PER_CALL) {
    const got = Array.isArray(list) ? `${list.length} entries` : (JSON.stringify(list) ?? 'nothing');
    throw new Error(`'voxels' must be a list of 1 to ${MAX_VOXELS_PER_CALL} [x, y, z, color] entries (got ${got}).`);
  }
  return list.map((entry: unknown, i): [number, number] => {
    const label = `voxels[${i}]`;
    if (!Array.isArray(entry) || entry.length !== VOXEL_ENTRY_LENGTH) {
      throw new Error(`'${label}' must be [x, y, z, color] (got ${JSON.stringify(entry) ?? 'nothing'}).`);
    }
    const [x, y, z] = cellValue(entry.slice(0, CELL_LENGTH), label, grid);
    return [grid.index(x, y, z), colorValue(entry[CELL_LENGTH], `${label} color`, paletteLength)];
  });
}

const CELL_SCHEMA = {
  type: 'array',
  items: { type: 'integer', minimum: 0 },
  minItems: CELL_LENGTH,
  maxItems: CELL_LENGTH,
};
const COLOR_SCHEMA = { type: 'integer', minimum: 0, description: 'Palette index; 0 erases.' };

const setVoxels: Tool = {
  name: 'set_voxels',
  title: 'Set voxels',
  description:
    `Sets individual cells, up to ${MAX_VOXELS_PER_CALL} per call, as one undo step. ` +
    'Each entry is [x, y, z, color]; color 0 erases. If any entry is invalid, nothing is changed.',
  inputSchema: {
    type: 'object',
    properties: {
      voxels: {
        type: 'array',
        minItems: 1,
        maxItems: MAX_VOXELS_PER_CALL,
        items: {
          type: 'array',
          items: { type: 'integer', minimum: 0 },
          minItems: VOXEL_ENTRY_LENGTH,
          maxItems: VOXEL_ENTRY_LENGTH,
        },
      },
    },
    required: ['voxels'],
    additionalProperties: false,
  },
  run: (args, ctx) => {
    const pairs = voxelsArg(args, ctx.editor.grid, ctx.editor.palette.length);
    const changed = edit(ctx, () => ctx.editor.apply(pairs));
    return [text(`Changed ${changed} of ${pairs.length} cells.${undoHint(changed)}`)];
  },
};

const fillBox: Tool = {
  name: 'fill_box',
  title: 'Fill box',
  description:
    'Sets every cell of the axis-aligned box between two corners (inclusive) to one color, as one undo step. ' +
    'Color 0 erases. Both corners must lie inside the grid.',
  inputSchema: {
    type: 'object',
    properties: { from: CELL_SCHEMA, to: CELL_SCHEMA, color: COLOR_SCHEMA },
    required: ['from', 'to', 'color'],
    additionalProperties: false,
  },
  run: (args, ctx) => {
    const { grid, palette } = ctx.editor;
    const from = cellValue(args.from, 'from', grid);
    const to = cellValue(args.to, 'to', grid);
    const color = colorValue(args.color, 'color', palette.length);
    const idx = cellsToIndices(grid, boxCells(grid, from, to));
    const changed = edit(ctx, () => ctx.editor.fill(idx, color));
    return [text(`Changed ${changed} of ${idx.length} cells in the box to color ${color}.${undoHint(changed)}`)];
  },
};

const fixContacts: Tool = {
  name: 'fix_thin_contacts',
  title: 'Fix thin contacts',
  description:
    'Thickens every thin contact that print_check reports (voxels touching only along an edge or at a corner) ' +
    'by filling neighbouring empty cells with an adjacent color, as one undo step. Contacts at the grid ' +
    'boundary may be left; the reply says how many.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: (_args, ctx) => {
    const { changes, remaining } = fixThinContacts(ctx.editor.grid);
    const added = edit(ctx, () => ctx.editor.apply(changes));
    const left = remaining ? ` ${remaining} contacts at the grid edge could not be fixed.` : '';
    return [text(`Added ${added} voxels to thicken thin contacts.${left}${undoHint(added)}`)];
  },
};

const newModel: Tool = {
  name: 'new_model',
  title: 'New model',
  description:
    `Replaces the open model with an empty grid (each side 1 to ${MAX_DIM}) and the default palette. ` +
    'Refused while the open model has unsaved changes. This clears the undo history and cannot be undone.',
  inputSchema: {
    type: 'object',
    properties: Object.fromEntries(
      ['sx', 'sy', 'sz'].map((k) => [k, { type: 'integer', minimum: 1, maximum: MAX_DIM }]),
    ),
    required: ['sx', 'sy', 'sz'],
    additionalProperties: false,
  },
  run: (args, ctx) => {
    const [sx, sy, sz] = ['sx', 'sy', 'sz'].map((k) => intArg(args, k, 1, MAX_DIM));
    refuseWhileBusy(ctx);
    if (ctx.info().isDirty) {
      throw new Error('The open model has unsaved changes. Ask the user to save or discard them first.');
    }
    ctx.newModel(sx, sy, sz);
    ctx.aiSteps.length = 0;
    return [text(`Created an empty ${sx} × ${sy} × ${sz} model with the default palette.`)];
  },
};

const setColor: Tool = {
  name: 'set_color',
  title: 'Set color',
  description:
    'Changes palette color `index` to `hex`, or adds `hex` as a new color when `index` is omitted. ' +
    'Returns the index. Palette changes cannot be undone (with Ctrl+Z or the undo tool).',
  inputSchema: {
    type: 'object',
    properties: {
      hex: { type: 'string', pattern: '^#?[0-9a-fA-F]{6}$', description: 'Like "#ff8800".' },
      index: { type: 'integer', minimum: 1, description: 'Existing color to change; omit to add a color.' },
    },
    required: ['hex'],
    additionalProperties: false,
  },
  run: (args, ctx) => {
    const { editor } = ctx;
    const color = hexArg(args, 'hex');
    const index = args.index === undefined ? null : intValue(args.index, 'index', 1, editor.palette.length - 1);
    refuseWhileBusy(ctx);
    if (index !== null) {
      editor.setColor(index, color);
      return [text(`Color ${index} is now ${toCss(color)}.`)];
    }
    const added = editor.addColor(color);
    if (added < 0) throw new Error(`The palette is full (${MAX_COLORS} colors). Change an existing color instead.`);
    return [text(`Added ${toCss(color)} as color ${added}.`)];
  },
};

const undo: Tool = {
  name: 'undo',
  title: 'Undo AI edit',
  description:
    "Reverts the latest step in Pictus if the AI made it. It never reverts the user's own edits: when the " +
    'latest step is theirs, it refuses.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: (_args, ctx) => {
    refuseWhileBusy(ctx);
    forgetDroppedSteps(ctx);
    const { editor, aiSteps } = ctx;
    const top = editor.history.lastUndo;
    if (!top) throw new Error('There is no AI edit left to undo.');
    // Any AI step may be on top: the user can Ctrl+Z the AI's latest edits, exposing an earlier one.
    if (!aiSteps.includes(top)) {
      throw new Error(
        "The latest step in Pictus is the user's own edit, so nothing was undone. " +
          'Ask the user to press Ctrl+Z if they want it reverted.',
      );
    }
    // The step stays in aiSteps while it sits on the redo stack, so a Ctrl+Y makes it the AI's again.
    editor.undo();
    ctx.highlight([]);
    return [text(`Undid the last AI edit (${top.idx.length} cells).`)];
  },
};

export const EDIT_TOOLS: Tool[] = [setVoxels, fillBox, fixContacts, newModel, setColor, undo];
