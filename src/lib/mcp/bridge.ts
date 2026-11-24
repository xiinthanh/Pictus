// Connects the Rust MCP relay to the app: listens for `mcp-request` events,
// answers them through protocol.ts, and keeps the on/off settings.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { newModel } from '$lib/actions';
import { errorText } from '$lib/platform/files';
import { app, editor } from '$lib/state/app.svelte';
import { handleHttp, type HttpIn, type HttpOut } from './protocol';
import { TOOLS, type ToolCtx } from './tools';

export const DEFAULT_PORT = 47821;
const KEY = 'pictus.mcp';

export interface McpSettings {
  enabled: boolean;
  port: number;
  token: string;
}

interface McpEvent extends HttpIn {
  id: number;
}

export function newToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function loadSettings(): McpSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v.token === 'string' && v.token.length >= 32 && Number.isInteger(v.port)) {
      return { enabled: v.enabled === true, port: v.port, token: v.token };
    }
  } catch {
    /* fall through to defaults */
  }
  return { enabled: false, port: DEFAULT_PORT, token: newToken() };
}

export function saveSettings(s: McpSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}

const ctx: ToolCtx = {
  editor,
  info: () => ({ name: app.docName, dirty: app.dirty, layer: app.layer, color: app.color }),
  newModel,
  highlight: (cells) => (app.highlight = cells),
  snapshot: () => null, // milestone M4
  notify: (tool) => app.flash(`AI: ${tool}`),
};

let unlisten: UnlistenFn | null = null;
/** Answers strictly one at a time, in arrival order. */
let queue: Promise<void> = Promise.resolve();

export async function startMcp(port: number, token: string): Promise<void> {
  await stopMcp();
  unlisten = await listen<McpEvent>('mcp-request', (e) => {
    queue = queue.then(() => answer(e.payload));
  });
  try {
    await invoke('mcp_start', { port, token });
  } catch (e) {
    unlisten();
    unlisten = null;
    throw new Error(errorText(e), { cause: e });
  }
  app.mcpOn = true;
}

export async function stopMcp(): Promise<void> {
  app.mcpOn = false;
  await invoke('mcp_stop').catch(() => {});
  unlisten?.();
  unlisten = null;
}

async function answer(ev: McpEvent): Promise<void> {
  let res: HttpOut;
  try {
    res = await handleHttp(ev, TOOLS, ctx);
  } catch (e) {
    res = {
      status: 500,
      body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: errorText(e) } }),
    };
  }
  await invoke('mcp_respond', { id: ev.id, status: res.status, body: res.body }).catch(() => {});
}

/** Starts the connection at launch if the user left it on (or a dev token is set). */
export async function startFromSettings(): Promise<void> {
  const devToken = import.meta.env.DEV ? (import.meta.env.VITE_PICTUS_MCP_TOKEN as string | undefined) : undefined;
  const s = loadSettings();
  if (!s.enabled && !devToken) return;
  try {
    await startMcp(s.port, devToken ?? s.token);
  } catch (e) {
    app.flash(`AI connection failed: ${errorText(e)}`, 8000);
  }
}
