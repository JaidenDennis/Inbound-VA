// ESLint 9 flat config for the backend (ESM). Pragmatic TypeScript linting:
// the type-aware rules are intentionally NOT enabled (they need a slow program
// build and tend to flood an existing codebase); this catches real mistakes
// without blocking shipping.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      // Allow intentionally-unused args/vars when prefixed with _ (noop adapter,
      // interface stubs, event handlers).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // `any` shows up at provider/adapter boundaries; flag it, don't fail on it.
      '@typescript-eslint/no-explicit-any': 'warn',
      // Empty catch/empty function is sometimes deliberate (best-effort paths).
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Tests: relax a couple of rules that are noise in mocks.
    files: ['src/__tests__/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  }
);
