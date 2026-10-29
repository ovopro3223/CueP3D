// @ts-check
import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/samples/**',
      '**/out/**',
      '**/fixtures/**',
      '**/coverage/**',
      'apps/demo/public/**',
      'bench/results/**',
    ],
  },
  {
    // Node-only build/tooling scripts: plain .mjs, no tsconfig "node" types to infer globals from.
    files: ['scripts/**/*.mjs', '**/scripts/**/*.mjs', '*.config.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
