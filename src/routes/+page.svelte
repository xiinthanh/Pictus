<script lang="ts">
  import { onMount } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { confirmDiscard, importImageWithConfirm, newWithConfirm, openFile, save, saveAs } from '$lib/actions';
  import { redo, undo } from '$lib/editing';
  import { startAtLaunch, stopAtTeardown } from '$lib/mcp/bridge';
  import { startupFile } from '$lib/platform/files';
  import { app, editor, TOOLS } from '$lib/state/app.svelte';
  import ConfirmDialog from '$lib/ui/ConfirmDialog.svelte';
  import DockZones from '$lib/ui/DockZones.svelte';
  import ExportDialog from '$lib/ui/ExportDialog.svelte';
  import ImportImageDialog from '$lib/ui/ImportImageDialog.svelte';
  import MenuBar from '$lib/ui/MenuBar.svelte';
  import NewModelDialog from '$lib/ui/NewModelDialog.svelte';
  import PrintCheckPanel from '$lib/ui/PrintCheckPanel.svelte';
  import SidePanel from '$lib/ui/SidePanel.svelte';
  import SliceView from '$lib/ui/SliceView.svelte';
  import StatusBar from '$lib/ui/StatusBar.svelte';
  import Toolbar from '$lib/ui/Toolbar.svelte';
  import { clampToArea, type ToolbarDragStart } from '$lib/ui/toolbarLayout';
  import ViewportView from '$lib/ui/ViewportView.svelte';

  let viewport: ViewportView | undefined = $state();
  let workspace: HTMLDivElement | undefined = $state();
  let toolbarDrag = $state<ToolbarDragStart | null>(null);
  const area = $state({ w: 0, h: 0 });
  const floatSize = $state({ w: 0, h: 0 });
  // Clamped when shown, not when saved, so the toolbar returns to its place when the window grows again.
  const floatPos = $derived(clampToArea(app.toolbar.floatX, app.toolbar.floatY, floatSize, area));

  function startToolbarDrag(e: PointerEvent, toolbarRect: DOMRect) {
    toolbarDrag = {
      x: e.clientX,
      y: e.clientY,
      offsetX: e.clientX - toolbarRect.left,
      offsetY: e.clientY - toolbarRect.top,
      width: toolbarRect.width,
      height: toolbarRect.height,
    };
  }
  const title = $derived(`${app.isDirty ? '• ' : ''}${app.docName} — Pictus`);

  $effect(() => {
    document.title = title;
    getCurrentWindow()
      .setTitle(title)
      .catch(() => {});
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    let isClosing = false;
    getCurrentWindow()
      .onCloseRequested(async (event) => {
        if (isClosing) return;
        event.preventDefault();
        if (await confirmDiscard()) {
          isClosing = true;
          await getCurrentWindow().destroy();
        }
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    startupFile().then((p) => {
      if (p) openFile(p, true);
    });
    startAtLaunch();
    return () => {
      unlisten?.();
      stopAtTeardown();
    };
  });

  function onkeydown(e: KeyboardEvent) {
    if (toolbarDrag) {
      if (e.key === 'Escape') toolbarDrag = null;
      return;
    }
    const t = e.target as HTMLElement | null;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if (app.dialog || app.confirm) return;
    const isCtrlDown = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (isCtrlDown) {
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
    else if (k === 'l') app.isLayerMode = !app.isLayerMode;
    else if (e.key === 'PageUp' || (app.isLayerMode && e.key === 'ArrowUp')) {
      e.preventDefault();
      app.layer = Math.min(editor.grid.sz - 1, app.layer + 1);
    } else if (e.key === 'PageDown' || (app.isLayerMode && e.key === 'ArrowDown')) {
      e.preventDefault();
      app.layer = Math.max(0, app.layer - 1);
    } else if (e.key === 'Escape') {
      app.highlight = [];
    }
  }
</script>

<svelte:window {onkeydown} />

{#snippet toolbar()}<Toolbar ongripdown={startToolbarDrag} />{/snippet}

<div class="app">
  <MenuBar />
  <div class="workspace" bind:this={workspace} bind:clientWidth={area.w} bind:clientHeight={area.h}>
    {#if app.toolbar.dock === 'top'}{@render toolbar()}{/if}
    <div class="main">
      {#if app.toolbar.dock === 'left'}{@render toolbar()}{/if}
      <div class="views">
        <ViewportView bind:this={viewport} />
        {#if app.isLayerMode}<SliceView />{/if}
        {#if app.isCheckOpen}<PrintCheckPanel />{/if}
      </div>
      {#if app.toolbar.dock === 'right'}{@render toolbar()}{/if}
      <SidePanel />
    </div>
    {#if app.toolbar.dock === 'bottom'}{@render toolbar()}{/if}
    {#if app.toolbar.dock === 'float'}
      <div
        class="float"
        style:left="{floatPos.x}px"
        style:top="{floatPos.y}px"
        bind:clientWidth={floatSize.w}
        bind:clientHeight={floatSize.h}
      >
        {@render toolbar()}
      </div>
    {/if}
    {#if toolbarDrag && workspace}
      <DockZones area={workspace} start={toolbarDrag} onend={() => (toolbarDrag = null)} />
    {/if}
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
  .workspace {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    position: relative;
  }
  .float {
    position: absolute;
    z-index: 20;
    display: flex;
    flex-direction: column;
    max-height: 100%;
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
