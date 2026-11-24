<script lang="ts">
  import { analyze, cellsAtVertex, fixThinContacts, type PrintReport } from '$lib/core/analysis';
  import type { Vec3 } from '$lib/core/grid';
  import { app, editor } from '$lib/state/app.svelte';
  import Icon from './Icon.svelte';

  let report = $state<PrintReport>(analyze(editor.grid));
  let checkedRev = $state(app.rev);
  let shown = $state<string | null>(null);
  const isStale = $derived(app.rev !== checkedRev);

  function recheck() {
    report = analyze(editor.grid);
    checkedRev = app.rev;
    show(null, []);
  }

  /** The highlight this panel last set; any other value was set elsewhere (e.g. by the AI). */
  let ownHighlight: Vec3[] | null = null;

  function show(id: string | null, cells: Vec3[]) {
    shown = id;
    app.highlight = cells;
    // Read back: the state stores its own proxy of `cells`, which is what later reads return.
    ownHighlight = app.highlight;
  }

  // Someone else replaced the highlight, so none of this panel's "Show" buttons is on any more.
  $effect(() => {
    if (app.highlight !== ownHighlight) shown = null;
  });

  function toggle(id: string, cells: () => Vec3[]) {
    if (shown === id) show(null, []);
    else show(id, cells());
  }

  function partCells(k: number): Vec3[] {
    return Array.from(report.parts[k].indices.subarray(0, 20000), (i) => editor.grid.coords(i));
  }

  function contactCells(): Vec3[] {
    // eslint-disable-next-line svelte/prefer-svelte-reactivity -- local de-dup set, never rendered or stored
    const seen = new Set<string>();
    const out: Vec3[] = [];
    for (const v of report.contacts)
      for (const c of cellsAtVertex(editor.grid, v)) {
        const key = c.join(',');
        if (!seen.has(key)) {
          seen.add(key);
          out.push(c);
        }
      }
    return out;
  }

  function removeSmallParts() {
    const idx: number[] = [];
    for (const p of report.parts.slice(1)) for (const i of p.indices) idx.push(i);
    const n = editor.fill(idx, 0);
    app.flash(`Removed ${n} voxels in ${report.parts.length - 1} small parts (Ctrl+Z to undo)`);
    recheck();
  }

  function removePart(k: number) {
    editor.fill(report.parts[k].indices, 0);
    recheck();
  }

  function fixContacts() {
    const { changes, remaining } = fixThinContacts(editor.grid);
    editor.apply(changes);
    app.flash(
      remaining
        ? `Added ${changes.length} voxels; ${remaining} contacts at the grid edge could not be fixed`
        : `Added ${changes.length} voxels to thicken thin contacts (Ctrl+Z to undo)`,
      6000,
    );
    recheck();
  }

  function close() {
    app.highlight = [];
    app.isCheckOpen = false;
  }
</script>

<div class="panel" role="region" aria-label="Print check">
  <div class="head row">
    <h2>Print check</h2>
    <span class="spacer"></span>
    <button class="icon" onclick={close} title="Close" aria-label="Close"><Icon name="close" size={16} /></button>
  </div>

  {#if isStale}
    <div class="stale row">The model changed. <button onclick={recheck}>Check again</button></div>
  {/if}

  {#if report.voxels === 0}
    <p class="muted">The model is empty.</p>
  {:else}
    <section>
      {#if report.parts.length <= 1}
        <p class="ok">✓ One connected part</p>
      {:else}
        <p class="warn">⚠ {report.parts.length} separate parts</p>
        <p class="muted small">Parts that don't touch the main body by a face print as loose pieces.</p>
        <ul>
          {#each report.parts.slice(0, 8) as p, k (k)}
            <li class="row">
              <span>{k === 0 ? 'Main body' : `Part ${k + 1}`}</span>
              <span class="muted">{p.size} voxels</span>
              <span class="spacer"></span>
              <button
                class="small-btn"
                class:active={shown === `p${k}`}
                onclick={() => toggle(`p${k}`, () => partCells(k))}
              >
                Show
              </button>
              {#if k > 0}<button class="small-btn" onclick={() => removePart(k)}>Delete</button>{/if}
            </li>
          {/each}
        </ul>
        {#if report.parts.length > 8}<p class="muted small">…and {report.parts.length - 8} more</p>{/if}
        <button onclick={removeSmallParts}>Keep only the main body</button>
      {/if}
    </section>

    <section>
      {#if !report.contacts.length}
        <p class="ok">✓ No edge or corner-only contacts</p>
      {:else}
        <p class="warn">⚠ {report.contacts.length} thin contacts</p>
        <p class="muted small">
          Voxels touching only at an edge or corner make weak, zero-width joints that slicers flag as errors.
        </p>
        <div class="row">
          <button class:active={shown === 'c'} onclick={() => toggle('c', contactCells)}>Show</button>
          <button class="primary" onclick={fixContacts}>Fix all</button>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .panel {
    position: absolute;
    top: 10px;
    left: 10px;
    width: 300px;
    max-height: calc(100% - 20px);
    overflow-y: auto;
    z-index: 20;
    background: rgba(31, 34, 40, 0.97);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 12px 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  }
  .head h2 {
    margin: 0;
  }
  .spacer {
    flex: 1;
  }
  .icon {
    padding: 3px 5px;
    display: grid;
    place-items: center;
  }
  section {
    padding: 10px 0;
    border-top: 1px solid var(--border);
    margin-top: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  p {
    margin: 0;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--warn);
    font-weight: 600;
  }
  .small {
    font-size: 12px;
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .small-btn {
    padding: 2px 8px;
    font-size: 12px;
  }
  .active {
    border-color: var(--accent);
  }
  .stale {
    margin-top: 8px;
    font-size: 12px;
    color: var(--warn);
    justify-content: space-between;
  }
</style>
