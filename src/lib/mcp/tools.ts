// MCP tools exposed to AI clients. Plain TypeScript with relative imports and no
// app state: everything app-specific comes in through `ToolCtx`, so this file
// runs under vitest without Svelte.
import type { Editor } from '../core/editor';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolCtx {
  editor: Editor;
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

export const TOOLS: Tool[] = [];
