// MCP tools exposed to AI clients. Plain TypeScript with relative imports and no
// app state: everything app-specific comes in through `ToolCtx`, so this file
// runs under vitest without Svelte.
import type { Editor } from '../core/editor';
import type { Vec3 } from '../core/grid';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolCtx {
  editor: Editor;
  info(): { name: string; dirty: boolean; layer: number; color: number };
  newModel(sx: number, sy: number, sz: number): void;
  highlight(cells: Vec3[]): void;
  /** Base64 PNG of the 3D view, or null when it can't be captured. */
  snapshot(frame: boolean): string | null;
  /** Tells the user which tool the AI just used. */
  notify(tool: string): void;
}

export interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run(args: Record<string, unknown>, ctx: ToolCtx): Content[] | Promise<Content[]>;
}

/** Filled in milestone by milestone (see hai_doc/KE_HOACH_A2_MCP.md). */
export const TOOLS: Tool[] = [];
