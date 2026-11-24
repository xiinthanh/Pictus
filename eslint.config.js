import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import { defineConfig } from 'eslint/config';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';
import svelteConfig from './svelte.config.js';

export default defineConfig(
  { ignores: ['build/', '.svelte-kit/', 'src-tauri/'] },
  js.configs.recommended,
  ts.configs.recommended,
  svelte.configs.recommended,
  prettier,
  svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      // TypeScript already reports undefined names; this rule misfires on types (typescript-eslint guidance).
      'no-undef': 'off',
      // AGENTS.md 3.10: no leftover debug logging; warn/error are real reporting.
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // The benchmark prints its timings on purpose; IMPLEMENTATION_DOC.md quotes them.
    files: ['tests/perf.test.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
    languageOptions: {
      parserOptions: { projectService: true, extraFileExtensions: ['.svelte'], parser: ts.parser, svelteConfig },
    },
  },
);
