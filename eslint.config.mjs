// Lint: typescript-eslint strict + type-checked, plus the "no escape hatches" rules
// (no any, no ts-ignore / ts-expect-error, no non-null `!`, no `as` casts). Only src/ and worker/*.ts are linted.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  // worker/*.js is built from worker/index.ts; worker-configuration.d.ts is `wrangler types` output.
  { ignores: ['site/**', 'tests/**', 'worker/*.js', 'worker/worker-configuration.d.ts', 'scripts/**', 'migrations/**', 'node_modules/**', '.wrangler/**', '*.mjs'] },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    files: ['src/**/*.ts'],
    ignores: ['src/sw/**'],
    languageOptions: {
      // Every game file is an ES module (bundled by scripts/build.mjs).
      sourceType: 'module',
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // The service worker: a classic script with its own program (lib webworker).
    files: ['src/sw/**/*.ts'],
    languageOptions: {
      sourceType: 'script',
      parserOptions: { projectService: false, project: ['./tsconfig.sw.json'], tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // The Worker: an ES module typed against the Workers runtime.
    files: ['worker/**/*.ts'],
    languageOptions: {
      sourceType: 'module',
      parserOptions: { projectService: false, project: ['./tsconfig.worker.json'], tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // The same strict rules for every TypeScript file.
    files: ['src/**/*.ts', 'worker/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-expect-error': true, 'ts-ignore': true, 'ts-nocheck': true, 'ts-check': false }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      // `as const` stays allowed; every other `as` is a cast that silences the checker.
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      // Game modules export every top-level name (the test surface reaches them all), so only locals must be used.
      '@typescript-eslint/no-unused-vars': ['error', { vars: 'local', args: 'after-used' }],
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      // The global types in *.d.ts are shared by every file.
      'no-var': 'error',
    },
  },
  {
    files: ['src/**/*.d.ts'],
    rules: { 'no-var': 'off', '@typescript-eslint/no-unused-vars': 'off' },
  },
  {
    // The shop's rules: no page, no storage, no clock, no timers, no Math.random.
    // Effects go out through core/fx.ts, the save through core/env.ts, randomness through core/rng.ts, time through G.t.
    files: ['src/core/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', ...['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'queueMicrotask',
        'performance', 'Date', 'Audio', 'AudioContext', 'HTMLElement', 'Element', 'Node', 'Event', 'WebSocket', 'BroadcastChannel']
        .map(name => ({ name, message: 'src/core/ has no page, clock or timers.' }))],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'draw from core/rng.ts (an injected, seedable stream)' },
        { object: 'Date', property: 'now', message: 'the rules read time from G.t' },
        { object: 'globalThis', message: 'src/core/ reaches nothing outside itself' }],
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/ui/*', '**/net/*', '../ui', '../net', '../../ui', '../../net'], message: 'src/core/ does not import the page (src/ui/, src/net/); the page calls core.' }] }],
    },
  },
);
