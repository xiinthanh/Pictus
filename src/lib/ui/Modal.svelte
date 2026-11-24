<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    onclose,
    width = 420,
    children,
    footer,
  }: {
    title: string;
    onclose: () => void;
    width?: number;
    children: Snippet;
    footer?: Snippet;
  } = $props();

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onclose();
    }
  }
</script>

<svelte:window {onkeydown} />

<div class="backdrop" role="presentation" onpointerdown={(e) => e.target === e.currentTarget && onclose()}>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title} style:width="{width}px">
    <h2>{title}</h2>
    <div class="body">{@render children()}</div>
    {#if footer}<div class="footer">{@render footer()}</div>{/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: grid;
    place-items: center;
    z-index: 50;
  }
  .modal {
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    overflow: auto;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 18px 20px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
