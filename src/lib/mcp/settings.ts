// The AI connection setting as saved in localStorage, the token, and the
// one-time command that registers Pictus with Claude Code. Plain TypeScript
// with no Svelte or Tauri APIs, so it runs under vitest.

export interface McpSettings {
  /** Connect at launch: the user left the connection on last time. */
  isEnabled: boolean;
  /** Kept across launches so the Claude Code registration stays valid; null until first connect. */
  token: string | null;
}

export const MCP_SETTINGS_KEY = 'pictus.mcp';
export const DEFAULT_MCP_SETTINGS: Readonly<McpSettings> = { isEnabled: false, token: null };

const TOKEN_BYTES = 32;
const HEX_RADIX = 16;
const HEX_DIGITS_PER_BYTE = 2;
const TOKEN_PATTERN = new RegExp(`^[0-9a-f]{${TOKEN_BYTES * HEX_DIGITS_PER_BYTE}}$`);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Saved settings, with missing or invalid fields at their defaults. A dropped
 * token is replaced at the next connect, which shows the registration steps again.
 * Throws on malformed JSON.
 */
export function parseMcpSettings(json: string | null): McpSettings {
  const parsed: unknown = JSON.parse(json ?? '{}');
  const saved = isRecord(parsed) ? parsed : {};
  return {
    isEnabled: saved.isEnabled === true,
    token: typeof saved.token === 'string' && TOKEN_PATTERN.test(saved.token) ? saved.token : null,
  };
}

/** 32 random bytes as hex. `fillRandom` is replaceable so tests stay deterministic. */
export function newToken(
  fillRandom: (bytes: Uint8Array<ArrayBuffer>) => void = (b) => crypto.getRandomValues(b),
): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  fillRandom(bytes);
  return Array.from(bytes, (b) => b.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')).join('');
}

/** Registers Pictus for every folder (`--scope user`), so Claude Code finds it wherever it is started. */
export function connectCommand(port: number, token: string): string {
  return (
    `claude mcp add --transport http --scope user pictus http://127.0.0.1:${port}/mcp ` +
    `--header "Authorization: Bearer ${token}"`
  );
}
