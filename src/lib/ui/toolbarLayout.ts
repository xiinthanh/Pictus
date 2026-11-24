// Where the toolbar sits and how it is saved in localStorage. Plain TypeScript
// with no Svelte or browser APIs, so the parsing and geometry run under vitest.

export type ToolbarDock = 'left' | 'right' | 'top' | 'bottom' | 'float';

export interface ToolbarPrefs {
  dock: ToolbarDock;
  /** Top-left corner while floating, in px from the top-left of the work area. */
  floatX: number;
  floatY: number;
  isCompact: boolean;
}

export interface AreaRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a drag on the toolbar grip began, in window px. */
export interface ToolbarDragStart {
  x: number;
  y: number;
  /** Pointer position inside the toolbar, so the toolbar keeps its place under the pointer. */
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

export const TOOLBAR_PREFS_KEY = 'pictus.toolbar';
export const DEFAULT_TOOLBAR_PREFS: Readonly<ToolbarPrefs> = { dock: 'top', floatX: 16, floatY: 16, isCompact: false };

/** How close (px) the pointer must be to an edge of the work area to dock there. */
export const EDGE_ZONE_PX = 56;
/** How far (px) the pointer must move before a press on the grip becomes a drag, so a double-click is not a drag. */
export const DRAG_THRESHOLD_PX = 4;

const DOCKS: readonly ToolbarDock[] = ['left', 'right', 'top', 'bottom', 'float'];

function isDock(v: unknown): v is ToolbarDock {
  return DOCKS.some((d) => d === v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A saved coordinate, or the fallback if it is not a finite number. Negative values become 0. */
function coordinate(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : fallback;
}

/** Saved prefs, with missing or invalid fields at their defaults. Throws on malformed JSON. */
export function parseToolbarPrefs(json: string | null): ToolbarPrefs {
  const parsed: unknown = JSON.parse(json ?? '{}');
  const saved = isRecord(parsed) ? parsed : {};
  return {
    dock: isDock(saved.dock) ? saved.dock : DEFAULT_TOOLBAR_PREFS.dock,
    // A large position is kept: it is clamped when shown, so it comes back when the window grows again.
    floatX: coordinate(saved.floatX, DEFAULT_TOOLBAR_PREFS.floatX),
    floatY: coordinate(saved.floatY, DEFAULT_TOOLBAR_PREFS.floatY),
    isCompact: saved.isCompact === true,
  };
}

/** The edge the pointer is within EDGE_ZONE_PX of (the closest one in a corner), or 'float' in the middle. */
export function dockAt(x: number, y: number, area: AreaRect): ToolbarDock {
  // Distances are negative outside the area, so a pointer outside snaps to the edge it left by.
  const distances: [ToolbarDock, number][] = [
    ['left', x - area.left],
    ['right', area.left + area.width - x],
    ['top', y - area.top],
    ['bottom', area.top + area.height - y],
  ];
  const [edge, distance] = distances.reduce((best, d) => (d[1] < best[1] ? d : best));
  return distance <= EDGE_ZONE_PX ? edge : 'float';
}

/** Moves the top-left corner of a w×h box so the box stays inside an areaW×areaH area; a box too big sits at 0. */
export function clampToArea(
  x: number,
  y: number,
  size: { w: number; h: number },
  area: { w: number; h: number },
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(x, area.w - size.w)),
    y: Math.max(0, Math.min(y, area.h - size.h)),
  };
}

/** True once the pointer has moved more than DRAG_THRESHOLD_PX from where the grip was pressed. */
export function isPastDragThreshold(start: ToolbarDragStart, x: number, y: number): boolean {
  return Math.hypot(x - start.x, y - start.y) > DRAG_THRESHOLD_PX;
}

/** Floating position (relative to the area, never negative) that keeps the grab point under the pointer. */
export function floatPositionAt(
  x: number,
  y: number,
  start: ToolbarDragStart,
  area: AreaRect,
): { x: number; y: number } {
  return {
    x: Math.max(0, x - start.offsetX - area.left),
    y: Math.max(0, y - start.offsetY - area.top),
  };
}
