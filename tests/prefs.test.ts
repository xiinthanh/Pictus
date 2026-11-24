import { describe, expect, it, vi } from 'vitest';
import { loadSetting, saveSetting } from '../src/lib/platform/storage';
import { DEFAULT_EXPORT_PREFS, parseExportPrefs } from '../src/lib/ui/exportPrefs';

describe('export preferences', () => {
  it('uses the defaults when nothing is saved', () => {
    expect(parseExportPrefs(null)).toEqual(DEFAULT_EXPORT_PREFS);
  });

  it('reads a saved format and multi-color choice', () => {
    expect(parseExportPrefs('{"format":"stl","isMultiColor":false}')).toEqual({ format: 'stl', isMultiColor: false });
  });

  it('falls back to 3MF for an unknown format', () => {
    expect(parseExportPrefs('{"format":"gcode"}').format).toBe('3mf');
  });

  it('ignores a saved value that is not an object', () => {
    expect(parseExportPrefs('[]')).toEqual(DEFAULT_EXPORT_PREFS);
  });

  it('keeps multi-color off when it was saved under the old "multi" key', () => {
    expect(parseExportPrefs('{"format":"3mf","multi":false}').isMultiColor).toBe(false);
  });

  it('prefers the new key over the old one', () => {
    expect(parseExportPrefs('{"isMultiColor":true,"multi":false}').isMultiColor).toBe(true);
  });

  it('throws on malformed JSON so the caller can report it', () => {
    expect(() => parseExportPrefs('{')).toThrow();
  });
});

/** In-memory stand-in for localStorage; `failWith` makes every call throw. */
function fakeStorage(saved: Record<string, string> = {}, failWith?: string): Pick<Storage, 'getItem' | 'setItem'> {
  const check = () => {
    if (failWith) throw new Error(failWith);
  };
  return {
    getItem: (k) => (check(), saved[k] ?? null),
    setItem: (k, v) => (check(), (saved[k] = v)),
  };
}

describe('saveSetting', () => {
  it('stores the value as JSON and reports no failure', () => {
    const saved: Record<string, string> = {};
    expect(saveSetting('k', { a: 1 }, fakeStorage(saved))).toBeNull();
    expect(saved.k).toBe('{"a":1}');
  });

  it('returns why the value could not be stored', () => {
    expect(saveSetting('k', 1, fakeStorage({}, 'quota exceeded'))).toBe('quota exceeded');
  });
});

describe('loadSetting', () => {
  const parseNumber = (json: string | null) => (json === null ? 0 : Number(JSON.parse(json)));

  it('parses the saved value', () => {
    expect(loadSetting('k', parseNumber, -1, fakeStorage({ k: '7' }))).toBe(7);
  });

  it('uses the fallback and warns when the saved JSON is malformed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(loadSetting('k', parseNumber, -1, fakeStorage({ k: '{' }))).toBe(-1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("setting 'k'"));
    warn.mockRestore();
  });

  it('uses the fallback and warns when storage is unavailable', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(loadSetting('k', parseNumber, -1, fakeStorage({}, 'blocked'))).toBe(-1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('blocked'));
    warn.mockRestore();
  });
});
