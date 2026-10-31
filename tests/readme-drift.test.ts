import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allProviders } from '@/lib/providers/registry';
import type { ProviderId } from '@/lib/providers/types';

/**
 * README 内容层 drift-lock。
 *
 * 根因：README 最后一次实质内容编辑是 2026-09-14（a4a3c93），之后 42 个 commit
 * 新增 parallel / deepseek / anysearch 三个 provider、免 key 免费层、聚合实例，
 * 无一回写 README——版本引用有 tiering 门禁（version-drift.test.ts + 规范文档
 * 自带 grep gate），内容层没有任何门禁。此测试把关键内容不变量固化为门禁：
 * 下次加 provider / action、改门控语义忘改 README 时，`npm test` 直接失败。
 *
 * 维护契约：断言的是「README 必须随能力集合演进」，不是「README 必须怎么写」。
 * 正当的文案重写不应触发失败；只有能力变化未回写时才应失败。
 */
const readmeZh = readFileSync(resolve(process.cwd(), 'README.md'), 'utf8');
const readmeEn = readFileSync(resolve(process.cwd(), 'README.en.md'), 'utf8');

/** provider id → README 中的品牌词（中英同形；doubao 与 doubao-global 共用 Doubao，
 *  stepfun-plan 用 "Step Plan" 与 stepfun 的 "Stepfun" 区分）。 */
const PROVIDER_BRAND_TOKEN: Record<ProviderId, string> = {
  tavily: 'Tavily',
  exa: 'Exa',
  brave: 'Brave',
  stepfun: 'Stepfun',
  'stepfun-plan': 'Step Plan',
  jina: 'Jina',
  doubao: 'Doubao',
  'doubao-global': 'Doubao',
  parallel: 'Parallel',
  deepseek: 'DeepSeek',
  anysearch: 'AnySearch',
};

/** 取 README 中「AI 搜索服务」能力 bullet——新增 provider 必须在这里出现。 */
function servicesBullet(text: string, marker: RegExp): string {
  const line = text.split('\n').find((row) => marker.test(row));
  if (!line) throw new Error(`README services bullet not found: ${marker}`);
  return line;
}

describe('README content drift-lock', () => {
  it.each(allProviders().map((p) => p.id))('lists provider %s in both READMEs', (id) => {
    const token = PROVIDER_BRAND_TOKEN[id];
    expect(servicesBullet(readmeZh, /^- AI 搜索服务：/)).toContain(token);
    expect(servicesBullet(readmeEn, /^- AI search services:/)).toContain(token);
  });

  it('documents the keyless free tier in both READMEs', () => {
    expect(readmeZh).toContain('免密钥');
    expect(readmeEn).toMatch(/keyless/i);
  });

  it('documents aggregate instances as a peer source-type bullet in both READMEs', () => {
    expect(readmeZh).toMatch(/^- 聚合实例（Aggregate Instance）/m);
    expect(readmeEn).toMatch(/^- Aggregate Instances:/m);
  });

  it('keeps the MCP env example copy-paste runnable (JUSO_BROWSER_PATH is required)', () => {
    expect(readmeZh).toContain('"JUSO_BROWSER_PATH"');
    expect(readmeEn).toContain('"JUSO_BROWSER_PATH"');
  });

  it('does not hardcode the engine count (engines grow; the list stays the visible set)', () => {
    expect(readmeZh).not.toMatch(/[0-9零一二三四五六七八九十]+个引擎/);
    expect(readmeEn).not.toMatch(/\b(eight|nine|ten|\d+) engines\b/i);
  });

  it('keeps the agent-bridge action count in sync with the bridge (10 today)', () => {
    expect(readmeZh).toContain('10 个 action');
    expect(readmeEn).toContain('10 actions');
  });
});
