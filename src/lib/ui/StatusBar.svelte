<script lang="ts">
  import { MIRROR_AXES } from '$lib/core/tools';
  import { app, editor, TOOLS } from '$lib/state/app.svelte';

  const tool = $derived(TOOLS.find((t) => t.id === app.tool));
  const mirrors = $derived(
    MIRROR_AXES.filter(([, key]) => app.mirror[key])
      .map(([axis]) => axis)
      .join(''),
  );
  const voxelSize = $derived((app.rev, editor.voxelSize));
</script>

<footer>
  <span class="cell">
    {#if app.hover}x {app.hover[0]} · y {app.hover[1]} · z {app.hover[2]}{:else}<span class="muted">—</span>{/if}
  </span>
  <span class="muted">{tool?.hint}</span>
  <span class="spacer"></span>
  {#if app.status}<span class="status">{app.status}</span>{/if}
  {#if mirrors}<span class="tag">Mirror {mirrors}</span>{/if}
  {#if app.isLayerMode}<span class="tag">Layer {app.layer + 1}</span>{/if}
  <span class="muted">1 voxel = {voxelSize} mm</span>
</footer>

<style>
  footer {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 12px;
    background: var(--panel);
    border-top: 1px solid var(--border);
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  .cell {
    min-width: 150px;
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    flex: 1;
  }
  .status {
    color: var(--ok);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tag {
    padding: 0 6px;
    border-radius: 4px;
    background: rgba(79, 140, 255, 0.18);
    color: #cfe0ff;
  }
</style>
