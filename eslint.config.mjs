import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

// lib/storage 深层导入禁令（全仓消费者）：所有消费者必须经 @/lib/storage barrel 导入，
// 保证 mutation 队列单一实例与稳定公共 API 面。页面信任域块复用同一常量——flat config 中
// 后匹配块的规则选项整体胜出，页面块必须把深层导入模式一并带上，否则覆盖后页面文件将
// 失去该禁令。
const STORAGE_BARREL_ONLY_PATTERNS = [
  {
    // **/lib/storage/* 同时覆盖别名形式（@/lib/storage/x）与相对形式
    // （../lib/storage/x、./lib/storage/x）；barrel 本身（@/lib/storage）不带
    // 尾部路径，不受影响。
    group: ['@/lib/storage/*', '**/lib/storage/*', '../storage/*', './storage/*'],
    message: '深层导入 lib/storage/ 子模块被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例与稳定公共 API 面。',
  },
];

// 页面信任域红线（AGENTS.md 安全规则的机器强制）：entrypoints 下 UI 页与 content
// script、components 只经 messaging 拿脱敏快照，禁止直接导入 barrel 的明文 key 面符号。
// 清单逐个 grep 验证页面侧零消费后列入（getKey/setKey/clearKey、KEYS_KEY、
// RERANK_CONFIG_KEY、getRerankConfig/setRerankConfig、buildAggregateProjection 的
// 消费者全在 lib/ 与 tests/ 下）；脱敏 API（getConfiguredProviderIds /
// getProviderConfigSnapshot，只回 id / hasApiKey 布尔）不在其列。
// regex 覆盖别名与任意深度相对路径变体（页面文件深度不同：../lib/storage、
// ../../lib/storage…），ESLint 10 的 paths 条目不支持 regex，故走 patterns。
const STORAGE_PAGE_REDLINE_PATTERNS = [
  {
    regex: '^(@\\/|\\.\\.?\\/)*lib\\/storage$',
    importNames: [
      'getKey',
      'setKey',
      'clearKey',
      'KEYS_KEY',
      'RERANK_CONFIG_KEY',
      'getRerankConfig',
      'setRerankConfig',
      'buildAggregateProjection',
    ],
    message: '页面代码禁止导入 lib/storage 的 worker 信任域符号（明文 key 面）：entrypoints UI 页 / content script / components 绝不读明文 key 或 providerKeys map。需要配置状态时经 messaging 向 worker 获取脱敏快照（getProviderConfigSnapshot / getConfiguredProviderIds）。',
  },
];

// no-restricted-imports 只查静态 import/export：补动态 import()/require() 的
// 字符串字面量兜底（no-restricted-syntax）。ImportExpression 是 typescript-eslint
// 的动态 import 节点形态，CallExpression[callee.type='Import'] 是 espree（js 文件）
// 的形态，两个都挂。模板字符串拼路径的动态导入无法静态匹配，是已知残余绕过口，
// 依赖评审兜底。
const STORAGE_DYNAMIC_SUBMODULE_SELECTORS = [
  {
    selector: "ImportExpression > Literal[value=/(^|\\/)lib\\/storage\\//]",
    message: '动态 import lib/storage/ 子模块同样被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例。',
  },
  {
    selector: "CallExpression[callee.type='Import'] > Literal[value=/(^|\\/)lib\\/storage\\//]",
    message: '动态 import lib/storage/ 子模块同样被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例。',
  },
  {
    selector: "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)lib\\/storage\\//]",
    message: 'require lib/storage/ 子模块同样被禁止：所有消费者必须经 @/lib/storage barrel 导入，保证 mutation 队列单一实例。',
  },
];

// 页面块追加：动态 import()/require() barrel 本身也禁止（含相对路径变体），静态
// import 禁不掉的红线符号不能换个形态从后门进。
const STORAGE_PAGE_BARREL_DYNAMIC_SELECTORS = [
  {
    selector: "ImportExpression > Literal[value=/(^|\\/)lib\\/storage$/]",
    message: '页面代码禁止动态 import lib/storage（明文 key 面）：需要配置状态时经 messaging 向 worker 获取脱敏快照（getProviderConfigSnapshot / getConfiguredProviderIds）。',
  },
  {
    selector: "CallExpression[callee.type='Import'] > Literal[value=/(^|\\/)lib\\/storage$/]",
    message: '页面代码禁止动态 import lib/storage（明文 key 面）：需要配置状态时经 messaging 向 worker 获取脱敏快照（getProviderConfigSnapshot / getConfiguredProviderIds）。',
  },
  {
    selector: "CallExpression[callee.name='require'] > Literal[value=/(^|\\/)lib\\/storage$/]",
    message: '页面代码禁止 require lib/storage（明文 key 面）：需要配置状态时经 messaging 向 worker 获取脱敏快照（getProviderConfigSnapshot / getConfiguredProviderIds）。',
  },
];

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
  // 编译器系规则分工（v7 插件，2026-10 接入，显式列出不用 recommended-latest——
  // preset 规则面随插件版本漂移）：set-state-in-effect（effect 内同步 setState，
  // 渲染期调整模式替代）、refs（渲染期读写 ref，commit 期同步替代）、purity
  // （渲染期不纯）。合法 effect setState 场景（fetch-on-open 等）显式 eslint-disable
  // 并附理由，不静默放行。
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/refs': 'error',
      'react-hooks/purity': 'error',
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
        patterns: STORAGE_BARREL_ONLY_PATTERNS,
      }],
      'no-restricted-syntax': ['error', ...STORAGE_DYNAMIC_SUBMODULE_SELECTORS],
    },
  },
  // 页面信任域边界（KTD：页面代码不碰 key）。必须排在上一块之后：同文件多块命中时
  // 后块的规则选项整体胜出，页面块因此要自带深层导入模式 + 动态导入兜底，只写红线
  // 会把页面文件上的 barrel-only 禁令覆盖掉。
  {
    files: ['entrypoints/**/*.{ts,tsx}', 'components/**/*.{ts,tsx}'],
    // background 是 worker 上下文（key 的唯一合法读者），豁免页面红线。
    ignores: ['entrypoints/background.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [...STORAGE_BARREL_ONLY_PATTERNS, ...STORAGE_PAGE_REDLINE_PATTERNS],
      }],
      'no-restricted-syntax': ['error', ...STORAGE_DYNAMIC_SUBMODULE_SELECTORS, ...STORAGE_PAGE_BARREL_DYNAMIC_SELECTORS],
    },
  },
);
