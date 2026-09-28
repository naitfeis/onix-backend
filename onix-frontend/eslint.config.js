import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.es2023 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      // Rules of Hooks + exhaustive-deps: catches stale closures that the
      // compiler cannot see (effects reading values missing from deps).
      'react-hooks': reactHooks,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        // `const { a, ...rest } = obj` deliberately drops `a`.
        ignoreRestSiblings: true,
      }],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Build/asset scripts run in Node, not the browser.
    files: ['scripts/**/*.{js,mjs,cjs}', '*.config.{js,mjs,cjs}', 'vitest.*.ts', 'vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
    },
    rules: {
      'no-console': 'off',
    },
  },
);