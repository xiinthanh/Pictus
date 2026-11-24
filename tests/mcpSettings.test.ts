import { describe, expect, it } from 'vitest';
import { connectCommand, DEFAULT_MCP_SETTINGS, newToken, parseMcpSettings } from '../src/lib/mcp/settings';

/** A fixed, obviously fake token: 64 hex characters. */
const TOKEN = 'ab'.repeat(32);

describe('AI connection settings', () => {
  it('starts disconnected with no token when nothing is saved', () => {
    expect(parseMcpSettings(null)).toEqual(DEFAULT_MCP_SETTINGS);
  });

  it('reads a saved connection and token', () => {
    expect(parseMcpSettings(JSON.stringify({ isEnabled: true, token: TOKEN }))).toEqual({
      isEnabled: true,
      token: TOKEN,
    });
  });

  it('drops a saved token that is not 64 hex characters', () => {
    expect(parseMcpSettings(JSON.stringify({ isEnabled: true, token: 'short' })).token).toBeNull();
  });

  it('treats a non-boolean isEnabled as off', () => {
    expect(parseMcpSettings(JSON.stringify({ isEnabled: 'yes', token: TOKEN })).isEnabled).toBe(false);
  });

  it('ignores a saved value that is not an object', () => {
    expect(parseMcpSettings('[]')).toEqual(DEFAULT_MCP_SETTINGS);
  });

  it('throws on malformed JSON so the caller can report it', () => {
    expect(() => parseMcpSettings('{')).toThrow();
  });
});

describe('newToken', () => {
  it('hex-encodes 32 random bytes', () => {
    expect(newToken((bytes) => bytes.fill(0xab))).toBe(TOKEN);
  });

  it('keeps leading zeros in each byte', () => {
    expect(newToken((bytes) => bytes.fill(0x05))).toBe('05'.repeat(32));
  });

  it('makes a token that parseMcpSettings accepts', () => {
    const token = newToken();
    expect(parseMcpSettings(JSON.stringify({ isEnabled: true, token })).token).toBe(token);
  });
});

describe('connectCommand', () => {
  it('registers Pictus with Claude Code for every folder', () => {
    expect(connectCommand(47821, TOKEN)).toBe(
      'claude mcp add --transport http --scope user pictus http://127.0.0.1:47821/mcp ' +
        `--header "Authorization: Bearer ${TOKEN}"`,
    );
  });
});
