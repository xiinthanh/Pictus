<script lang="ts">
  import { loadImported } from '$lib/actions';
  import type { Model } from '$lib/core/editor';
  import { DEFAULT_IMAGE_OPTIONS, fitSize, imageToModel, resizeNearest, type ImageOptions } from '$lib/core/io/image';
  import { fromCss, toCss } from '$lib/core/palette';
  import { baseName, errorText, IMAGE_FILTER, pickOpen, readBytes, stripExt } from '$lib/platform/files';
  import { app, editor } from '$lib/state/app.svelte';
  import Modal from './Modal.svelte';

  let source = $state<{ name: string; w: number; h: number; rgba: Uint8Array; origW: number; origH: number } | null>(
    null,
  );
  let opts = $state<ImageOptions>({ ...DEFAULT_IMAGE_OPTIONS });
  let error = $state('');
  let preview: HTMLCanvasElement | undefined = $state();

  async function choose() {
    error = '';
    const p = await pickOpen([IMAGE_FILTER]);
    if (!p) return;
    try {
      const bytes = await readBytes(p);
      const bitmap = await createImageBitmap(new Blob([bytes as BlobPart]));
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      source = {
        name: stripExt(baseName(p)),
        w: c.width,
        h: c.height,
        rgba: new Uint8Array(data),
        origW: c.width,
        origH: c.height,
      };
    } catch (e) {
      error = `Could not read the image: ${errorText(e)}`;
      source = null;
    }
  }

  /** Pixels scaled down (nearest neighbour) to fit the grid with current options. */
  const fitted = $derived.by(() => {
    if (!source) return null;
    const { w, h } = fitSize(source.w, source.h, opts);
    const rgba = w === source.w && h === source.h ? source.rgba : resizeNearest(source.rgba, source.w, source.h, w, h);
    return { w, h, rgba, scaled: w !== source.w || h !== source.h };
  });

  const result = $derived.by((): { model: Model | null; error: string } => {
    if (!fitted) return { model: null, error: '' };
    try {
      return { model: imageToModel(fitted.rgba, fitted.w, fitted.h, $state.snapshot(opts)), error: '' };
    } catch (e) {
      return { model: null, error: errorText(e) };
    }
  });

  $effect(() => {
    if (!preview || !fitted) return;
    const ctx = preview.getContext('2d')!;
    preview.width = fitted.w;
    preview.height = fitted.h;
    const img = new ImageData(new Uint8ClampedArray(fitted.rgba), fitted.w, fitted.h);
    ctx.putImageData(img, 0, 0);
  });

  function mm(v: number) {
    return Math.round(v * editor.voxelSize * 10) / 10;
  }

  function doImport() {
    const m = result.model;
    if (!m || !source) return;
    m.voxelSize = editor.voxelSize;
    loadImported(m, source.name);
    app.dialog = null;
    app.flash(`Imported ${source.name} — ${m.grid.sx}×${m.grid.sy}×${m.grid.sz} voxels`);
  }
</script>

<Modal title="Import pixel art" onclose={() => (app.dialog = null)} width={560}>
  <div class="row">
    <button onclick={choose}>{source ? 'Choose another image…' : 'Choose image…'}</button>
    {#if source}<span class="muted">{source.name} · {source.origW}×{source.origH} px</span>{/if}
  </div>
  {#if error}<p class="err">{error}</p>{/if}

  {#if source && fitted}
    <div class="layout">
      <div class="preview">
        <canvas bind:this={preview}></canvas>
      </div>
      <div class="form">
        <label class="row">Pixel height <input type="number" min="1" max="64" bind:value={opts.depth} /> voxels</label>
        <label class="row">
          Base plate <input type="number" min="0" max="16" bind:value={opts.plateThickness} /> voxels thick
        </label>
        {#if opts.plateThickness > 0}
          <label class="row">
            Plate shape
            <select bind:value={opts.plateShape}>
              <option value="outline">Follow outline</option>
              <option value="rectangle">Rectangle</option>
            </select>
          </label>
          <label class="row">Border <input type="number" min="0" max="16" bind:value={opts.margin} /> voxels</label>
        {/if}
        {#if opts.plateThickness > 0 || opts.keyring}
          <label class="row">
            Plate color
            <input
              type="color"
              value={toCss(opts.plateColor)}
              oninput={(e) => (opts.plateColor = fromCss(e.currentTarget.value))}
            />
          </label>
        {/if}
        <label class="row check"><input type="checkbox" bind:checked={opts.keyring} /> Add keyring loop</label>
      </div>
    </div>
    {#if fitted.scaled}<p class="note">
        The image was scaled down to {fitted.w}×{fitted.h} px to fit the 128-voxel limit.
      </p>{/if}
    {#if result.model}
      {@const g = result.model.grid}
      <p class="muted">
        Result: {g.sx}×{g.sy}×{g.sz} voxels · {mm(g.sx)}×{mm(g.sy)}×{mm(g.sz)} mm · {result.model.palette.length - 1} colors
      </p>
    {:else if result.error}
      <p class="err">{result.error}</p>
    {/if}
  {:else}
    <p class="muted">
      Pick a small pixel-art image (PNG works best). Each opaque pixel becomes a column of voxels; transparent pixels
      stay empty.
    </p>
  {/if}

  {#snippet footer()}
    <button onclick={() => (app.dialog = null)}>Cancel</button>
    <button class="primary" disabled={!result.model} onclick={doImport}>Import</button>
  {/snippet}
</Modal>

<style>
  .layout {
    display: grid;
    grid-template-columns: 200px 1fr;
    gap: 16px;
  }
  .preview {
    width: 200px;
    height: 200px;
    display: grid;
    place-items: center;
    border-radius: 8px;
    background-color: #2a2d34;
    background-image:
      linear-gradient(45deg, #23262c 25%, transparent 25%, transparent 75%, #23262c 75%),
      linear-gradient(45deg, #23262c 25%, transparent 25%, transparent 75%, #23262c 75%);
    background-size: 16px 16px;
    background-position:
      0 0,
      8px 8px;
  }
  .preview canvas {
    max-width: 184px;
    max-height: 184px;
    width: 184px;
    height: 184px;
    object-fit: contain;
    image-rendering: pixelated;
  }
  .form {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .form label {
    justify-content: space-between;
  }
  .check {
    justify-content: flex-start !important;
    color: var(--text);
  }
  p {
    margin: 0;
  }
  .err {
    color: var(--danger);
  }
  .note {
    color: var(--warn);
  }
</style>
