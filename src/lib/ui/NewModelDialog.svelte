<script lang="ts">
  import { newModel } from '$lib/actions';
  import { MAX_DIM } from '$lib/core/grid';
  import { app, editor } from '$lib/state/app.svelte';
  import Modal from './Modal.svelte';

  let sx = $state(32),
    sy = $state(32),
    sz = $state(32);
  const presets = [16, 32, 64, 128];
  const isValid = $derived([sx, sy, sz].every((v) => Number.isInteger(v) && v >= 1 && v <= MAX_DIM));
  const mm = $derived((v: number) => Math.round(v * editor.voxelSize * 10) / 10);

  function create() {
    if (!isValid) return;
    newModel(sx, sy, sz);
    app.dialog = null;
  }
</script>

<Modal title="New model" onclose={() => (app.dialog = null)}>
  <div>
    <h3>Grid size (voxels)</h3>
    <div class="row presets">
      {#each presets as p (p)}
        <button
          class:active={sx === p && sy === p && sz === p}
          onclick={() => {
            sx = p;
            sy = p;
            sz = p;
          }}
        >
          {p}³
        </button>
      {/each}
    </div>
  </div>
  <div class="row">
    <label class="row">X <input type="number" min="1" max={MAX_DIM} bind:value={sx} /></label>
    <label class="row">Y <input type="number" min="1" max={MAX_DIM} bind:value={sy} /></label>
    <label class="row">Z <input type="number" min="1" max={MAX_DIM} bind:value={sz} /></label>
  </div>
  <p class="muted">
    {#if isValid}At {editor.voxelSize} mm per voxel the print can be up to {mm(sx)} × {mm(sy)} × {mm(sz)} mm.
    {:else}Each side must be between 1 and {MAX_DIM}.{/if}
  </p>
  {#snippet footer()}
    <button onclick={() => (app.dialog = null)}>Cancel</button>
    <button class="primary" disabled={!isValid} onclick={create}>Create</button>
  {/snippet}
</Modal>

<style>
  .presets button {
    flex: 1;
  }
  .active {
    border-color: var(--accent);
    background: rgba(79, 140, 255, 0.18);
  }
  p {
    margin: 0;
  }
</style>
