<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import {
    dockAt,
    EDGE_ZONE_PX,
    floatPositionAt,
    isPastDragThreshold,
    type ToolbarDock,
    type ToolbarDragStart,
  } from './toolbarLayout';

  let { area, start, onend }: { area: HTMLElement; start: ToolbarDragStart; onend: () => void } = $props();

  const EDGES: readonly ToolbarDock[] = ['left', 'right', 'top', 'bottom'];

  /** Null until the pointer moves past the drag threshold, so a plain click or double-click changes nothing. */
  let drag = $state<{ dock: ToolbarDock; ghostX: number; ghostY: number; float: { x: number; y: number } } | null>(
    null,
  );

  function onpointermove(e: PointerEvent) {
    if (!drag && !isPastDragThreshold(start, e.clientX, e.clientY)) return;
    const rect = area.getBoundingClientRect();
    drag = {
      dock: dockAt(e.clientX, e.clientY, rect),
      // The ghost is not clamped: a full-width bar would otherwise be stuck at the left edge.
      ghostX: e.clientX - start.offsetX - rect.left,
      ghostY: e.clientY - start.offsetY - rect.top,
      float: floatPositionAt(e.clientX, e.clientY, start, rect),
    };
  }

  function onpointerup() {
    if (drag) {
      const isFloat = drag.dock === 'float';
      app.setToolbar({
        ...app.toolbar,
        dock: drag.dock,
        floatX: isFloat ? drag.float.x : app.toolbar.floatX,
        floatY: isFloat ? drag.float.y : app.toolbar.floatY,
      });
    }
    onend();
  }
</script>

<svelte:window {onpointermove} {onpointerup} onpointercancel={onend} onblur={onend} />

<div class="overlay" class:dragging={drag} style:--zone="{EDGE_ZONE_PX}px" aria-hidden="true">
  {#if drag}
    {#each EDGES as edge (edge)}
      <div class="zone {edge}" class:hot={drag.dock === edge}></div>
    {/each}
    <div
      class="ghost"
      class:hot={drag.dock === 'float'}
      style:left="{drag.ghostX}px"
      style:top="{drag.ghostY}px"
      style:width="{start.width}px"
      style:height="{start.height}px"
    ></div>
  {/if}
</div>

<style>
  .overlay {
    position: absolute;
    inset: 0;
    z-index: 30;
    overflow: hidden;
  }
  .overlay.dragging {
    cursor: grabbing;
  }
  .zone {
    position: absolute;
    background: rgba(79, 140, 255, 0.08);
    border: 1px dashed rgba(79, 140, 255, 0.4);
  }
  .zone.hot {
    background: rgba(79, 140, 255, 0.3);
    border-color: var(--accent);
  }
  .left {
    left: 0;
    top: 0;
    bottom: 0;
    width: var(--zone);
  }
  .right {
    right: 0;
    top: 0;
    bottom: 0;
    width: var(--zone);
  }
  .top {
    top: 0;
    left: 0;
    right: 0;
    height: var(--zone);
  }
  .bottom {
    bottom: 0;
    left: 0;
    right: 0;
    height: var(--zone);
  }
  .ghost {
    position: absolute;
    border: 2px dashed rgba(79, 140, 255, 0.5);
    border-radius: 8px;
  }
  .ghost.hot {
    border-color: var(--accent);
    background: rgba(79, 140, 255, 0.12);
  }
</style>
