// MCP tools that look at the model without changing it: the print check and a
// picture of the 3D view, so the AI can find and verify problems itself.
import { analyze, cellsAtVertex, type Part, type PrintReport } from '../core/analysis';
import type { Vec3, VoxelGrid } from '../core/grid';
import type { SnapshotView } from '../render/viewport';
import { boolArg, choiceArg, text } from './args';
import type { Content, Tool, ToolCtx } from './tools';

/** Enough for the AI to act on; a model with more problems needs fixing in passes anyway. */
const MAX_LISTED = 50;
/** Same cap as the Print check panel, so a huge loose part can't flood the highlight. */
const MAX_HIGHLIGHT_CELLS = 20_000;
/** Longest side of a snapshot: large enough to judge shapes, small enough to keep tokens down. */
export const SNAPSHOT_MAX_PX = 768;
const SNAPSHOT_VIEWS: readonly SnapshotView[] = ['overview', 'current'];

/** Bounding box and one member cell of a part, so the AI can locate it. */
function describePart(grid: VoxelGrid, part: Part) {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const i of part.indices) {
    grid.coords(i).forEach((v, axis) => {
      min[axis] = Math.min(min[axis], v);
      max[axis] = Math.max(max[axis], v);
    });
  }
  return { voxels: part.size, min, max, sampleCell: grid.coords(part.indices[0]) };
}

/** Indices of every loose-part cell, then every cell at a thin contact. */
function* problemIndices(grid: VoxelGrid, report: PrintReport): Generator<number> {
  for (const part of report.parts.slice(1)) yield* part.indices;
  for (const v of report.contacts) for (const [x, y, z] of cellsAtVertex(grid, v)) yield grid.index(x, y, z);
}

/** Problem cells for the 3D highlight; stops reading once the cap is reached. */
function problemCells(grid: VoxelGrid, report: PrintReport): Vec3[] {
  const seen = new Set<number>();
  for (const i of problemIndices(grid, report)) {
    if (seen.size >= MAX_HIGHLIGHT_CELLS) break;
    seen.add(i);
  }
  return Array.from(seen, (i) => grid.coords(i));
}

const printCheck: Tool = {
  name: 'print_check',
  title: 'Print check',
  description:
    'Checks the model for 3D-printing problems: loose parts (not face-connected to the main body, so they ' +
    'print as separate pieces) and thin contacts (voxels touching only along an edge or at a corner, which ' +
    `print weakly). Lists up to ${MAX_LISTED} of each with coordinates; parts[0] is the main body. ` +
    'By default also highlights the problems in the 3D view for the user.',
  inputSchema: {
    type: 'object',
    properties: { highlight: { type: 'boolean', description: 'Highlight problems in the 3D view (default true).' } },
    additionalProperties: false,
  },
  run: (args, ctx) => {
    const isHighlighting = boolArg(args, 'highlight', true);
    const { grid } = ctx.editor;
    const report = analyze(grid);
    const result = {
      voxels: report.voxels,
      hasProblems: report.parts.length > 1 || report.contacts.length > 0,
      partCount: report.parts.length,
      parts: report.parts.slice(0, MAX_LISTED).map((p) => describePart(grid, p)),
      thinContactCount: report.contacts.length,
      thinContacts: report.contacts.slice(0, MAX_LISTED).map((v) => ({ vertex: v, cells: cellsAtVertex(grid, v) })),
    };
    if (isHighlighting) ctx.highlight(problemCells(grid, report));
    // Compact: indented, every coordinate number would take its own line (and tokens).
    return [text(JSON.stringify(result))];
  },
};

function captureSnapshot(ctx: ToolCtx, view: SnapshotView): Content[] {
  const png = ctx.snapshot(view, SNAPSHOT_MAX_PX);
  if (!png) {
    throw new Error(
      'Could not capture the 3D view: it is not visible right now (hidden, or not laid out yet). ' +
        'Ask the user to show the Pictus window, then retry.',
    );
  }
  const image: Content = { type: 'image', data: png, mimeType: 'image/png' };
  const info = ctx.info();
  // Layer view hides the upper layers in every picture, which would otherwise look like missing voxels.
  if (!info.isLayerMode) return [image];
  return [image, text(`Layer view is on in Pictus: voxels above z=${info.layer} are hidden in this picture.`)];
}

const snapshot: Tool = {
  name: 'snapshot',
  title: 'Snapshot',
  description:
    `Returns a PNG of the 3D view (longest side up to ${SNAPSHOT_MAX_PX} px) so you can check your work. ` +
    '"overview" (default) shows the model from a 3/4 angle without moving the user\'s camera or drawing the ' +
    'editing cursors; "current" shows exactly what the user sees. In layer view the upper layers are hidden ' +
    'in both, and the reply says so.',
  inputSchema: {
    type: 'object',
    properties: { view: { type: 'string', enum: [...SNAPSHOT_VIEWS] } },
    additionalProperties: false,
  },
  run: (args, ctx) => captureSnapshot(ctx, choiceArg(args, 'view', SNAPSHOT_VIEWS, 'overview')),
};

export const INSPECT_TOOLS: Tool[] = [printCheck, snapshot];
