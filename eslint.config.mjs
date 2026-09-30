import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'db/**', 'tests/reference/**', 'deploy/**', 'coverage/**', 'reports/**', '**/*.mjs', 'eslint.config.mjs'],
  },
  ...tseslint.configs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['packages/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: ['fastify', 'react', 'react-dom'],
          patterns: ['apps/*'],
        },
      ],
    },
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: ['@hcn/domain', '@hcn/db', 'fastify'],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Chỉ apps/web/src/studio/math.tsx được render HTML của KaTeX.',
        },
      ],
    },
  },
  {
    files: ['apps/web/src/studio/math.tsx'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
)
