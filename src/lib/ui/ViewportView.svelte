<script lang="ts">
  import { onMount } from 'svelte';
  import { registerViewport } from '$lib/mcp/bridge';
  import { Viewport } from '$lib/render/viewport';
  import { app, editor } from '$lib/state/app.svelte';
  import Icon from './Icon.svelte';

  let el: HTMLDivElement;
  let view = $state<Viewport | null>(null);

  onMount(() => {
    view = new Viewport(el);
    registerViewport(view);
    return () => {
      registerViewport(null);
      view?.dispose();
    };
  });

  // A string, so effects re-run only when the grid dimensions actually change.
  const dims = $derived((app.rev, `${editor.grid.sx}x${editor.grid.sy}x${editor.grid.sz}`));

  $effect(() => {
    void dims;
    view?.setLayer(app.isLayerMode ? Math.min(app.layer, editor.grid.sz - 1) : null);
  });
  $effect(() => {
    void dims;
    view?.setMirror(app.mirror);
  });
  $effect(() => {
    view?.setHighlight(app.highlight);
  });

  export function frame() {
    view?.frame();
  }
</script>

<div class="wrap">
  <div class="viewport" bind:this={el}></div>
  <button class="frame" title="Frame the model (F)" aria-label="Frame the model" onclick={() => view?.frame()}>
    <Icon name="frame" size={16} />
  </button>
</div>

<style>
  .wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .viewport {
    position: absolute;
    inset: 0;
    overflow: hidden;
  }
  .viewport :global(canvas) {
    display: block;
    touch-action: none;
  }
  .frame {
    position: absolute;
    top: 10px;
    right: 10px;
    padding: 5px 6px;
    display: grid;
    place-items: center;
    background: rgba(31, 34, 40, 0.85);
  }
</style>
