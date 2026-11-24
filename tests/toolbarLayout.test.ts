import { describe, expect, it } from 'vitest';
import {
  clampToArea,
  DEFAULT_TOOLBAR_PREFS,
  dockAt,
  DRAG_THRESHOLD_PX,
  EDGE_ZONE_PX,
  floatPositionAt,
  isPastDragThreshold,
  parseToolbarPrefs,
  type ToolbarDock,
} from '../src/lib/ui/toolbarLayout';

describe('toolbar preferences', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseToolbarPrefs(null)).toEqual(DEFAULT_TOOLBAR_PREFS);
  });

  it('reads every valid dock position', () => {
    const docks: ToolbarDock[] = ['left', 'right', 'top', 'bottom', 'float'];
    for (const dock of docks) {
      expect(parseToolbarPrefs(JSON.stringify({ dock })).dock).toBe(dock);
    }
  });

  it('reads a saved floating position and compact mode', () => {
    expect(parseToolbarPrefs('{"dock":"float","floatX":120,"floatY":80,"isCompact":true}')).toEqual({
      dock: 'float',
      floatX: 120,
      floatY: 80,
      isCompact: true,
    });
  });

  it('falls back to the top edge for an unknown dock', () => {
    expect(parseToolbarPrefs('{"dock":"middle"}').dock).toBe('top');
  });

  it('ignores a saved value that is not an object', () => {
    for (const json of ['[]', '42', '"x"']) {
      expect(parseToolbarPrefs(json)).toEqual(DEFAULT_TOOLBAR_PREFS);
    }
  });

  it('uses the default position when a coordinate is not a finite number', () => {
    const prefs = parseToolbarPrefs('{"floatX":"10","floatY":null}');
    expect(prefs.floatX).toBe(DEFAULT_TOOLBAR_PREFS.floatX);
    expect(prefs.floatY).toBe(DEFAULT_TOOLBAR_PREFS.floatY);
  });

  it('moves a negative position to 0', () => {
    const prefs = parseToolbarPrefs('{"floatX":-30,"floatY":-1}');
    expect(prefs.floatX).toBe(0);
    expect(prefs.floatY).toBe(0);
  });

  it('keeps a large position so it is restored when the window grows again', () => {
    expect(parseToolbarPrefs('{"floatX":5000}').floatX).toBe(5000);
  });

  it('treats any compact value other than true as off', () => {
    expect(parseToolbarPrefs('{"isCompact":"yes"}').isCompact).toBe(false);
  });

  it('throws on malformed JSON so the caller can report it', () => {
    expect(() => parseToolbarPrefs('{')).toThrow();
  });
});

describe('dockAt', () => {
  const area = { left: 0, top: 0, width: 1000, height: 600 };

  it('floats in the middle of the area', () => {
    expect(dockAt(500, 300, area)).toBe('float');
  });

  it('docks to the edge the pointer is near', () => {
    expect(dockAt(10, 300, area)).toBe('left');
    expect(dockAt(990, 300, area)).toBe('right');
    expect(dockAt(500, 10, area)).toBe('top');
    expect(dockAt(500, 590, area)).toBe('bottom');
  });

  it('counts a pointer exactly at the zone width as near the edge', () => {
    expect(dockAt(EDGE_ZONE_PX, 300, area)).toBe('left');
    expect(dockAt(EDGE_ZONE_PX + 1, 300, area)).toBe('float');
  });

  it('picks the closer edge in a corner', () => {
    expect(dockAt(10, 30, area)).toBe('left');
    expect(dockAt(30, 10, area)).toBe('top');
  });

  it('docks to the nearest edge when the pointer is outside the area', () => {
    expect(dockAt(500, -40, area)).toBe('top');
    expect(dockAt(1100, 300, area)).toBe('right');
  });

  it('measures from the area position, not the window corner', () => {
    const offset = { left: 200, top: 100, width: 600, height: 400 };
    expect(dockAt(210, 300, offset)).toBe('left');
    expect(dockAt(10, 300, offset)).toBe('left');
    expect(dockAt(500, 300, offset)).toBe('float');
  });
});

describe('clampToArea', () => {
  it('keeps a box that already fits', () => {
    expect(clampToArea(100, 50, { w: 90, h: 300 }, { w: 1000, h: 600 })).toEqual({ x: 100, y: 50 });
  });

  it('pulls a box back inside the right and bottom edges', () => {
    expect(clampToArea(980, 500, { w: 90, h: 300 }, { w: 1000, h: 600 })).toEqual({ x: 910, y: 300 });
  });

  it('moves a negative position to 0', () => {
    expect(clampToArea(-20, -5, { w: 90, h: 300 }, { w: 1000, h: 600 })).toEqual({ x: 0, y: 0 });
  });

  it('pins a box larger than the area to the top-left corner', () => {
    expect(clampToArea(50, 50, { w: 1200, h: 900 }, { w: 1000, h: 600 })).toEqual({ x: 0, y: 0 });
  });

  it('returns the corner for an area of size 0', () => {
    expect(clampToArea(50, 50, { w: 90, h: 300 }, { w: 0, h: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('isPastDragThreshold', () => {
  const start = { x: 100, y: 100, offsetX: 8, offsetY: 6, width: 92, height: 400 };

  it('does not start a drag for a move of exactly the threshold', () => {
    expect(isPastDragThreshold(start, 100 + DRAG_THRESHOLD_PX, 100)).toBe(false);
  });

  it('starts a drag once the pointer moves past the threshold in any direction', () => {
    expect(isPastDragThreshold(start, 100, 100 - DRAG_THRESHOLD_PX - 1)).toBe(true);
  });
});

describe('floatPositionAt', () => {
  const start = { x: 0, y: 0, offsetX: 8, offsetY: 6, width: 92, height: 400 };
  const area = { left: 50, top: 40, width: 1000, height: 600 };

  it('keeps the grab point under the pointer, measured from the area corner', () => {
    expect(floatPositionAt(400, 300, start, area)).toEqual({ x: 342, y: 254 });
  });

  it('never saves a position left of or above the area', () => {
    expect(floatPositionAt(10, 10, start, area)).toEqual({ x: 0, y: 0 });
  });
});
