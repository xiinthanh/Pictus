// Connects the Rust MCP relay to the app: listens for `mcp-request` events and
// answers them through protocol.ts, and runs the menu's Connect AI button.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { newModel } from '$lib/actions';
import { errorText } from '$lib/platform/files';
import { loadSetting, saveSetting } from '$lib/platform/storage';
import type { Viewport } from '$lib/render/viewport';
import { app, editor } from '$lib/state/app.svelte';
import { handleHttp, type HttpIn } from './protocol';
import {
  connectCommand,
  DEFAULT_MCP_SETTINGS,
  MCP_SETTINGS_KEY,
  newToken,
  parseMcpSettings,
  type McpSettings,
} from './settings';
import { TOOLS, type ToolCtx } from './tools';

export const DEFAULT_PORT = 47821;
const ERROR_FLASH_MS = 8000;

interface McpEvent extends HttpIn {
  id: number;
}

const ctx: ToolCtx = {
  editor,
  info: () => ({
    name: app.docName,
    isDirty: app.isDirty,
    isBusy: app.dialog !== null || app.confirm !== null || app.busyTasks > 0,
    isLayerMode: app.isLayerMode,
    layer: app.layer,
    color: app.color,
  }),
  newModel,
  aiSteps: [],
  highlight: (cells) => (app.highlight = cells),
  snapshot: () => null,
  notify: (tool) => app.flash(`AI: ${tool}`),
};

/** Lets `snapshot` read the 3D view while it exists; pass null when it is torn down. */
export function registerViewport(view: Viewport | null): void {
  ctx.snapshot = view ? (which, maxPx) => view.snapshot(which, maxPx) : () => null;
}

let unlisteners: UnlistenFn[] = [];
/** Answers strictly one at a time, in arrival order. */
let answers: Promise<void> = Promise.resolve();
/** Start/stop steps run one after another, so two starts can't both add listeners. */
let lifecycle: Promise<void> = Promise.resolve();

function serialize(step: () => Promise<void>): Promise<void> {
  const run = lifecycle.then(step);
  // The caller gets the error from `run`; the chain itself must survive it.
  lifecycle = run.catch(() => undefined);
  return run;
}

export function startMcp(port: number, token: string): Promise<void> {
  return serialize(async () => {
    await stopNow();
    unlisteners = [
      await listen<McpEvent>('mcp-request', (e) => {
        // A failure must not break the chain, or every later request would hang.
        answers = answers
          .then(() => answer(e.payload))
          .catch((err) => console.error(`Pictus MCP: request ${e.payload.id} failed: ${errorText(err)}`));
      }),
      await listen<{ error: string }>('mcp-stopped', (e) => {
        app.flash(`AI connection stopped: ${e.payload.error}`, ERROR_FLASH_MS);
        void stopMcp().catch(reportStopError);
      }),
    ];
    try {
      await invoke('mcp_start', { port, token });
    } catch (e) {
      removeListeners();
      throw new Error(errorText(e), { cause: e });
    }
    app.isMcpOn = true;
  });
}

export function stopMcp(): Promise<void> {
  return serialize(stopNow);
}

async function stopNow(): Promise<void> {
  try {
    await invoke('mcp_stop');
  } finally {
    removeListeners();
    app.isMcpOn = false;
  }
}

function removeListeners(): void {
  for (const off of unlisteners) off();
  unlisteners = [];
}

async function answer(ev: McpEvent): Promise<void> {
  const res = await handleHttp(ev, TOOLS, ctx);
  try {
    await invoke('mcp_respond', { id: ev.id, status: res.status, body: res.body });
  } catch (e) {
    // The relay already gave up on this request (timeout or shutdown); nothing left to answer.
    console.warn(`Pictus MCP: could not answer request ${ev.id}: ${errorText(e)}`);
  }
}

function reportStopError(e: unknown): void {
  app.flash(`Could not stop the AI connection: ${errorText(e)}`, ERROR_FLASH_MS);
}

/**
 * Dev only: `VITE_PICTUS_MCP_TOKEN=<token> pnpm tauri dev` connects at launch
 * with that token instead of the saved one. Dev and installed builds keep separate
 * storage, so this keeps a dev build from needing its own Claude Code registration.
 */
function devToken(): string | null {
  return import.meta.env.DEV ? ((import.meta.env.VITE_PICTUS_MCP_TOKEN as string | undefined) ?? null) : null;
}

function savedSettings(): McpSettings {
  return loadSetting(MCP_SETTINGS_KEY, parseMcpSettings, { ...DEFAULT_MCP_SETTINGS });
}

/** The connection still works this session if the choice can't be saved, so it only needs mentioning. */
function rememberNote(settings: McpSettings): string {
  const failure = saveSetting(MCP_SETTINGS_KEY, settings);
  return failure ? ` (could not remember this for the next launch: ${failure})` : '';
}

/** Reconnects if the user left the connection on last time. */
export async function startAtLaunch(): Promise<void> {
  const saved = savedSettings();
  const token = devToken() ?? (saved.isEnabled ? saved.token : null);
  if (!token) return;
  try {
    await startMcp(DEFAULT_PORT, token);
  } catch (e) {
    app.flash(`AI connection failed: ${errorText(e)}`, ERROR_FLASH_MS);
  }
}

/** The menu's Connect AI button: turns the connection on or off and remembers the choice. */
export function toggleConnection(): Promise<void> {
  return app.isMcpOn ? disconnect() : connect();
}

async function disconnect(): Promise<void> {
  try {
    await stopMcp();
  } catch (e) {
    reportStopError(e);
    return;
  }
  app.flash(`AI disconnected${rememberNote({ ...savedSettings(), isEnabled: false })}`);
}

async function connect(): Promise<void> {
  const saved = savedSettings();
  const dev = devToken();
  const token = dev ?? saved.token ?? newToken();
  const isNewToken = token !== dev && token !== saved.token;
  try {
    await startMcp(DEFAULT_PORT, token);
  } catch (e) {
    app.flash(`AI connection failed: ${errorText(e)}`, ERROR_FLASH_MS);
    return;
  }
  // The dev token lives in the developer's own token file and stays out of app storage.
  const note = rememberNote({ isEnabled: true, token: dev ? saved.token : token });
  if (isNewToken) await showRegistrationSteps(token, note);
  else app.flash(`AI connected. Start Claude Code and chat as usual${note}`);
}

async function copyText(text: string): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(text);
    return null;
  } catch (e) {
    return errorText(e);
  }
}

/** First connect only: Claude Code needs the address and token once, kept in its own settings. */
async function showRegistrationSteps(token: string, note: string): Promise<void> {
  const command = connectCommand(DEFAULT_PORT, token);
  let choice: string;
  do {
    const failure = await copyText(command);
    const copied = failure
      ? `Could not copy the command (${failure}). Select it below and copy it yourself:\n\n${command}`
      : 'The command that registers Pictus with Claude Code is on your clipboard.';
    choice = await app.ask(
      'Connect Claude Code (one time)',
      `${copied}\n\nPaste it into a terminal and press Enter, then start (or restart) Claude Code and ` +
        `chat as usual. Next time, Pictus connects by itself when it opens.${note}`,
      // 'cancel' is what Escape picks, so closing the box never copies again.
      [
        { id: 'copy', label: 'Copy again' },
        { id: 'cancel', label: 'Done', isPrimary: true },
      ],
    );
  } while (choice === 'copy');
}

/** For page teardown (including dev hot reload), so no stale listener answers twice. */
export function stopAtTeardown(): void {
  stopMcp().catch(reportStopError);
}
