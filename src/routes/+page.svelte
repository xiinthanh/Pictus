<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { confirmDiscard, importImageWithConfirm, newWithConfirm, openFile, save, saveAs } from '$lib/actions';
  import { redo, undo } from '$lib/editing';
  import { startFromSettings } from '$lib/mcp/bridge';
  import { startupFile } from '$lib/platform/files';
  import { app, editor, TOOLS } from '$lib/state/app.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import ExportDialog from '$lib/ui/ExportDialog.svelte';
  import ImportImageDialog from '$lib/ui/ImportImageDialog.svelte';
  import MenuBar from '$lib/ui/MenuBar.svelte';
  import NewModelDialog from '$lib/ui/NewModelDialog.svelte';
  import PrintCheckPanel from '$lib/ui/PrintCheckPanel.svelte';
  import SidePanel from '$lib/ui/SidePanel.svelte';
  import SliceView from '$lib/ui/SliceView.svelte';
  import StatusBar from '$lib/ui/StatusBar.svelte';
  import Toolbar from '$lib/ui/Toolbar.svelte';
  import ViewportView from '$lib/ui/ViewportView.svelte';

  let viewport: ViewportView | undefined = $state();
  const title = $derived(`${app.dirty ? '• ' : ''}${app.docName} — Pictus`);

  $effect(() => {
    document.title = title;
    getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    let closing = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (closing) return;
        event.preventDefault();
        if (await confirmDiscard()) {
          closing = true;
          await getCurrentWindow().destroy();
        }
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    startupFile().then((p) => {
      if (p) openFile(p, true);
    });
    startFromSettings();
    return () => unlisten?.();
  });

  function onkeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (app.dialog || app.confirm) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl) {
      const actions: Record<string, () => unknown> = {
        z: () => (e.shiftKey ? redo() : undo()),
        y: redo,
        s: () => (e.shiftKey ? saveAs() : save()),
        o: () => openFile(),
        n: newWithConfirm,
        e: () => (app.dialog = 'export'),
        i: importImageWithConfirm,
      };
      if (actions[k]) {
        e.preventDefault();
        actions[k]();
      }
      return;
    }
    const tool = TOOLS.find((x) => x.key === e.key);
    if (tool) app.tool = tool.id;
    else if (k === 'f') viewport?.frame();
    else if (k === 'l') app.layerMode = !app.layerMode;
    else if (e.key === 'PageUp' || (app.layerMode && e.key === 'ArrowUp')) {
      e.preventDefault();
      app.layer = Math.min(editor.grid.sz - 1, app.layer + 1);
    } else if (e.key === 'PageDown' || (app.layerMode && e.key === 'ArrowDown')) {
      e.preventDefault();
      app.layer = Math.max(0, app.layer - 1);
    } else if (e.key === 'Escape') {
      app.highlight = [];
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="app">
  <MenuBar />
  <div class="main">
    <Toolbar />
    <div class="views">
      <ViewportView bind:this={viewport} />
      {#if app.layerMode}<SliceView />{/if}
      {#if app.checkOpen}<PrintCheckPanel />{/if}
    </div>
    <SidePanel />
  </div>
  <StatusBar />
</div>

{#if app.dialog === 'new'}<NewModelDialog />{/if}
{#if app.dialog === 'export'}<ExportDialog />{/if}
{#if app.dialog === 'image'}<ImportImageDialog />{/if}
{#if app.confirm}<ConfirmDialog />{/if}

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .main {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .views {
    flex: 1;
    display: flex;
    min-width: 0;
    position: relative;
  }
</style>
