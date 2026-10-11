import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

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
  // React 专项：rules-of-hooks（条件/嵌套 hook 调用，error）与 exhaustive-deps
  // （stale closure / 缺失清理，warn）。source-switcher 点击固定与 serp-bar 滚动隐藏的
  // cancelClose/卸载清理类 bug 正是该规则针对的失败模式，靠评审兜底不可持续。
  // 注意：只启用这两条经典规则——插件 v7 的 recommended-latest 还捆绑
  // set-state-in-effect / refs / purity 等编译器系 error 级规则，会在全仓既有代码上
  // 报 12+ error（见 2026-10 评审），需要专项重构才能接入，不在本次范围。
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            // **/lib/storage/* 同时覆盖别名形式（@/lib/storage/x）与相对形式
            // （../lib/storage/x、./lib/storage/x）；barrel 本身（@/lib/storage）不带
            // 尾部路径，不受影响。
            group: ['@/lib/storage/*', '**/lib/storage/*', '../storage/*', './storage/*'],
            message: '深层导入 lib/storage/ 子模块被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例与稳定公共 API 面。',
          },
        ],
      }],
      // no-restricted-imports 只查静态 import/export：补动态 import()/require() 的
      // 字符串字面量兜底（no-restricted-syntax）。ImportExpression 是 typescript-eslint
      // 的动态 import 节点形态，CallExpression[callee.type='Import'] 是 espree（js 文件）
      // 的形态，两个都挂。模板字符串拼路径的动态导入无法静态匹配，是已知残余绕过口，
      // 依赖评审兜底。
      'no-restricted-syntax': ['error', {
        selector: "ImportExpression > Literal[value=/(^|\\/)lib\\/storage\\//]",
        message: '动态 import lib/storage/ 子模块同样被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例。',
      }, {
        selector: "CallExpression[callee.type='Import'] > Literal[value=/(^|\\/)lib\\/storage\\//]",
        message: '动态 import lib/storage/ 子模块同样被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例。',
      }, {
        selector: "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)lib\\/storage\\//]",
        message: 'require lib/storage/ 子模块同样被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例。',
      }],
    },
  },
);
