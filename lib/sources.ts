// 统一快切源视图层（v2）。
//
// 把「已配置的 AI provider」与「全部常规搜索引擎」投影成同构的 SearchSource，
// 供单一栏组件（SourceSwitcher）在 Juso 搜索页与 SERP 注入栏两处统一消费。
// id 空间不冲突：provider 用 tavily/exa/stepfun/stepfun-plan，engine 用 google/bing/baidu。

import type { ProviderId } from './providers/types';
import { allProviders } from './providers/registry';
import type { EngineId } from './engines/types';
import { allEngines } from './engines/registry';
import type { SiteEngineDefinition, SiteEngineId } from './site-engines';
import { isSiteEngineId } from './site-engines';
import type { CustomEngineDefinition, CustomEngineId } from './custom-engines';
import { isCustomEngineId } from './custom-engines';
import type { ProviderInstance, ProviderInstanceId } from './provider-instances';
import { isProviderInstanceId } from './provider-instances';

export type SourceKind = 'provider' | 'engine' | 'site-engine' | 'custom-engine' | 'provider-instance';
export type SourceId = ProviderId | EngineId | SiteEngineId | CustomEngineId | ProviderInstanceId;

/** A label which is either an i18n message key or a user-supplied literal. */
export type SourceLabel =
  | { kind: 'i18n'; key: string }
  | { kind: 'literal'; value: string };

export interface SearchSource {
  id: SourceId;
  kind: SourceKind;
  /** 显示标签的 i18n 消息名（渲染处用 t() 解析）。 */
  label: string;
  /** Use this representation in new rendering code so literal site names bypass i18n. */
  labelDescriptor?: SourceLabel;
  /** provider 是否支持 AI 答案（engine 恒为 false）。 */
  supportsAnswer: boolean;
  /** 来源品牌图标：扩展内相对路径（engine 与 provider 均提供），渲染处用 resolveIconUrl 解析。 */
  favicon?: string;
  /** Execution descriptor for a dynamic site-scoped engine. */
  siteEngine?: SiteEngineDefinition;
  /** Execution descriptor for a user-defined custom engine. */
  customEngine?: CustomEngineDefinition;
  /** Execution descriptor for a user-defined per-provider instance. */
  providerInstance?: ProviderInstance;
}

const ENGINE_IDS: ReadonlySet<string> = new Set(allEngines().map((e) => e.id));
const DEFAULT_SOURCE_ORDER: SourceId[] = [
  ...allProviders().map((provider) => provider.id),
  ...allEngines().map((engine) => engine.id),
];

/**
 * 当前已知的全部 source id（provider + engine + 给定 site-engine 定义 + 给定 custom-engine 定义
 * + 给定 provider-instance 定义），供 normalizeGroupConfig 等校验逻辑使用。单一定义点，避免各调用方
 * 各自硬编码 engine 列表导致漂移。
 */
export function allKnownSourceIds(
  siteDefinitions: readonly SiteEngineDefinition[] = [],
  customDefinitions: readonly CustomEngineDefinition[] = [],
  providerInstances: readonly ProviderInstance[] = [],
): SourceId[] {
  return [
    ...allProviders().map((provider) => provider.id),
    ...allEngines().map((engine) => engine.id),
    ...siteDefinitions.map((definition) => definition.id),
    ...customDefinitions.map((definition) => definition.id),
    ...providerInstances.map((instance) => instance.id),
  ];
}

/** Resolves a source label without sending literal user data through i18n. */
export function sourceLabel(
  source: Pick<SearchSource, 'label' | 'labelDescriptor'>,
  translate: (key: string) => string = (key) => key,
): string {
  return source.labelDescriptor?.kind === 'literal' ? source.labelDescriptor.value : translate(source.label);
}

export function isEngineId(id: string): id is EngineId {
  return ENGINE_IDS.has(id);
}

export function isProviderId(id: string): id is ProviderId {
  return allProviders().some((p) => p.id === id);
}

/**
 * 规范化用户保存的完整来源顺序：保留已知 id 的首次出现，遗漏项按默认 registry 顺序补尾。
 */
export function normalizeSourceOrder(
  order: unknown,
  siteDefinitions: readonly SiteEngineDefinition[] = [],
  customDefinitions: readonly CustomEngineDefinition[] = [],
  providerInstances: readonly ProviderInstance[] = [],
): SourceId[] {
  const siteIds = new Set(siteDefinitions.map((site) => site.id));
  const customIds = new Set(customDefinitions.map((c) => c.id));
  const instanceIds = new Set(providerInstances.map((instance) => instance.id));
  const seen = new Set<SourceId>();
  const normalized: SourceId[] = [];
  const sourceOrder = Array.isArray(order) ? order : [];
  for (const id of sourceOrder) {
    if (typeof id !== 'string' || (!isProviderId(id) && !isEngineId(id) && !(isSiteEngineId(id) && siteIds.has(id)) && !(isCustomEngineId(id) && customIds.has(id)) && !(isProviderInstanceId(id) && instanceIds.has(id))) || seen.has(id as SourceId)) continue;
    seen.add(id as SourceId);
    normalized.push(id as SourceId);
  }
  for (const id of DEFAULT_SOURCE_ORDER) {
    if (!seen.has(id)) normalized.push(id);
  }
  for (const id of siteDefinitions.map((site) => site.id)) {
    if (!seen.has(id)) normalized.push(id);
  }
  for (const id of customDefinitions.map((c) => c.id)) {
    if (!seen.has(id)) normalized.push(id);
  }
  for (const id of providerInstances.map((instance) => instance.id)) {
    if (!seen.has(id)) normalized.push(id);
  }
  return normalized;
}

/** 规范化快切栏隐藏来源清单：仅保留已知 source id，去重并保留首次出现顺序。 */
export function normalizeSourceHidden(ids: unknown, siteDefinitions: readonly SiteEngineDefinition[] = [], customDefinitions: readonly CustomEngineDefinition[] = [], providerInstances: readonly ProviderInstance[] = []): SourceId[] {
  const siteIds = new Set(siteDefinitions.map((site) => site.id));
  const customIds = new Set(customDefinitions.map((c) => c.id));
  const instanceIds = new Set(providerInstances.map((instance) => instance.id));
  const list = Array.isArray(ids) ? ids : [];
  const seen = new Set<SourceId>();
  const normalized: SourceId[] = [];
  for (const id of list) {
    if (typeof id !== 'string' || (!isProviderId(id) && !isEngineId(id) && !(isSiteEngineId(id) && siteIds.has(id)) && !(isCustomEngineId(id) && customIds.has(id)) && !(isProviderInstanceId(id) && instanceIds.has(id))) || seen.has(id as SourceId)) continue;
    seen.add(id as SourceId);
    normalized.push(id as SourceId);
  }
  return normalized;
}

/** A dynamic Site Engine ID is known only when there is a saved definition for it. */
export function isKnownSiteEngineId(id: string, siteDefinitions: readonly SiteEngineDefinition[]): id is SiteEngineId {
  return isSiteEngineId(id) && new Set(siteDefinitions.map((site) => site.id)).has(id);
}

/** A dynamic Custom Engine ID is known only when there is a saved definition for it. */
export function isKnownCustomEngineId(id: string, customDefinitions: readonly CustomEngineDefinition[]): id is CustomEngineId {
  return isCustomEngineId(id) && new Set(customDefinitions.map((c) => c.id)).has(id);
}

/**
 * 投影出统一快切栏的候选源：按用户顺序排序的已配置 AI provider + 全部常规 engine。
 * provider 按 configuredProviderIds 过滤（沿用 v1「隐藏未配置 provider」）；engine 恒全显示。
 * `hiddenSourceIds` 中列出的 source（provider 或 engine）会被进一步从投影中剔除，
 * 仅作用于快切栏本身——设置页管理列表不应传入此参数，以便用户对隐藏项进行管理。
 *
 * 实例投影（镜像 site-engine/custom-engine 分支）：有实例的 provider 不再投影裸 provider pill，
 * 而是每个实例投影一个 pill（共享 base adapter 的 favicon/supportsAnswer，label 用实例名字面量）；
 * 同 base provider 的实例在投影中相邻（组内按 sourceOrder 相对位置排列）。
 */
export function allSources(
  configuredProviderIds: ProviderId[],
  sourceOrder?: readonly SourceId[],
  hiddenSourceIds?: readonly SourceId[],
  siteDefinitions: readonly SiteEngineDefinition[] = [],
  customDefinitions: readonly CustomEngineDefinition[] = [],
  providerInstances: readonly ProviderInstance[] = [],
): SearchSource[] {
  const hidden = hiddenSourceIds && hiddenSourceIds.length > 0 ? new Set(hiddenSourceIds) : null;
  const providersById = new Map(allProviders().map((provider) => [provider.id, provider]));
  const enginesById = new Map(allEngines().map((engine) => [engine.id, engine]));
  const sitesById = new Map(siteDefinitions.map((site) => [site.id, site]));
  const customsById = new Map(customDefinitions.map((c) => [c.id, c]));
  // 实例按 base provider 分组；组内顺序 = 实例数组顺序（即创建/sourceOrder 补尾顺序）。
  const instancesByProvider = new Map<ProviderId, ProviderInstance[]>();
  for (const instance of providerInstances) {
    const list = instancesByProvider.get(instance.baseProviderId);
    if (list) list.push(instance);
    else instancesByProvider.set(instance.baseProviderId, [instance]);
  }
  const instancesById = new Map(providerInstances.map((instance) => [instance.id, instance]));
  const order = normalizeSourceOrder(sourceOrder, siteDefinitions, customDefinitions, providerInstances);
  // 排序启发式：同 base provider 的实例按其在 sourceOrder 中的相对位置排列，
  // 未出现在 sourceOrder 里的实例按存储顺序补尾——保证 flyout 内同 provider 实例相邻。
  const orderIndexOf = new Map(order.map((id, index) => [id, index]));
  const instanceOrderFor = (baseProviderId: ProviderId): ProviderInstance[] => {
    const list = instancesByProvider.get(baseProviderId) ?? [];
    return [...list].sort(
      (a, b) => (orderIndexOf.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (orderIndexOf.get(b.id) ?? Number.MAX_SAFE_INTEGER),
    );
  };
  // 已投影的实例组槽位（provider id + 其全部实例 id），防止同一实例被重复投影。
  const projected = new Set<SourceId>();
  const projectInstanceGroup = (baseProviderId: ProviderId, supportsAnswer: boolean, favicon: string | undefined): SearchSource[] => {
    const ordered = instanceOrderFor(baseProviderId).filter(
      (instance) => !projected.has(instance.id) && !(hidden && hidden.has(instance.id)),
    );
    projected.add(baseProviderId);
    for (const instance of ordered) projected.add(instance.id);
    return ordered.map((instance) => ({
      id: instance.id,
      kind: 'provider-instance',
      label: instance.name,
      labelDescriptor: { kind: 'literal', value: instance.name },
      supportsAnswer,
      favicon,
      providerInstance: instance,
    }));
  };
  return order.flatMap((id): SearchSource[] => {
    if (hidden && hidden.has(id)) return [];
    if (projected.has(id)) return [];
    const provider = providersById.get(id as ProviderId);
    if (provider) {
      if (!configuredProviderIds.includes(provider.id)) return [];
      const instances = instancesByProvider.get(provider.id);
      if (instances && instances.length > 0) {
        // 有实例的 provider：投影实例 pill（每个实例一个），不投影裸 provider pill。
        return projectInstanceGroup(provider.id, provider.supportsAnswer, provider.favicon);
      }
      projected.add(provider.id);
      return [{
        id: provider.id,
        kind: 'provider',
        label: provider.label,
        labelDescriptor: { kind: 'i18n', key: provider.label },
        supportsAnswer: provider.supportsAnswer,
        favicon: provider.favicon,
      }];
    }
    const engine = enginesById.get(id as EngineId);
    if (engine) return [{
      id: engine.id, kind: 'engine', label: engine.label,
      labelDescriptor: { kind: 'i18n', key: engine.label }, supportsAnswer: false, favicon: engine.favicon,
    }];
    const site = sitesById.get(id as SiteEngineId);
    if (site) return [{
      id: site.id, kind: 'site-engine', label: site.name,
      labelDescriptor: { kind: 'literal', value: site.name }, supportsAnswer: false, favicon: '/icons/site.svg',
      siteEngine: site,
    }];
    const custom = customsById.get(id as CustomEngineId);
    if (custom) return [{
      id: custom.id, kind: 'custom-engine', label: custom.name,
      labelDescriptor: { kind: 'literal', value: custom.name }, supportsAnswer: false, favicon: '/icons/custom-engine.svg',
      customEngine: custom,
    }];
    // 实例 id 作为 sourceOrder 槽位：投影整个 base provider 的实例组，保证同 provider 实例相邻；
    // 已随其 provider 槽位投影过的实例在此跳过（projected 去重）。
    const instance = instancesById.get(id as ProviderInstanceId);
    if (instance && configuredProviderIds.includes(instance.baseProviderId) && !(hidden && hidden.has(instance.baseProviderId))) {
      const adapter = providersById.get(instance.baseProviderId);
      const instances = instancesByProvider.get(instance.baseProviderId);
      if (adapter && instances && instances.length > 0) {
        return projectInstanceGroup(instance.baseProviderId, adapter.supportsAnswer, adapter.favicon);
      }
    }
    return [];
  });
}

/**
 * 解析「有效激活 source」的纯函数：storage 的 getActiveSourceId / getProviderConfigSnapshot 与
 * config-io 的导出/导入预览共用（单一定义点，避免两处拷贝漂移）。
 * 优先级：storedSource（engine → site → custom → 实例 → 裸 provider）→ 首个已配置 provider。
 * 有实例的 provider 返回首个实例 id——与 allSources 的实例投影一致（有实例时不再投影裸 provider pill，
 * 激活源若是裸 provider id，快切栏将找不到高亮目标，回退到错误的首个可见源）。无已配置 provider 时
 * 返回 undefined，由调用方回退到默认 engine（google）。
 */
export function resolveEffectiveActiveSource(
  storedSource: SourceId | null | undefined,
  keys: Record<string, string>,
  siteDefinitions: readonly SiteEngineDefinition[],
  customDefinitions: readonly CustomEngineDefinition[],
  instances: readonly ProviderInstance[],
): SourceId | undefined {
  if (storedSource) {
    if (isEngineId(storedSource)) return storedSource;
    if (isKnownSiteEngineId(storedSource, siteDefinitions)) return storedSource;
    if (isKnownCustomEngineId(storedSource, customDefinitions)) return storedSource;
    if (isProviderInstanceId(storedSource) && instances.some((instance) => instance.id === storedSource && keys[instance.baseProviderId])) return storedSource;
    if (isProviderId(storedSource) && keys[storedSource]) {
      const firstInstance = instances.find((instance) => instance.baseProviderId === storedSource);
      return firstInstance ? firstInstance.id : storedSource;
    }
  }
  const firstConfigured = allProviders().find((provider) => keys[provider.id]);
  if (firstConfigured) {
    const firstInstance = instances.find((instance) => instance.baseProviderId === firstConfigured.id);
    return firstInstance ? firstInstance.id : firstConfigured.id;
  }
  return undefined;
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
