// Export dialog preferences as saved in localStorage. Plain TypeScript with no
// Svelte or browser APIs, so the parsing runs under vitest.

export type ExportFormat = '3mf' | 'stl' | 'obj';

export interface ExportPrefs {
  format: ExportFormat;
  isMultiColor: boolean;
}

export const EXPORT_PREFS_KEY = 'pictus.export';
export const DEFAULT_EXPORT_PREFS: Readonly<ExportPrefs> = { format: '3mf', isMultiColor: true };

const FORMATS: readonly ExportFormat[] = ['3mf', 'stl', 'obj'];

function isFormat(v: unknown): v is ExportFormat {
  return FORMATS.some((f) => f === v);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Saved prefs, with missing or unknown fields at their defaults. Throws on malformed JSON. */
export function parseExportPrefs(json: string | null): ExportPrefs {
  const parsed: unknown = JSON.parse(json ?? '{}');
  const saved = isRecord(parsed) ? parsed : {};
  return {
    format: isFormat(saved.format) ? saved.format : DEFAULT_EXPORT_PREFS.format,
    // Saved before the boolean rename as `multi`; honor it so a choice of "off" isn't silently flipped on.
    isMultiColor: (saved.isMultiColor ?? saved.multi) !== false,
  };
}
