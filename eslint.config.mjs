// Configuración de ESLint compartida por todo el monorepo (apps/driver usa flutter analyze).
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/', '**/coverage/', 'apps/driver/', 'assets/', 'docs/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // JavaScript (landing y archivos de configuración): sin reglas que requieren tipos.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['apps/api/**', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/web/**', 'apps/rider/**', 'apps/landing/**'],
    languageOptions: { globals: globals.browser },
  },
  prettier,
);
