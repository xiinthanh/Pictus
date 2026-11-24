<script lang="ts">
  import { onMount } from 'svelte';
  import type { Vec3 } from '$lib/core/grid';
  import { toCss } from '$lib/core/palette';
  import { lineCells } from '$lib/core/tools';
  import { boxRegion, editCells, fillAt, pickAt } from '$lib/editing';
  import { app, editor, type BoxMode } from '$lib/state/app.svelte';

  let wrap: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let size = $state({ w: 0, h: 0 });
  let hover = $state<Vec3 | null>(null);
  let drag: { mode: BoxMode; last: Vec3 } | null = null;
  let box = $state<{ start: Vec3; end: Vec3 } | null>(null);

  const layer = $derived((app.rev, Math.min(app.layer, editor.grid.sz - 1)));

  function layout() {
    const g = editor.grid;
    const pad = 16;
    const cs = Math.max(2, Math.floor(Math.min((size.w - pad * 2) / g.sx, (size.h - pad * 2) / g.sy)));
    return { cs, ox: Math.floor((size.w - cs * g.sx) / 2), oy: Math.floor((size.h - cs * g.sy) / 2) };
  }

  function cellAt(e: PointerEvent): Vec3 | null {
    const r = canvas.getBoundingClientRect();
    const { cs, ox, oy } = layout();
    const g = editor.grid;
    const x = Math.floor((e.clientX - r.left - ox) / cs);
    const y = g.sy - 1 - Math.floor((e.clientY - r.top - oy) / cs);
    return x >= 0 && y >= 0 && x < g.sx && y < g.sy ? [x, y, layer] : null;
  }

  function draw() {
    if (!canvas || !size.w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    const g = editor.grid;
    const { cs, ox, oy } = layout();
    const px = (x: number) => ox + x * cs;
    const py = (y: number) => oy + (g.sy - 1 - y) * cs;

    ctx.fillStyle = '#101216';
    ctx.fillRect(ox, oy, cs * g.sx, cs * g.sy);
    const pal = editor.palette.map(toCss);
    // Onion skin: the layer below, faded.
    if (layer > 0) {
      ctx.globalAlpha = 0.22;
      for (let y = 0; y < g.sy; y++)
        for (let x = 0; x < g.sx; x++) {
          const v = g.data[g.index(x, y, layer - 1)];
          if (v) {
            ctx.fillStyle = pal[v];
            ctx.fillRect(px(x), py(y), cs, cs);
          }
        }
      ctx.globalAlpha = 1;
    }
    for (let y = 0; y < g.sy; y++)
      for (let x = 0; x < g.sx; x++) {
        const v = g.data[g.index(x, y, layer)];
        if (v) {
          ctx.fillStyle = pal[v];
          ctx.fillRect(px(x), py(y), cs, cs);
        }
      }
    if (cs >= 6) {
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= g.sx; x++) {
        ctx.moveTo(px(x) + 0.5, oy);
        ctx.lineTo(px(x) + 0.5, oy + cs * g.sy);
      }
      for (let y = 0; y <= g.sy; y++) {
        ctx.moveTo(ox, oy + y * cs + 0.5);
        ctx.lineTo(ox + cs * g.sx, oy + y * cs + 0.5);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.strokeRect(ox + 0.5, oy + 0.5, cs * g.sx - 1, cs * g.sy - 1);
    // Mirror axes.
    ctx.strokeStyle = 'rgba(179,136,255,0.7)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    if (app.mirror.x) {
      ctx.moveTo(ox + (cs * g.sx) / 2, oy);
      ctx.lineTo(ox + (cs * g.sx) / 2, oy + cs * g.sy);
    }
    if (app.mirror.y) {
      ctx.moveTo(ox, oy + (cs * g.sy) / 2);
      ctx.lineTo(ox + cs * g.sx, oy + (cs * g.sy) / 2);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    if (box) {
      const cells = boxRegion(box.start, box.end, 2, 1, 1);
      const lo = cells[0],
        hi = cells[cells.length - 1];
      ctx.fillStyle = app.boxMode === 'erase' ? 'rgba(255,90,90,0.35)' : toCss(editor.palette[app.color]) + '88';
      ctx.fillRect(px(lo[0]), py(hi[1]), (hi[0] - lo[0] + 1) * cs, (hi[1] - lo[1] + 1) * cs);
    } else if (hover) {
      ctx.strokeStyle = app.tool === 'erase' ? '#ff5a5a' : '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(px(hover[0]) + 1, py(hover[1]) + 1, cs - 2, cs - 2);
    }
  }

  $effect(() => {
    void app.rev;
    void layer;
    void hover;
    void box;
    void size;
    void app.mirror;
    void app.color;
    void app.tool;
    void app.boxMode;
    draw();
  });

  onMount(() => {
    const ro = new ResizeObserver(() => (size = { w: wrap.clientWidth, h: wrap.clientHeight }));
    ro.observe(wrap);
    return () => ro.disconnect();
  });

  function strokeMode(e: PointerEvent): BoxMode | null {
    if (e.button === 2) return 'erase';
    if (app.tool === 'place') return 'add';
    if (app.tool === 'erase') return 'erase';
    if (app.tool === 'paint') return 'paint';
    return null;
  }

  function onDown(e: PointerEvent) {
    const c = cellAt(e);
    if (!c || (e.button !== 0 && e.button !== 2)) return;
    canvas.setPointerCapture(e.pointerId);
    const mode = strokeMode(e);
    if (mode) {
      editor.beginStroke();
      drag = { mode, last: c };
      editCells([c], mode);
    } else if (app.tool === 'pick') pickAt(c);
    else if (app.tool === 'fill') fillAt(c, layer);
    else if (app.tool === 'box') box = { start: c, end: c };
  }

  function onMove(e: PointerEvent) {
    const c = cellAt(e);
    hover = c;
    app.hover = c;
    if (!c) return;
    if (drag) {
      editCells(lineCells(drag.last, c), drag.mode);
      drag.last = c;
    } else if (box) box = { ...box, end: c };
  }

  function onUp(e: PointerEvent) {
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (drag) {
      editor.endStroke();
      drag = null;
    }
    if (box) {
      editCells(boxRegion(box.start, box.end, 2, 1, 1), app.boxMode);
      box = null;
    }
  }
</script>

<div class="slice" bind:this={wrap}>
  <canvas
    bind:this={canvas}
    style:width="{size.w}px"
    style:height="{size.h}px"
    onpointerdown={onDown}
    onpointermove={onMove}
    onpointerup={onUp}
    onpointercancel={onUp}
    onpointerleave={() => {
      hover = null;
    }}
    oncontextmenu={(e) => e.preventDefault()}
  ></canvas>
  <div class="label">Layer {layer + 1} <span class="muted">· right-drag erases · faded = layer below</span></div>
</div>

<style>
  .slice {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    border-left: 1px solid var(--border);
    background: var(--bg);
    overflow: hidden;
  }
  canvas {
    position: absolute;
    inset: 0;
    cursor: crosshair;
    touch-action: none;
  }
  .label {
    position: absolute;
    left: 10px;
    top: 8px;
    font-size: 12px;
    pointer-events: none;
  }
</style>
