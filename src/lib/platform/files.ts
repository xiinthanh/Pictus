import { invoke } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export interface Filter {
  name: string;
  extensions: string[];
}

export const PICTUS_FILTER: Filter = { name: 'Pictus model', extensions: ['pictus'] };
export const VOX_FILTER: Filter = { name: 'MagicaVoxel', extensions: ['vox'] };
export const IMAGE_FILTER: Filter = { name: 'Image', extensions: ['png', 'gif', 'bmp', 'jpg', 'jpeg', 'webp'] };

function toHex(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readBytes(path: string): Promise<Uint8Array> {
  const buf = await invoke<ArrayBuffer>('read_file', { path });
  return new Uint8Array(buf);
}

export async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  await invoke('write_file', data, { headers: { 'x-path': toHex(path) } });
}

export async function writeText(path: string, text: string): Promise<void> {
  await writeBytes(path, new TextEncoder().encode(text));
}

export async function pickOpen(filters: Filter[]): Promise<string | null> {
  const r = await open({ multiple: false, directory: false, filters });
  return typeof r === 'string' ? r : null;
}

export async function pickSave(filters: Filter[], defaultPath?: string): Promise<string | null> {
  return (await save({ filters, defaultPath })) ?? null;
}

export async function startupFile(): Promise<string | null> {
  try {
    return (await invoke<string | null>('startup_file')) ?? null;
  } catch {
    return null;
  }
}

export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function stripExt(name: string): string {
  return name.replace(/\.[^.\\/]+$/, '');
}

export function withExt(path: string, ext: string): string {
  return /\.[^.\\/]+$/.test(path) ? path.replace(/\.[^.\\/]+$/, ext) : path + ext;
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
