import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        // Pin the root: any nested checkout (e.g. agent worktrees) carries its own
        // tsconfig, and multiple candidate roots make typescript-eslint fail every file.
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': 'error',
    },
  },
  {
    // Flat config does not read .gitignore — mirror its tooling/scratch entries here.
    ignores: ['**/dist/**', '**/node_modules/**', '.claude/**', '.github/**', '__ideas/**'],
  }
)
