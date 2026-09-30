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
  {
    files: ['packages/domain/**/*.ts'],
    ignores: ['packages/domain/src/quiz/answer.ts', 'packages/domain/src/quiz/submit.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportDeclaration[source.value='./keys.ts'], ImportDeclaration[source.value='./keys.js'], ImportDeclaration[source.value='../quiz/keys.ts'], ImportDeclaration[source.value='./quiz/keys.ts']",
          message: 'Chỉ answerQuestion và submitAttempt được đọc question_keys.',
        },
        {
          selector: "ExportNamedDeclaration[source.value='./quiz/keys.ts'], ExportAllDeclaration[source.value='./quiz/keys.ts']",
          message: 'Không xuất readQuestionKey ra khỏi use case chấm.',
        },
      ],
    },
  },
)
