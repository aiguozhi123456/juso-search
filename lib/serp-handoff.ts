// SERP 快切栏 chip 选中后的跳转意图解析（纯函数，无浏览器副作用）。
//
// 抽离自 entrypoints/serp-bar.content.ts 的 onSelect，便于单测：
//   - engine   → 返回要 location.assign 的 https SERP/首页 URL（网页上下文可导航）；
//   - provider → 返回委托给 background 的 openSearchPage 深链（chrome-extension:// 由
//     worker 在特权上下文用 tabs.update 导航，避免 ERR_BLOCKED_BY_CLIENT）。
//   - 其余 → null（不跳转）。
//
// 调用方（内容脚本）按 kind 决定用 location.assign 还是 sendMessage('openSearchPage')。

import type { SearchSource } from './sources';
import type { SourceId } from './sources';
import { isEngineId, isProviderId } from './sources';
import { isProviderInstanceId } from './provider-instances';
import { isAggregateInstanceId } from './aggregate-instances';
import type { SearchEngine } from './engines/types';
import { getEngine } from './engines/registry';
import { buildSearchDeepLink } from './deep-link';
import type { SiteInstanceDefinition, SiteInstanceId } from './site-instances';
import { buildSiteInstanceUrl, matchSiteInstanceFromUrl } from './site-instances';
import type { CustomEngineDefinition } from './custom-engines';
import { buildCustomEngineUrl } from './custom-engines';
import { getAiEngine, isRegisteredAiEngineId } from './ai-engines/registry';

export type SerpHandoff =
  | { kind: 'navigate'; url: string } // engine：当前 tab location.assign 到 https URL
  | { kind: 'openSearchPage'; deepLink: string }; // provider：委托 background 导航扩展页

/** The source state represented by a currently displayed conventional-engine SERP. */
export interface SerpContext {
  /** Query for subsequent handoffs, with a recognized Site Instance scope removed. */
  baseQuery: string;
  /** The chip to activate: a visible matching Site Instance, or its backing engine. */
  activeId: SourceId;
  /** A matching Site Instance only when it remains visible in the switcher. */
  matchingSiteId: SiteInstanceId | null;
}

/**
 * Recovers Site Instance context from a SERP URL without depending on DOM or
 * storage. Recognition is mode-agnostic (KTD2): a zhannei `cc`, a bing `q1`
 * `site:` operand, or a raw `site:`-prefixed query all resolve to `(engineId,
 * scope)` and strip to the clean base query. A hidden matching Site Instance
 * still has its scope stripped so switching sources preserves the user's
 * original base query, but it cannot be selected as the active chip.
 */
export function resolveSerpContext(
  engine: SearchEngine,
  url: string,
  siteDefinitions: readonly SiteInstanceDefinition[],
  activeSourceId?: SourceId | null,
  sourceOrder?: readonly SourceId[],
  hiddenSourceIds?: readonly SourceId[],
): SerpContext {
  const rawQuery = engine.extractQuery(url) ?? '';
  const match = matchSiteInstanceFromUrl(engine, url, siteDefinitions, activeSourceId, sourceOrder);
  const matchingSiteId = match && !hiddenSourceIds?.includes(match.siteId) ? match.siteId : null;
  return {
    baseQuery: match?.baseQuery ?? rawQuery,
    activeId: matchingSiteId ?? engine.id,
    matchingSiteId,
  };
}

/**
 * Chooses the in-memory SERP bar query after a config snapshot.
 *
 * When a Site Instance still matches, always adopt the stripped base query.
 * When it no longer matches (deleted / hidden / edited) and the live SERP URL
 * still carries a raw `site:…` query, keep any non-empty stripped query already
 * held in bar state so subsequent handoffs are not polluted by the scope prefix.
 * (zhannei/q1 页的 raw query 本就干净，该兜底分支天然不受影响。)
 */
export function nextQueryAfterSerpContext(
  context: Pick<SerpContext, 'matchingSiteId' | 'baseQuery'>,
  rawQuery: string,
  currentQuery: string,
): string {
  if (context.matchingSiteId != null) return context.baseQuery;
  if (currentQuery !== '' && rawQuery.trimStart().startsWith('site:')) {
    return currentQuery;
  }
  return context.baseQuery;
}

/** 向 AI engine 导航 URL 追加 enter 参数（同 key 已存在则覆盖），返回新 URL。 */
function withEnterParam(baseUrl: string, value: string): string {
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('enter', value);
    return url.toString();
  } catch {
    // URL 解析失败（理论上 buildUrl 不会产生）→ 原样返回，保证不破坏导航。
    return baseUrl;
  }
}

/** 解析 chip 选中后的跳转意图；不识别的源返回 null。
 *  opts.aiAutoEnter：AI engine 自动回车开关（默认 true）。注入型 AI engine 仅在开关
 *  开启时追加 enter=1（url-only 型原生自动提交，无需 enter=1）。 */
export function resolveSerpHandoff(
  source: SearchSource,
  query: string,
  opts?: { aiAutoEnter?: boolean },
): SerpHandoff | null {
  const trimmed = query.trim();
  if (source.kind === 'custom-engine' && source.customEngine) {
    const url = trimmed ? buildCustomEngineUrl(source.customEngine.urlTemplate, trimmed) : null;
    if (!url) return null;
    return { kind: 'navigate', url };
  }
  if (source.kind === 'site-instance' && source.siteInstance) {
    const url = buildSiteInstanceUrl(source.siteInstance, trimmed);
    if (!url) return null;
    return { kind: 'navigate', url };
  }
  if (source.kind === 'engine' && isEngineId(source.id)) {
    const engine = getEngine(source.id);
    return { kind: 'navigate', url: trimmed ? engine.buildSerpUrl(trimmed) : engine.buildHomeUrl() };
  }
  if (source.kind === 'ai-engine' && isRegisteredAiEngineId(source.id)) {
    const aiEngine = getAiEngine(source.id);
    if (!trimmed) return { kind: 'navigate', url: aiEngine.buildHomeUrl() };
    // inject 型：aiAutoEnter 默认 true → 追加 enter=1（content script 据此自动提交）；
    // aiAutoEnter 关闭 → 仅原生预填（?q=），不自动回车。url-only 型原生自动提交，不追加。
    const wantsAutoEnter = aiEngine.execution.kind === 'inject' && opts?.aiAutoEnter !== false;
    const baseUrl = aiEngine.buildUrl(trimmed);
    const url = wantsAutoEnter
      ? withEnterParam(baseUrl, '1')
      : baseUrl;
    return { kind: 'navigate', url };
  }
  if (source.kind === 'aggregate-instance' && isAggregateInstanceId(source.id)) {
    // 聚合实例（KTD16）：与 provider 实例同语义——委托 background 打开搜索页深链
    // （搜索页按实例定义存在 && eligible 受理，KTD16 fresh-config 重解析由页面负责）。
    return {
      kind: 'openSearchPage',
      deepLink: trimmed ? buildSearchDeepLink(source.id, trimmed) : '/search.html',
    };
  }
  if (source.kind === 'provider-instance' && isProviderInstanceId(source.id)) {
    // 实例与裸 provider 同语义：委托 background 打开搜索页深链，deep link 携带实例 id
    // （搜索页按 base provider 做 configured 检查并透传给 worker 解析，KTD2/R8）。
    return {
      kind: 'openSearchPage',
      deepLink: trimmed ? buildSearchDeepLink(source.id, trimmed) : '/search.html',
    };
  }
  if (isProviderId(source.id)) {
    return {
      kind: 'openSearchPage',
      deepLink: trimmed ? buildSearchDeepLink(source.id, trimmed) : '/search.html',
    };
  }
  return null;
}

/** Resolves a Site Instance handoff from a freshly read definition. */
export function resolveCurrentSiteInstanceHandoff(
  siteId: SourceId,
  query: string,
  siteDefinitions: readonly SiteInstanceDefinition[],
): SerpHandoff | null {
  const siteInstance = siteDefinitions.find((definition) => definition.id === siteId);
  if (!siteInstance) return null;
  return resolveSerpHandoff({
    id: siteInstance.id,
    kind: 'site-instance',
    label: siteInstance.name,
    supportsAnswer: false,
    siteInstance,
  }, query);
}

/** Resolves a Custom Engine handoff from a freshly read definition. */
export function resolveCurrentCustomEngineHandoff(
  customId: SourceId,
  query: string,
  customDefinitions: readonly CustomEngineDefinition[],
): SerpHandoff | null {
  const customEngine = customDefinitions.find((d) => d.id === customId);
  if (!customEngine) return null;
  return resolveSerpHandoff({
    id: customEngine.id,
    kind: 'custom-engine',
    label: customEngine.name,
    supportsAnswer: false,
    customEngine,
  }, query);
}

/**
 * Post-write navigation decision after setActiveSource for a Site Instance chip.
 *
 * - `postWriteSiteInstances === null` → post-write config read failed; keep the
 *   pre-write navigate URL (write already succeeded).
 * - post-write handoff is navigate → use the refreshed URL.
 * - otherwise (deleted/invalid) → unresolved; caller applies snapshot, no nav.
 */
export function decidePostWriteSiteInstanceNavigation(
  siteId: SourceId,
  query: string,
  postWriteSiteInstances: readonly SiteInstanceDefinition[] | null,
  preWriteNavigateUrl: string,
): { kind: 'navigate'; url: string } | { kind: 'unresolved' } {
  if (postWriteSiteInstances == null) {
    return { kind: 'navigate', url: preWriteNavigateUrl };
  }
  const handoff = resolveCurrentSiteInstanceHandoff(siteId, query, postWriteSiteInstances);
  if (handoff?.kind === 'navigate') return handoff;
  return { kind: 'unresolved' };
}
