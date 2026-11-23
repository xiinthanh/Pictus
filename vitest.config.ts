import { defineConfig } from 'vitest/config';

// Core logic is plain TypeScript, so tests run without the SvelteKit plugin.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
