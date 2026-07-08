// 统一快切源视图层（v2）。
//
// 把「已配置的 AI provider」与「全部常规搜索引擎」投影成同构的 SearchSource，
// 供单一栏组件（SourceSwitcher）在 Juso 搜索页与 SERP 注入栏两处统一消费。
// id 空间不冲突：provider 用 tavily/exa/stepfun/stepfun-plan，engine 用 google/bing。

import type { ProviderId } from './providers/types';
import { allProviders } from './providers/registry';
import type { EngineId } from './engines/types';
import { allEngines } from './engines/registry';

export type SourceKind = 'provider' | 'engine';
export type SourceId = ProviderId | EngineId;

export interface SearchSource {
  id: SourceId;
  kind: SourceKind;
  /** 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  label: string;
  /** provider 是否支持 AI 答案（engine 恒为 false）。 */
  supportsAnswer: boolean;
  /** engine 的 favicon 扩展内相对路径（provider 为 undefined）。 */
  favicon?: string;
}

const ENGINE_IDS: ReadonlySet<string> = new Set(allEngines().map((e) => e.id));

export function isEngineId(id: string): id is EngineId {
  return ENGINE_IDS.has(id);
}

export function isProviderId(id: string): id is ProviderId {
  return allProviders().some((p) => p.id === id);
}

/**
 * 投影出统一快切栏的候选源：已配置的 AI provider（按 registry 序）+ 全部常规 engine。
 * provider 按 configuredProviderIds 过滤（沿用 v1「隐藏未配置 provider」）；engine 恒全显示。
 */
export function allSources(configuredProviderIds: ProviderId[]): SearchSource[] {
  const providerSources: SearchSource[] = allProviders()
    .filter((p) => configuredProviderIds.includes(p.id))
    .map((p) => ({
      id: p.id,
      kind: 'provider' as const,
      label: p.label,
      supportsAnswer: p.supportsAnswer,
    }));
  const engineSources: SearchSource[] = allEngines().map((e) => ({
    id: e.id,
    kind: 'engine' as const,
    label: e.label,
    supportsAnswer: false,
    favicon: e.favicon,
  }));
  return [...providerSources, ...engineSources];
}

/** 解析 engine favicon 为扩展可访问 URL（测试/非扩展上下文回退原路径）。 */
export function resolveIconUrl(path: string): string {
  try {
    if (typeof browser !== 'undefined' && browser?.runtime?.getURL) {
      // getURL 类型签名收窄为 PublicPath；运行期接受任意扩展内相对路径。
      return (browser.runtime.getURL as (p: string) => string)(path);
    }
  } catch {
    // 非扩展上下文（单测）：原样返回，供断言。
  }
  return path;
}
