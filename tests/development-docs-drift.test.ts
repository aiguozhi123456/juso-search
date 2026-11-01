import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allProviders } from '@/lib/providers/registry';
import type { ProviderId } from '@/lib/providers/types';

/**
 * DEVELOPMENT 双语文档 + 架构图 SVG 的内容层 drift-lock（README 同类锁见
 * readme-drift.test.ts，模式与维护契约一致）。
 *
 * 根因：DEVELOPMENT.md / 架构图 SVG 的能力清单编辑落后于代码——parallel /
 * deepseek / anysearch 三个 provider、聚合搜索、Firefox MV3、微信引擎落地时
 * 均未回写（2026-11-01 才补齐），且没有任何门禁能拦住下一次。此测试把「文档
 * 与图必须随能力集合演进」固化为门禁：下次加 provider / 引擎 / 脚本、改浏览器
 * 支持面忘改这两份文档或两张图时，`npm test` 直接失败。
 *
 * 维护契约：断言的是「必须随能力集合演进」，不是「必须怎么写」。正当的文案
 * 重写不应触发失败；只有能力变化未回写时才应失败。断言一律锚定到清单所在行
 * （provider 断言锚定 lib/providers 行 / Tavily 行），避免同名词（对话引擎
 * DeepSeek、豆包）造成的假阴性。
 */
const devZh = readFileSync(resolve(process.cwd(), 'docs/DEVELOPMENT.md'), 'utf8');
const devEn = readFileSync(resolve(process.cwd(), 'docs/DEVELOPMENT.en.md'), 'utf8');
const svgZh = readFileSync(resolve(process.cwd(), 'docs/assets/architecture.svg'), 'utf8');
const svgEn = readFileSync(resolve(process.cwd(), 'docs/assets/architecture-en.svg'), 'utf8');

/** provider id → DEVELOPMENT 双语 md 中的品牌词（中英 md 同用英文品牌词；
 *  doubao 与 doubao-global 共用 Doubao，stepfun-plan 用 "Step Plan" 区分）。 */
const MD_TOKEN: Record<ProviderId, string> = {
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

/** provider id → 架构图 SVG 中的品牌词。zh 图用「豆包」；stepfun-plan 在图中
 *  由 Stepfun 一词覆盖两个 surface，无独立词形。 */
const SVG_ZH_TOKEN: Record<ProviderId, string> = { ...MD_TOKEN, doubao: '豆包', 'doubao-global': '豆包', 'stepfun-plan': 'Stepfun' };
const SVG_EN_TOKEN: Record<ProviderId, string> = { ...MD_TOKEN, 'stepfun-plan': 'Stepfun' };

/** 取清单锚点命中的所有行并合并——provider 断言只在这些行内做，
 *  防止同名能力（AI 对话引擎 DeepSeek/豆包）造成假阴性。 */
function anchoredLines(text: string, anchor: RegExp, label: string): string {
  const lines = text.split('\n').filter((row) => anchor.test(row));
  if (lines.length === 0) throw new Error(`drift-lock anchor not found: ${label}`);
  return lines.join('\n');
}

describe('DEVELOPMENT docs + architecture SVG content drift-lock', () => {
  const mdProviders = anchoredLines(devZh, /`lib\/providers\/`/, 'DEVELOPMENT.md providers line')
    + '\n' + anchoredLines(devEn, /`lib\/providers\/`/, 'DEVELOPMENT.en.md providers line');

  it.each(allProviders().map((p) => p.id))('lists provider %s in both DEVELOPMENT docs and both architecture SVGs', (id) => {
    expect(mdProviders).toContain(MD_TOKEN[id]);
    // SVG 用全文断言：provider 清单在图中拆成两行，行级锚点（如 Tavily）会漏掉
    // 第二行。新增方向的锁只需全文包含即可；对话引擎同名词（DeepSeek/豆包）仅
    // 削弱「从代码移除」方向的检测，可接受。
    expect(svgZh).toContain(SVG_ZH_TOKEN[id]);
    expect(svgEn).toContain(SVG_EN_TOKEN[id]);
  });

  it('documents aggregate search in both DEVELOPMENT docs', () => {
    expect(devZh).toContain('lib/aggregate/');
    expect(devZh).toContain('聚合搜索');
    expect(devEn).toContain('lib/aggregate/');
    expect(devEn).toMatch(/aggregate search/i);
  });

  it('documents Firefox MV3 support in both DEVELOPMENT docs and both SVG titles', () => {
    for (const doc of [devZh, devEn]) {
      expect(doc).toContain('build:firefox');
      expect(doc).toContain('Firefox MV3');
    }
    expect(svgZh).toContain('FIREFOX MV3');
    expect(svgEn).toContain('FIREFOX MV3');
  });

  it('keeps the development-commands block in sync with package.json named scripts', () => {
    // 每个命名脚本（非 test 裸名——子串噪声）都必须在两份文档的开发命令中出现。
    for (const script of ['build:dev', 'build:firefox', 'typecheck', 'test:python', 'test:mcp', 'gen-skills']) {
      expect(devZh).toContain(script);
      expect(devEn).toContain(script);
    }
  });

  it('lists all four user-defined source types in the options line of both docs', () => {
    for (const token of ['Site Instance', 'Aggregate Instance', 'Custom Engine', 'Provider Instance']) {
      expect(devZh).toContain(token);
      expect(devEn).toContain(token);
    }
  });

  it('keeps the SVG engine lists in sync with the ninth engine (weixin)', () => {
    // 锚定 DuckDuckGo 所在行（两处引擎清单），微信引擎加入时必须同步。
    const engineLines = anchoredLines(svgZh, /DuckDuckGo/, 'architecture.svg engine lines')
      + '\n' + anchoredLines(svgEn, /DuckDuckGo/, 'architecture-en.svg engine lines');
    expect(engineLines).toContain('搜狗公众号');
    expect(engineLines).toContain('WeChat Articles');
  });
});
