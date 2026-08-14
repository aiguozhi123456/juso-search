import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.output/**',
      '.wxt/**',
      'dist/**',
      '**/.venv/**',
      '**/*.config.{js,mjs,cjs,ts}',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@/lib/storage/*', '../storage/*', './storage/*'],
            message: '深层导入 lib/storage/ 子模块被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例与稳定公共 API 面。',
          },
        ],
      }],
    },
  },
);
