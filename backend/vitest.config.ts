import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      // Only measure the code we own; exclude entrypoints/config/type-only files
      // that carry no branch logic worth gating on.
      include: ['src/**/*.ts'],
      exclude: [
        'src/__tests__/**',
        'src/types/**',
        'src/**/index.ts',
        'src/server.ts',
        'src/config/**',
      ],
      // Enforced by `npm run test:coverage` (and CI). Set just under current
      // coverage so it gates REGRESSIONS today; ratchet these up as the
      // dashboard-api routes and workers gain tests (see enterprise checklist).
      thresholds: {
        lines: 45,
        functions: 40,
        statements: 43,
        branches: 37,
      },
    },
  },
});
