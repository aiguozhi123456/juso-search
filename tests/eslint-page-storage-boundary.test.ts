// 页面信任域边界 lint 规则测试（KTD：页面代码不碰 key，从约定升级为机器强制）。
//
// 锁住 eslint.config.mjs 里页面侧红线块的有效性，防未来改配置时静默失效：
//   - 页面（entrypoints UI 页 / content script / components）导入 barrel 的明文 key 面
//     符号（静态 import、再导出、相对路径变体、动态 import / require）必须报错；
//   - worker 侧（lib/、entrypoints/background.ts、tests/）与脱敏 API 必须放行；
//   - 页面块不能把既有的 barrel-only 深层导入禁令覆盖掉（flat config 后块胜出）。

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// 仓库测试一律以仓库根为 cwd 跑（npm test / npx vitest run），eslint.config.mjs 在根下解析。
const eslint = new ESLint({ overrideConfigFile: 'eslint.config.mjs' });

/** 页面侧禁止的 lib/storage barrel 红线符号（明文 key 面）。 */
const REDLINE_SYMBOLS = [
  'getKey',
  'setKey',
  'clearKey',
  'KEYS_KEY',
  'RERANK_CONFIG_KEY',
  'getRerankConfig',
  'setRerankConfig',
  'buildAggregateProjection',
];

/** 只跑本测试关心的两条规则，滤掉 no-unused-vars 等探针源码噪音。 */
async function lintBoundaryRules(filePath: string, code: string): Promise<string[]> {
  const results = await eslint.lintText(code, { filePath });
  return results[0].messages
    .filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax')
    .map((m) => `${m.ruleId}: ${m.message}`);
}

describe('页面信任域边界（lib/storage 红线符号 lint 强制）', () => {
  it.each(REDLINE_SYMBOLS)('页面侧静态 import %s 报 no-restricted-imports', async (symbol) => {
    const messages = await lintBoundaryRules('components/__probe.tsx', `import { ${symbol} } from '@/lib/storage';`);
    expect(messages.some((m) => m.startsWith('no-restricted-imports:') && m.includes('明文 key 面'))).toBe(true);
  });

  it('相对路径变体（../../lib/storage）同样报错', async () => {
    const messages = await lintBoundaryRules('entrypoints/onboarding/App.tsx', "import { getKey } from '../../lib/storage';");
    expect(messages.some((m) => m.startsWith('no-restricted-imports:') && m.includes('明文 key 面'))).toBe(true);
  });

  it('再导出（export ... from）同样报错', async () => {
    const messages = await lintBoundaryRules('components/__probe.tsx', "export { getKey } from '@/lib/storage';");
    expect(messages.some((m) => m.startsWith('no-restricted-imports:') && m.includes('明文 key 面'))).toBe(true);
  });

  it('动态 import barrel 报 no-restricted-syntax', async () => {
    const messages = await lintBoundaryRules('components/__probe.tsx', "const m = await import('@/lib/storage');");
    expect(messages.some((m) => m.startsWith('no-restricted-syntax:') && m.includes('明文 key 面'))).toBe(true);
  });

  it('require barrel（相对路径）报 no-restricted-syntax', async () => {
    const messages = await lintBoundaryRules('components/__probe.tsx', "const m = require('../../lib/storage');");
    expect(messages.some((m) => m.startsWith('no-restricted-syntax:') && m.includes('明文 key 面'))).toBe(true);
  });

  it('worker 侧（lib/）不受限', async () => {
    const messages = await lintBoundaryRules('lib/__probe.ts', "import { getKey } from '@/lib/storage';");
    expect(messages).toEqual([]);
  });

  it('worker 侧（entrypoints/background.ts）豁免页面红线', async () => {
    const messages = await lintBoundaryRules('entrypoints/background.ts', "import { getKey } from '@/lib/storage';");
    expect(messages).toEqual([]);
  });

  it('测试代码不受限', async () => {
    const messages = await lintBoundaryRules('tests/__probe.test.ts', "import { getKey } from '@/lib/storage';");
    expect(messages).toEqual([]);
  });

  it('脱敏快照 API 在页面侧放行', async () => {
    const messages = await lintBoundaryRules(
      'components/__probe.tsx',
      "import { getProviderConfigSnapshot, getConfiguredProviderIds } from '@/lib/storage';",
    );
    expect(messages).toEqual([]);
  });

  it('页面常用 prefs / 常量放行', async () => {
    const messages = await lintBoundaryRules(
      'components/KeyInput.tsx',
      "import { MAX_RESULTS_MAX, MAX_RESULTS_MIN, getStylePref } from '@/lib/storage';",
    );
    expect(messages).toEqual([]);
  });

  it('页面块未覆盖 barrel-only 深层导入禁令', async () => {
    const messages = await lintBoundaryRules('components/__probe.tsx', "import { getKey } from '@/lib/storage/provider-keys-store';");
    expect(messages.some((m) => m.startsWith('no-restricted-imports:') && m.includes('barrel'))).toBe(true);
    const dynamic = await lintBoundaryRules('components/__probe.tsx', "const m = await import('@/lib/storage/keys');");
    expect(dynamic.some((m) => m.startsWith('no-restricted-syntax:') && m.includes('barrel'))).toBe(true);
  });
});
