<script lang="ts">
  import { app } from '$lib/state/app.svelte';
  import Modal from './Modal.svelte';

  const req = $derived(app.confirm!);
  const cancelId = $derived(req.buttons.find((b) => b.id === 'cancel')?.id ?? req.buttons[0].id);
</script>

<Modal title={req.title} onclose={() => req.resolve(cancelId)} width={400}>
  <p>{req.message}</p>
  {#snippet footer()}
    {#each req.buttons as b (b.id)}
      <button class:primary={b.isPrimary} onclick={() => req.resolve(b.id)}>{b.label}</button>
    {/each}
  {/snippet}
</Modal>

<style>
  p {
    margin: 0;
    line-height: 1.5;
    white-space: pre-wrap;
    user-select: text;
  }
</style>
