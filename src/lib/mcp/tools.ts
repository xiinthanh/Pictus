// MCP tools exposed to AI clients. Plain TypeScript with relative imports and no
// app state: everything app-specific comes in through `ToolCtx`, so this file
// runs under vitest without Svelte.
import type { Editor } from '../core/editor';
import { toCss } from '../core/palette';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

/** Editor state that lives in the app rather than in the model. */
export interface AppInfo {
  name: string;
  isDirty: boolean;
  isLayerMode: boolean;
  layer: number;
  color: number;
}

export interface ToolCtx {
  editor: Editor;
  info(): AppInfo;
  /** Tells the user which tool the AI just used. */
  notify(tool: string): void;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolCtx): Content[] | Promise<Content[]>;
}

/** Hex digits per cell in `get_layer` rows: color indexes go up to 255. */
const CELL_HEX_WIDTH = 2;

function text(value: string): Content {
  return { type: 'text', text: value };
}

/** A whole number from `min` to `max`, or an error the AI can act on. */
function intArg(args: Record<string, unknown>, key: string, min: number, max: number): number {
  const v = args[key];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`'${key}' must be a whole number from ${min} to ${max} (got ${JSON.stringify(v) ?? 'nothing'}).`);
  }
  return v;
}

const getModel: Tool = {
  name: 'get_model',
  title: 'Get model',
  description:
    'Describes the model open in Pictus: grid size, voxel count, voxel size in mm, the color palette ' +
    '(index -> #rrggbb; index 0 is empty) and editor state (file name, unsaved changes, current color, ' +
    'and the layer view). layerView.z is 0-based like every coordinate here; the UI labels that layer ' +
    'z+1 (layerView.shownInUiAs). Call this first.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  run: (_args, ctx) => {
    const { grid, palette, voxelSize } = ctx.editor;
    const info = ctx.info();
    const summary = {
      name: info.name,
      hasUnsavedChanges: info.isDirty,
      size: { x: grid.sx, y: grid.sy, z: grid.sz },
      voxelSizeMm: voxelSize,
      voxelCount: grid.count(),
      palette: palette.slice(1).map((c, i) => ({ index: i + 1, hex: toCss(c) })),
      currentColor: info.color,
      // The app keeps its last layer while the view is off; reporting it would point the AI at a stale layer.
      layerView: info.isLayerMode ? { isOn: true, z: info.layer, shownInUiAs: info.layer + 1 } : { isOn: false },
    };
    return [text(JSON.stringify(summary, null, 2))];
  },
};

const getLayer: Tool = {
  name: 'get_layer',
  title: 'Get layer',
  description:
    'Returns one horizontal layer (fixed z) as text. One line per row, from the highest y at the top down to y=0; ' +
    `each cell is ${CELL_HEX_WIDTH} hex digits giving the palette index at x=0,1,2… ("00" = empty).`,
  inputSchema: {
    type: 'object',
    properties: { z: { type: 'integer', minimum: 0, description: 'Layer to read, 0 = bottom.' } },
    required: ['z'],
    additionalProperties: false,
  },
  run: (args, ctx) => {
    const grid = ctx.editor.grid;
    const z = intArg(args, 'z', 0, grid.sz - 1);
    const rows: string[] = [];
    for (let y = grid.sy - 1; y >= 0; y--) {
      let row = '';
      for (let x = 0; x < grid.sx; x++) row += grid.get(x, y, z).toString(16).padStart(CELL_HEX_WIDTH, '0');
      rows.push(`y=${y}: ${row}`);
    }
    return [text(`Layer z=${z} (${grid.sx} × ${grid.sy}):\n${rows.join('\n')}`)];
  },
};

export const TOOLS: Tool[] = [getModel, getLayer];
