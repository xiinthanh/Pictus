<script lang="ts">
  import { fromCss, luminance, MAX_COLORS, toCss } from '$lib/core/palette';
  import { app, editor } from '$lib/state/app.svelte';
  import Icon from './Icon.svelte';

  const palette = $derived((app.rev, editor.palette.slice()));
  const current = $derived(palette[app.color] ?? 0);
  /** Voxels per palette index, in one pass over the grid. */
  const usage = $derived.by(() => {
    void app.rev;
    const n = new Uint32Array(256);
    const d = editor.grid.data;
    for (let i = 0; i < d.length; i++) n[d[i]]++;
    return n;
  });
  const info = $derived.by(() => {
    void app.rev;
    const g = editor.grid;
    return { sx: g.sx, sy: g.sy, sz: g.sz, count: g.data.length - usage[0], size: editor.voxelSize };
  });

  function mm(v: number) {
    return Math.round(v * 10) / 10;
  }

  function addColor() {
    const i = editor.addColor(current || 0xffffff);
    if (i > 0) app.color = i;
    else app.flash(`The palette is full (${MAX_COLORS} colors)`);
  }
</script>

<aside>
  <section>
    <h3>Color</h3>
    <div class="current row">
      <label class="picker" style:background={toCss(current)} title="Click to change this color">
        <input
          type="color"
          value={toCss(current)}
          oninput={(e) => editor.setColor(app.color, fromCss(e.currentTarget.value))}
        />
      </label>
      <div>
        <div class="hex">{toCss(current).toUpperCase()}</div>
        <div class="muted small">{usage[app.color] ?? 0} voxels</div>
      </div>
    </div>
    <div class="swatches">
      {#each palette as c, i (i)}
        {#if i > 0}
          <button
            class="swatch"
            class:active={i === app.color}
            style:background={toCss(c)}
            style:color={luminance(c) > 0.6 ? '#000' : '#fff'}
            onclick={() => (app.color = i)}
            title="{toCss(c).toUpperCase()} · {usage[i]} voxels"
            aria-label="Color {i}"
          >
            {#if i === app.color}●{/if}
          </button>
        {/if}
      {/each}
      <button class="swatch add" onclick={addColor} title="Add a color" aria-label="Add a color">
        <Icon name="plus" size={14} />
      </button>
    </div>
  </section>

  <section>
    <h3>Model</h3>
    <dl>
      <dt>Grid</dt>
      <dd>{info.sx} × {info.sy} × {info.sz}</dd>
      <dt>Voxels</dt>
      <dd>{info.count.toLocaleString()}</dd>
      <dt>Voxel size</dt>
      <dd>
        <input
          type="number"
          min="0.1"
          max="20"
          step="0.1"
          value={info.size}
          onchange={(e) => {
            const v = parseFloat(e.currentTarget.value);
            if (v > 0) editor.setVoxelSize(v);
          }}
        /> mm
      </dd>
      <dt>Print size</dt>
      <dd>{mm(info.sx * info.size)} × {mm(info.sy * info.size)} × {mm(info.sz * info.size)} mm</dd>
    </dl>
  </section>

  <section class="help">
    <h3>Controls</h3>
    <p><b>Left drag</b> use tool</p>
    <p><b>Right drag</b> or <b>Space + drag</b> orbit</p>
    <p><b>Middle drag</b> pan · <b>Wheel</b> zoom</p>
    <p><kbd>F</kbd> frame model · <kbd>1–6</kbd> tools</p>
  </section>
</aside>

<style>
  aside {
    width: 236px;
    flex-shrink: 0;
    background: var(--panel);
    border-left: 1px solid var(--border);
    overflow-y: auto;
  }
  section {
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }
  .current {
    margin-bottom: 10px;
  }
  .picker {
    width: 44px;
    height: 44px;
    border-radius: 8px;
    border: 1px solid var(--border);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .picker input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .hex {
    font-family: Consolas, monospace;
    font-size: 13px;
  }
  .small {
    font-size: 11px;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
  }
  .swatch {
    aspect-ratio: 1;
    padding: 0;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 8px;
    display: grid;
    place-items: center;
  }
  .swatch.active {
    outline: 2px solid #fff;
    outline-offset: 1px;
  }
  .swatch.add {
    background: transparent;
    border-style: dashed;
    color: var(--muted);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 6px 10px;
    margin: 0;
    align-items: center;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }
  .help p {
    margin: 4px 0;
    color: var(--muted);
    font-size: 12px;
  }
  .help b {
    color: var(--text);
    font-weight: 500;
  }
</style>
