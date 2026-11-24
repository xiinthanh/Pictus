import { Editor } from '$lib/core/editor';
import type { Vec3 } from '$lib/core/grid';
import type { Mirror } from '$lib/core/tools';

export type ToolId = 'place' | 'erase' | 'paint' | 'pick' | 'fill' | 'box';
export type BoxMode = 'add' | 'erase' | 'paint';
export type DialogId = 'new' | 'export' | 'image' | 'ai' | null;

export const TOOLS: { id: ToolId; label: string; key: string; hint: string }[] = [
  {
    id: 'place',
    label: 'Place',
    key: '1',
    hint: 'Click a face to add a voxel. Drag to keep placing on the same layer.',
  },
  { id: 'erase', label: 'Erase', key: '2', hint: 'Click or drag over voxels to remove them.' },
  { id: 'paint', label: 'Paint', key: '3', hint: 'Click or drag over voxels to recolor them.' },
  { id: 'pick', label: 'Pick color', key: '4', hint: 'Click a voxel to use its color.' },
  { id: 'fill', label: 'Fill', key: '5', hint: 'Recolor a connected area of the same color.' },
  { id: 'box', label: 'Box', key: '6', hint: 'Drag a rectangle to add, erase or paint many voxels at once.' },
];

const RECENT_KEY = 'pictus.recent';

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

export interface ConfirmRequest {
  title: string;
  message: string;
  buttons: { id: string; label: string; primary?: boolean }[];
  resolve: (id: string) => void;
}

class AppState {
  tool = $state<ToolId>('place');
  boxMode = $state<BoxMode>('add');
  boxHeight = $state(1);
  color = $state(1);
  mirror = $state<Mirror>({ x: false, y: false, z: false });
  layerMode = $state(false);
  layer = $state(0);

  filePath = $state<string | null>(null);
  docName = $state('Untitled');
  dirty = $state(false);
  /** Bumped on every model change so derived UI (counts, palette) refreshes. */
  rev = $state(0);
  hover = $state<Vec3 | null>(null);
  status = $state('');
  dialog = $state<DialogId>(null);
  checkOpen = $state(false);
  /** Cells to highlight in the viewport (print check). */
  highlight = $state<Vec3[]>([]);
  confirm = $state<ConfirmRequest | null>(null);
  /** The local MCP endpoint for AI clients is running. */
  mcpOn = $state(false);
  recent = $state<string[]>(loadRecent());

  addRecent(path: string) {
    this.recent = [path, ...this.recent.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, 8);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    } catch {
      /* storage unavailable — recent list just won't persist */
    }
  }

  removeRecent(path: string) {
    this.recent = this.recent.filter((p) => p !== path);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(this.recent));
    } catch {
      /* ignore */
    }
  }

  ask(title: string, message: string, buttons: ConfirmRequest['buttons']): Promise<string> {
    return new Promise((resolve) => {
      this.confirm = {
        title,
        message,
        buttons,
        resolve: (id) => {
          this.confirm = null;
          resolve(id);
        },
      };
    });
  }

  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  flash(message: string, ms = 4000) {
    this.status = message;
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => (this.status = ''), ms);
  }
}

export const app = new AppState();
export const editor = new Editor();

editor.on((e) => {
  app.rev++;
  if (e.kind !== 'reset') app.dirty = true;
  if (e.kind === 'reset') {
    app.highlight = [];
    app.layer = Math.min(app.layer, editor.grid.sz - 1);
    if (app.color >= editor.palette.length) app.color = 1;
  }
});
