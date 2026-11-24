// Small settings kept in localStorage (recent files, dialog choices). Losing one
// is an inconvenience, not an error the user must act on, so failures come
// back as values for the caller to report instead of being thrown.

type SettingsStorage = Pick<Storage, 'getItem' | 'setItem'>;

function reason(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Saves `value` as JSON. Returns null on success, or why it could not be saved. */
export function saveSetting(key: string, value: unknown, storage: SettingsStorage = localStorage): string | null {
  try {
    storage.setItem(key, JSON.stringify(value));
    return null;
  } catch (e) {
    return reason(e);
  }
}

/**
 * The saved setting run through `parse` (which gets null when nothing is
 * saved). If storage or the saved data can't be read, warns and returns `fallback`.
 */
export function loadSetting<T>(
  key: string,
  parse: (json: string | null) => T,
  fallback: T,
  storage: SettingsStorage = localStorage,
): T {
  try {
    return parse(storage.getItem(key));
  } catch (e) {
    console.warn(`Pictus: could not read setting '${key}' (${reason(e)}); using the default.`);
    return fallback;
  }
}
