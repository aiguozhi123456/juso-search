// 统一快切源视图层（v2）。
//
// 把「已配置的 AI provider」与「全部常规搜索引擎」投影成同构的 SearchSource，
// 供单一栏组件（SourceSwitcher）在 Juso 搜索页与 SERP 注入栏两处统一消费。
// id 空间不冲突：provider 用 tavily/exa/stepfun/stepfun-plan，engine 用 google/bing/baidu。

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
const DEFAULT_SOURCE_ORDER: SourceId[] = [
  ...allProviders().map((provider) => provider.id),
  ...allEngines().map((engine) => engine.id),
];

export function isEngineId(id: string): id is EngineId {
  return ENGINE_IDS.has(id);
}

export function isProviderId(id: string): id is ProviderId {
  return allProviders().some((p) => p.id === id);
}

/**
 * 规范化用户保存的完整来源顺序：保留已知 id 的首次出现，遗漏项按默认 registry 顺序补尾。
 */
export function normalizeSourceOrder(order: unknown): SourceId[] {
  const seen = new Set<SourceId>();
  const normalized: SourceId[] = [];
  const sourceOrder = Array.isArray(order) ? order : [];
  for (const id of sourceOrder) {
    if (typeof id !== 'string' || (!isProviderId(id) && !isEngineId(id)) || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }
  for (const id of DEFAULT_SOURCE_ORDER) {
    if (!seen.has(id)) normalized.push(id);
  }
  return normalized;
}

/** 规范化快切栏隐藏来源清单：仅保留已知 source id，去重并保留首次出现顺序。 */
export function normalizeSourceHidden(ids: unknown): SourceId[] {
  const list = Array.isArray(ids) ? ids : [];
  const seen = new Set<SourceId>();
  const normalized: SourceId[] = [];
  for (const id of list) {
    if (typeof id !== 'string' || (!isProviderId(id) && !isEngineId(id)) || seen.has(id as SourceId)) continue;
    seen.add(id as SourceId);
    normalized.push(id as SourceId);
  }
  return normalized;
}

/**
 * 投影出统一快切栏的候选源：按用户顺序排序的已配置 AI provider + 全部常规 engine。
 * provider 按 configuredProviderIds 过滤（沿用 v1「隐藏未配置 provider」）；engine 恒全显示。
 * `hiddenSourceIds` 中列出的 source（provider 或 engine）会被进一步从投影中剔除，
 * 仅作用于快切栏本身——设置页管理列表不应传入此参数，以便用户对隐藏项进行管理。
 */
export function allSources(
  configuredProviderIds: ProviderId[],
  sourceOrder?: readonly SourceId[],
  hiddenSourceIds?: readonly SourceId[],
): SearchSource[] {
  const hidden = hiddenSourceIds && hiddenSourceIds.length > 0 ? new Set(hiddenSourceIds) : null;
  const providersById = new Map(allProviders().map((provider) => [provider.id, provider]));
  const enginesById = new Map(allEngines().map((engine) => [engine.id, engine]));
  return normalizeSourceOrder(sourceOrder).flatMap((id): SearchSource[] => {
    if (hidden && hidden.has(id)) return [];
    const provider = providersById.get(id as ProviderId);
    if (provider) {
      return configuredProviderIds.includes(provider.id) ? [{
        id: provider.id,
        kind: 'provider',
        label: provider.label,
        supportsAnswer: provider.supportsAnswer,
      }] : [];
    }
    const engine = enginesById.get(id as EngineId)!;
    return [{
      id: engine.id,
      kind: 'engine',
      label: engine.label,
      supportsAnswer: false,
      favicon: engine.favicon,
    }];
  });
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
