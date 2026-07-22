// ESLint 9 flat config for the Next.js dashboard. `next lint` was removed in
// Next 16, so we run ESLint directly against the flat configs exported by
// eslint-config-next (core-web-vitals + typescript).
import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...typescript,
  {
    // Pragmatic stance for an existing, shipping UI: flag these, don't fail on
    // them (matches the backend config). Real errors (undefined vars, bad
    // imports, hook dependency bugs) still fail the build.
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Perf hint, not a correctness bug — surfacing initial state from an
      // effect is a known, harmless pattern here.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
];
