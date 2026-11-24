// Connects the Rust MCP relay to the app: listens for `mcp-request` events and
// answers them through protocol.ts.
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { newModel } from '$lib/actions';
import { errorText } from '$lib/platform/files';
import { app, editor } from '$lib/state/app.svelte';
import { handleHttp, type HttpIn } from './protocol';
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
  notify: (tool) => app.flash(`AI: ${tool}`),
};

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
 * Dev only: `VITE_PICTUS_MCP_TOKEN=<token> pnpm tauri dev` turns the
 * connection on at launch.
 */
export async function startAtLaunch(): Promise<void> {
  const devToken = import.meta.env.DEV ? (import.meta.env.VITE_PICTUS_MCP_TOKEN as string | undefined) : undefined;
  if (!devToken) return;
  try {
    await startMcp(DEFAULT_PORT, devToken);
  } catch (e) {
    app.flash(`AI connection failed: ${errorText(e)}`, ERROR_FLASH_MS);
  }
}

/** For page teardown (including dev hot reload), so no stale listener answers twice. */
export function stopAtTeardown(): void {
  stopMcp().catch(reportStopError);
}
