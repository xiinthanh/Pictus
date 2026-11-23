<script lang="ts">
  import { exportVox, importImageWithConfirm, importVox, newWithConfirm, openFile, save, saveAs } from '$lib/actions';
  import { redo, undo } from '$lib/editing';
  import { baseName } from '$lib/platform/files';
  import { app, editor } from '$lib/state/app.svelte';
  import Icon from './Icon.svelte';

  let menu = $state<'file' | 'import' | null>(null);
  const canUndo = $derived((app.rev, editor.history.canUndo));
  const canRedo = $derived((app.rev, editor.history.canRedo));

  function run(fn: () => unknown) {
    menu = null;
    fn();
  }
</script>

<svelte:window onpointerdown={(e) => { if (!(e.target as HTMLElement).closest('.menu-root')) menu = null; }} />

<header>
  <div class="brand">Pictus</div>

  <div class="menu-root">
    <button class="flat" class:open={menu === 'file'} onclick={() => (menu = menu === 'file' ? null : 'file')}>File</button>
    {#if menu === 'file'}
      <div class="dropdown">
        <button onclick={() => run(newWithConfirm)}>New… <kbd>Ctrl+N</kbd></button>
        <button onclick={() => run(() => openFile())}>Open… <kbd>Ctrl+O</kbd></button>
        {#if app.recent.length}
          <div class="sep">Recent</div>
          {#each app.recent as path (path)}
            <button class="recent" title={path} onclick={() => run(() => openFile(path))}>{baseName(path)}</button>
          {/each}
          <div class="sep"></div>
        {/if}
        <button onclick={() => run(save)}>Save <kbd>Ctrl+S</kbd></button>
        <button onclick={() => run(saveAs)}>Save as… <kbd>Ctrl+Shift+S</kbd></button>
      </div>
    {/if}
  </div>

  <div class="menu-root">
    <button class="flat" class:open={menu === 'import'} onclick={() => (menu = menu === 'import' ? null : 'import')}>Import</button>
    {#if menu === 'import'}
      <div class="dropdown">
        <button onclick={() => run(importImageWithConfirm)}>Pixel art image…</button>
        <button onclick={() => run(importVox)}>MagicaVoxel .vox…</button>
        <div class="sep"></div>
        <button onclick={() => run(exportVox)}>Export as .vox…</button>
      </div>
    {/if}
  </div>

  <div class="spacer"></div>

  <button class="flat icon" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}><Icon name="undo" /></button>
  <button class="flat icon" title="Redo (Ctrl+Y)" disabled={!canRedo} onclick={redo}><Icon name="redo" /></button>
  <div class="divider"></div>
  <button class:active={app.checkOpen} onclick={() => (app.checkOpen = !app.checkOpen)} title="Check the model for printing problems">
    <span class="row"><Icon name="check" size={16} /> Print check</span>
  </button>
  <button class="primary" onclick={() => (app.dialog = 'export')} title="Export for 3D printing (Ctrl+E)">Export…</button>
</header>

<style>
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .brand {
    font-weight: 700;
    letter-spacing: 0.02em;
    margin-right: 10px;
    color: var(--accent);
  }
  .spacer {
    flex: 1;
  }
  .divider {
    width: 1px;
    height: 20px;
    background: var(--border);
    margin: 0 6px;
  }
  .flat {
    background: transparent;
    border-color: transparent;
  }
  .flat.open,
  .flat:hover:not(:disabled) {
    background: var(--panel-2);
  }
  .icon {
    padding: 4px 6px;
    display: grid;
    place-items: center;
  }
  .active {
    border-color: var(--accent);
  }
  .menu-root {
    position: relative;
  }
  .dropdown {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 40;
    min-width: 230px;
    display: flex;
    flex-direction: column;
    padding: 4px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .dropdown button {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    text-align: left;
    background: transparent;
    border-color: transparent;
  }
  .dropdown button:hover {
    background: var(--panel-2);
  }
  .recent {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 320px;
  }
  .sep {
    border-top: 1px solid var(--border);
    margin: 4px 0;
    padding-top: 4px;
    font-size: 11px;
    color: var(--muted);
    padding-left: 10px;
  }
  .sep:empty {
    padding: 0;
  }
</style>
