import type { Model } from '$lib/core/editor';
import { VoxelGrid } from '$lib/core/grid';
import { decodePictus, encodePictus } from '$lib/core/io/pictus';
import { readVox, writeVox } from '$lib/core/io/vox';
import { defaultPalette } from '$lib/core/palette';
import {
  baseName,
  errorText,
  pickOpen,
  pickSave,
  PICTUS_FILTER,
  readBytes,
  stripExt,
  VOX_FILTER,
  withExt,
  writeBytes,
} from '$lib/platform/files';
import { app, editor } from '$lib/state/app.svelte';

/**
 * Marks Pictus busy while a file flow runs. AI edits are refused meanwhile, so
 * none can land between a check (unsaved changes?) and its effect (load, save).
 */
async function whileBusy<T>(flow: () => Promise<T>): Promise<T> {
  app.busyTasks++;
  try {
    return await flow();
  } finally {
    app.busyTasks--;
  }
}

/** Asks to save unsaved changes. Resolves false if the user cancels. */
export async function confirmDiscard(): Promise<boolean> {
  if (!app.isDirty) return true;
  const choice = await app.ask('Unsaved changes', `Save changes to “${app.docName}” first?`, [
    { id: 'cancel', label: 'Cancel' },
    { id: 'discard', label: "Don't save" },
    { id: 'save', label: 'Save', isPrimary: true },
  ]);
  if (choice === 'cancel') return false;
  if (choice === 'save') return save();
  return true;
}

function loadModel(model: Model, path: string | null, name: string) {
  editor.load(model);
  app.filePath = path;
  app.docName = name;
  app.isDirty = false;
}

export function newModel(sx: number, sy: number, sz: number) {
  loadModel(
    { grid: new VoxelGrid(sx, sy, sz), palette: defaultPalette(), voxelSize: editor.voxelSize },
    null,
    'Untitled',
  );
  app.color = 1;
  app.layer = 0;
}

/** Replaces the document with an imported model (image, .vox). */
export function loadImported(model: Model, name: string) {
  loadModel(model, null, name);
  app.color = Math.min(app.color, model.palette.length - 1) || 1;
}

export function openFile(path?: string, isConfirmed = false): Promise<void> {
  return whileBusy(() => openFileFlow(path, isConfirmed));
}

async function openFileFlow(path: string | undefined, isConfirmed: boolean): Promise<void> {
  if (!isConfirmed && !(await confirmDiscard())) return;
  const p = path ?? (await pickOpen([{ name: 'Models', extensions: ['pictus', 'vox'] }, PICTUS_FILTER, VOX_FILTER]));
  if (!p) return;
  try {
    const bytes = await readBytes(p);
    if (p.toLowerCase().endsWith('.vox')) {
      const { model, warnings } = readVox(bytes);
      loadImported(model, stripExt(baseName(p)));
      app.flash(
        warnings.length ? warnings.join(' ') : 'Imported MagicaVoxel model — use Save to keep it as .pictus',
        7000,
      );
    } else {
      loadModel(decodePictus(bytes), p, stripExt(baseName(p)));
      app.addRecent(p);
      app.flash(`Opened ${baseName(p)}`);
    }
  } catch (e) {
    if (path) app.removeRecent(path);
    await app.ask('Could not open file', errorText(e), [{ id: 'ok', label: 'OK', isPrimary: true }]);
  }
}

export function save(): Promise<boolean> {
  return whileBusy(saveFlow);
}

async function saveFlow(): Promise<boolean> {
  if (!app.filePath) return saveAs();
  return writeModel(app.filePath);
}

export function saveAs(): Promise<boolean> {
  return whileBusy(saveAsFlow);
}

async function saveAsFlow(): Promise<boolean> {
  const p = await pickSave([PICTUS_FILTER], `${app.docName}.pictus`);
  if (!p) return false;
  return writeModel(withExt(p, '.pictus'));
}

async function writeModel(path: string): Promise<boolean> {
  try {
    await writeBytes(path, encodePictus(editor.model()));
    app.filePath = path;
    app.docName = stripExt(baseName(path));
    app.isDirty = false;
    app.addRecent(path);
    app.flash(`Saved ${baseName(path)}`);
    return true;
  } catch (e) {
    await app.ask('Could not save', errorText(e), [{ id: 'ok', label: 'OK', isPrimary: true }]);
    return false;
  }
}

export function importVox(): Promise<void> {
  return whileBusy(importVoxFlow);
}

async function importVoxFlow(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const p = await pickOpen([VOX_FILTER]);
  if (p) await openFile(p, true);
}

export function exportVox(): Promise<void> {
  return whileBusy(exportVoxFlow);
}

async function exportVoxFlow(): Promise<void> {
  const p = await pickSave([VOX_FILTER], `${app.docName}.vox`);
  if (!p) return;
  try {
    await writeBytes(withExt(p, '.vox'), writeVox(editor.model()));
    app.flash(`Exported ${baseName(withExt(p, '.vox'))}`);
  } catch (e) {
    await app.ask('Could not export', errorText(e), [{ id: 'ok', label: 'OK', isPrimary: true }]);
  }
}

export async function newWithConfirm(): Promise<void> {
  if (await confirmDiscard()) app.dialog = 'new';
}

export async function importImageWithConfirm(): Promise<void> {
  if (await confirmDiscard()) app.dialog = 'image';
}
