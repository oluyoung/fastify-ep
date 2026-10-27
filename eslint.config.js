import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    files: ['src/**/*.ts'],
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // Not real TS: `{{moduleName}}`/`{{ModuleName}}` placeholders are rendered into
    // identifiers before these files exist as valid TypeScript.
    ignores: [
      'dist/**',
      'module-template/**',
      'module-template-awilix/**',
      'template-overlays/di/**',
      'examples/**',
    ],
  },
);
