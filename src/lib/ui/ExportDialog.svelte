<script lang="ts">
  import { analyze } from '$lib/core/analysis';
  import { writeObj } from '$lib/core/export/obj';
  import { writeStl } from '$lib/core/export/stl';
  import { write3mf } from '$lib/core/export/threemf';
  import { colorBodies, mergedBody } from '$lib/core/mesher';
  import { baseName, errorText, pickSave, stripExt, withExt, writeBytes, writeText } from '$lib/platform/files';
  import { app, editor } from '$lib/state/app.svelte';
  import Modal from './Modal.svelte';

  type Format = '3mf' | 'stl' | 'obj';
  const PREFS_KEY = 'pictus.export';

  function loadPrefs(): { format: Format; multi: boolean } {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      return { format: ['3mf', 'stl', 'obj'].includes(p.format) ? p.format : '3mf', multi: p.multi !== false };
    } catch {
      return { format: '3mf', multi: true };
    }
  }

  const prefs = loadPrefs();
  let format = $state<Format>(prefs.format);
  let multi = $state(prefs.multi);
  let voxelSize = $state(editor.voxelSize);
  let busy = $state(false);

  const report = analyze(editor.grid);
  const colors = new Set(editor.grid.data).size - (editor.grid.data.includes(0) ? 1 : 0);
  const sizeMm = $derived(
    [editor.grid.sx, editor.grid.sy, editor.grid.sz].map((v) => Math.round(v * voxelSize * 10) / 10).join(' × '),
  );

  const FORMATS: { id: Format; label: string; note: string }[] = [
    { id: '3mf', label: '3MF', note: 'Best for slicers. Keeps each color as a separate part.' },
    { id: 'stl', label: 'STL', note: 'Works everywhere. No colors — one file per color if you choose multi-color.' },
    { id: 'obj', label: 'OBJ', note: 'Mesh with color materials (.obj + .mtl).' },
  ];

  async function doExport() {
    if (!(voxelSize > 0)) return;
    const ext = '.' + format;
    const p = await pickSave([{ name: format.toUpperCase(), extensions: [format] }], `${app.docName}${ext}`);
    if (!p) return;
    const path = withExt(p, ext);
    busy = true;
    // Let the "Exporting…" state paint before the synchronous meshing work.
    await new Promise((r) => setTimeout(r, 30));
    try {
      editor.setVoxelSize(voxelSize);
      const bodies = multi && colors > 1 ? colorBodies(editor.grid) : [mergedBody(editor.grid)];
      const name = stripExt(baseName(path));
      let written = baseName(path);
      if (format === '3mf') {
        await writeBytes(path, write3mf(bodies, editor.palette, voxelSize, name));
      } else if (format === 'obj') {
        const mtlName = name + '.mtl';
        const { obj, mtl } = writeObj(bodies, editor.palette, voxelSize, mtlName);
        await writeText(path, obj);
        await writeText(withExt(path, '.mtl'), mtl);
        written += ` and ${mtlName}`;
      } else if (bodies.length > 1) {
        for (const b of bodies) {
          await writeBytes(withExt(path, `_color${b.color}.stl`), writeStl([b], voxelSize));
        }
        written = `${bodies.length} STL files (${name}_color…)`;
      } else {
        await writeBytes(path, writeStl(bodies, voxelSize));
      }
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify({ format, multi }));
      } catch {
        /* ignore */
      }
      app.flash(`Exported ${written}`, 6000);
      app.dialog = null;
    } catch (e) {
      await app.ask('Export failed', errorText(e), [{ id: 'ok', label: 'OK', primary: true }]);
    } finally {
      busy = false;
    }
  }

  function openCheck() {
    app.dialog = null;
    app.checkOpen = true;
  }
</script>

<Modal title="Export for 3D printing" onclose={() => !busy && (app.dialog = null)} width={460}>
  {#if report.voxels === 0}
    <p class="warn">The model is empty — add some voxels first.</p>
  {:else}
    <div>
      <h3>Format</h3>
      <div class="formats">
        {#each FORMATS as f (f.id)}
          <label class="format" class:active={format === f.id}>
            <input type="radio" name="format" value={f.id} bind:group={format} />
            <b>{f.label}</b><span class="muted">{f.note}</span>
          </label>
        {/each}
      </div>
    </div>

    {#if colors > 1}
      <label class="row check">
        <input type="checkbox" bind:checked={multi} />
        <span>Multi-color: export each of the {colors} colors as its own part</span>
      </label>
    {/if}

    <label class="row">
      Voxel size <input type="number" min="0.1" max="20" step="0.1" bind:value={voxelSize} /> mm
      <span class="muted">→ {sizeMm} mm</span>
    </label>

    {#if report.parts.length > 1 || report.contacts.length}
      <div class="issues">
        {#if report.parts.length > 1}<p>
            ⚠ {report.parts.length} separate parts — smaller ones may fall over or get lost.
          </p>{/if}
        {#if report.contacts.length}<p>
            ⚠ {report.contacts.length} spots where voxels touch only at an edge or corner — these print weak.
          </p>{/if}
        <button onclick={openCheck}>Review in print check</button>
      </div>
    {:else}
      <p class="ok">✓ One solid part with no thin contacts.</p>
    {/if}
  {/if}

  {#snippet footer()}
    <button onclick={() => (app.dialog = null)} disabled={busy}>Cancel</button>
    <button class="primary" disabled={busy || report.voxels === 0 || !(voxelSize > 0)} onclick={doExport}>
      {busy ? 'Exporting…' : 'Export…'}
    </button>
  {/snippet}
</Modal>

<style>
  .formats {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .format {
    display: grid;
    grid-template-columns: auto 40px 1fr;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    cursor: pointer;
    color: var(--text);
  }
  .format.active {
    border-color: var(--accent);
    background: rgba(79, 140, 255, 0.1);
  }
  .format span {
    font-size: 12px;
  }
  .check {
    color: var(--text);
  }
  .issues {
    border: 1px solid #5c4a25;
    background: rgba(255, 183, 77, 0.08);
    border-radius: var(--radius);
    padding: 8px 10px;
  }
  .issues p {
    margin: 0 0 6px;
    color: var(--warn);
  }
  .ok {
    color: var(--ok);
    margin: 0;
  }
  .warn {
    color: var(--warn);
    margin: 0;
  }
</style>
