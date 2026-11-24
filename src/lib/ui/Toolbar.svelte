<script lang="ts">
  import { MIRROR_AXES } from '$lib/core/tools';
  import { app, editor, TOOLS } from '$lib/state/app.svelte';
  import Icon from './Icon.svelte';

  const maxLayer = $derived((app.rev, editor.grid.sz - 1));
</script>

<nav>
  {#each TOOLS as t (t.id)}
    <button
      class="tool"
      class:active={app.tool === t.id}
      onclick={() => (app.tool = t.id)}
      title="{t.label} ({t.key}) — {t.hint}"
      aria-label={t.label}
      aria-pressed={app.tool === t.id}
    >
      <Icon name={t.id} size={20} />
      <span>{t.label}</span>
    </button>
  {/each}

  {#if app.tool === 'box'}
    <div class="group">
      <h3>Box</h3>
      <div class="seg">
        {#each [['add', 'Add'], ['erase', 'Erase'], ['paint', 'Paint']] as [id, label] (id)}
          <button class:active={app.boxMode === id} onclick={() => (app.boxMode = id as typeof app.boxMode)}>
            {label}
          </button>
        {/each}
      </div>
      <label class="row" title="How many layers deep the box goes">
        Height <input type="number" min="1" max="128" bind:value={app.boxHeight} />
      </label>
    </div>
  {/if}

  <div class="group">
    <h3>Mirror</h3>
    <div class="seg">
      {#each MIRROR_AXES as [axis, key] (axis)}
        <button
          class:active={app.mirror[key]}
          aria-pressed={app.mirror[key]}
          title="Mirror edits across the {axis} center"
          onclick={() => (app.mirror = { ...app.mirror, [key]: !app.mirror[key] })}
        >
          {axis}
        </button>
      {/each}
    </div>
  </div>

  <div class="group">
    <h3>Layer view</h3>
    <button
      class="wide"
      class:active={app.isLayerMode}
      aria-pressed={app.isLayerMode}
      onclick={() => (app.isLayerMode = !app.isLayerMode)}
      title="Edit one layer at a time like 2D pixel art (L)"
    >
      <span class="row"><Icon name="layers" size={16} /> {app.isLayerMode ? 'On' : 'Off'}</span>
    </button>
    {#if app.isLayerMode}
      <div class="row layer">
        <button
          onclick={() => (app.layer = Math.max(0, app.layer - 1))}
          title="Layer down (PgDn)"
          aria-label="Layer down"
        >
          −
        </button>
        <span class="num">{app.layer + 1}<span class="muted">/{maxLayer + 1}</span></span>
        <button
          onclick={() => (app.layer = Math.min(maxLayer, app.layer + 1))}
          title="Layer up (PgUp)"
          aria-label="Layer up"
        >
          +
        </button>
      </div>
    {/if}
  </div>
</nav>

<style>
  nav {
    width: 92px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 6px;
    background: var(--panel);
    border-right: 1px solid var(--border);
    overflow-y: auto;
  }
  .tool {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 7px 2px;
    background: transparent;
    border-color: transparent;
    font-size: 11px;
  }
  .tool.active,
  .seg .active,
  .wide.active {
    background: rgba(79, 140, 255, 0.18);
    border-color: var(--accent);
    color: #fff;
  }
  .group {
    margin-top: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .group h3 {
    margin: 0;
    font-size: 10px;
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .seg button {
    flex: 1;
    padding: 4px 0;
    font-size: 11px;
  }
  .wide {
    padding: 5px 4px;
    display: flex;
    justify-content: center;
  }
  label {
    font-size: 11px;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }
  label input {
    width: 100%;
  }
  .layer {
    justify-content: space-between;
    gap: 2px;
  }
  .layer button {
    padding: 2px 7px;
  }
  .num {
    font-variant-numeric: tabular-nums;
    font-size: 12px;
  }
</style>
