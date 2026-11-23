<script lang="ts" module>
  // 24×24 stroke icons.
  const PATHS: Record<string, string> = {
    place: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5M17 2v4M15 4h4',
    erase: 'M7 21h10M5.5 14.5l8-8 5 5-8 8H7.5zM9.5 10.5l5 5',
    paint: 'M4 20c2 0 3-1 3-3a2 2 0 0 1 4 0c0 2-2 4-7 3zM10 13l9-9 1 1-9 9',
    pick: 'M14 4l6 6-2 2-6-6zM12 6l-8 8v4h4l8-8M4 20l2-2',
    fill: 'M5 11l7-7 7 7-7 7zM5 11h14M20 15s1.5 2 1.5 3a1.5 1.5 0 0 1-3 0c0-1 1.5-3 1.5-3',
    box: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
    layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
    mirror: 'M12 3v18M8 7l-5 5 5 5zM16 7l5 5-5 5z',
    undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
    redo: 'M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3',
    check: 'M9 12l2 2 4-4M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
    frame: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
    plus: 'M12 5v14M5 12h14',
    close: 'M6 6l12 12M18 6L6 18',
  };
</script>

<script lang="ts">
  let { name, size = 18 }: { name: string; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={PATHS[name] ?? ''} />
</svg>
