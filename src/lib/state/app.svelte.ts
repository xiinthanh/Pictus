import { Editor } from '$lib/core/editor';
import type { Vec3 } from '$lib/core/grid';
import type { Mirror } from '$lib/core/tools';
import { loadSetting, saveSetting } from '$lib/platform/storage';

export type ToolId = 'place' | 'erase' | 'paint' | 'pick' | 'fill' | 'box';
export type BoxMode = 'add' | 'erase' | 'paint';
export type DialogId = 'new' | 'export' | 'image' | null;

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

function parseRecent(json: string | null): string[] {
  const v = JSON.parse(json ?? '[]');
  return Array.isArray(v) ? v.filter((s) => typeof s === 'string').slice(0, 8) : [];
}

export interface ConfirmRequest {
  title: string;
  message: string;
  buttons: { id: string; label: string; isPrimary?: boolean }[];
  resolve: (id: string) => void;
}

class AppState {
  tool = $state<ToolId>('place');
  boxMode = $state<BoxMode>('add');
  boxHeight = $state(1);
  color = $state(1);
  mirror = $state<Mirror>({ isX: false, isY: false, isZ: false });
  isLayerMode = $state(false);
  layer = $state(0);

  filePath = $state<string | null>(null);
  docName = $state('Untitled');
  isDirty = $state(false);
  /** Bumped on every model change so derived UI (counts, palette) refreshes. */
  rev = $state(0);
  hover = $state<Vec3 | null>(null);
  status = $state('');
  dialog = $state<DialogId>(null);
  isCheckOpen = $state(false);
  /** Cells to highlight in the viewport (print check). */
  highlight = $state<Vec3[]>([]);
  confirm = $state<ConfirmRequest | null>(null);
  /** Open/save/import flows in progress; AI edits wait until it is back to 0. */
  busyTasks = $state(0);
  /** The AI (MCP) connection is listening for Claude Code. */
  isMcpOn = $state(false);
  recent = $state<string[]>(loadSetting(RECENT_KEY, parseRecent, []));

  addRecent(path: string) {
    this.recent = [path, ...this.recent.filter((p) => p.toLowerCase() !== path.toLowerCase())].slice(0, 8);
    this.saveRecent();
  }

  removeRecent(path: string) {
    this.recent = this.recent.filter((p) => p !== path);
    this.saveRecent();
  }

  /** The list still works for this session if it can't be saved, so a warning is enough. */
  private saveRecent() {
    const failure = saveSetting(RECENT_KEY, this.recent);
    if (failure) console.warn(`Pictus: could not save the recent files list: ${failure}`);
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
  if (e.kind !== 'reset') app.isDirty = true;
  if (e.kind === 'reset') {
    app.highlight = [];
    app.layer = Math.min(app.layer, editor.grid.sz - 1);
    if (app.color >= editor.palette.length) app.color = 1;
  }
});
