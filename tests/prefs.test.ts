import { describe, expect, it } from 'vitest';
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
