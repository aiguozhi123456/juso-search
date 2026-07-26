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
import { getEngine } from './engines/registry';
import { buildSearchDeepLink } from './deep-link';
import type { EngineId } from './engines/types';
import type { SiteEngineDefinition, SiteEngineId } from './site-engines';
import { buildSiteEngineQuery, isSiteEngineEngineId, matchSiteEngineQuery } from './site-engines';

export type SerpHandoff =
  | { kind: 'navigate'; url: string } // engine：当前 tab location.assign 到 https URL
  | { kind: 'openSearchPage'; deepLink: string }; // provider：委托 background 导航扩展页

/** The source state represented by a currently displayed conventional-engine SERP. */
export interface SerpContext {
  /** Query for subsequent handoffs, with a recognized Site Engine scope removed. */
  baseQuery: string;
  /** The chip to activate: a visible matching Site Engine, or its backing engine. */
  activeId: SourceId;
  /** A matching Site Engine only when it remains visible in the switcher. */
  matchingSiteId: SiteEngineId | null;
}

/**
 * Recovers Site Engine context from a SERP query without depending on DOM or
 * storage. A hidden matching Site Engine still has its generated scope stripped
 * so switching sources preserves the user's original base query, but it cannot
 * be selected as the active chip.
 */
export function resolveSerpContext(
  backingEngineId: EngineId,
  rawQuery: string,
  siteDefinitions: readonly SiteEngineDefinition[],
  activeSourceId?: SourceId | null,
  sourceOrder?: readonly SourceId[],
  hiddenSourceIds?: readonly SourceId[],
): SerpContext {
  const match = isSiteEngineEngineId(backingEngineId)
    ? matchSiteEngineQuery(backingEngineId, rawQuery, siteDefinitions, activeSourceId, sourceOrder)
    : null;
  const matchingSiteId = match && !hiddenSourceIds?.includes(match.siteId) ? match.siteId : null;
  return {
    baseQuery: match?.baseQuery ?? rawQuery,
    activeId: matchingSiteId ?? backingEngineId,
    matchingSiteId,
  };
}

/**
 * Chooses the in-memory SERP bar query after a config snapshot.
 *
 * When a Site Engine still matches, always adopt the stripped base query.
 * When it no longer matches (deleted / hidden / edited) and the live SERP URL
 * still carries a raw `site:…` query, keep any non-empty stripped query already
 * held in bar state so subsequent handoffs are not polluted by the scope prefix.
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

/** 解析 chip 选中后的跳转意图；不识别的源返回 null。 */
export function resolveSerpHandoff(source: SearchSource, query: string): SerpHandoff | null {
  const trimmed = query.trim();
  if (source.kind === 'site-engine' && source.siteEngine) {
    const scopedQuery = buildSiteEngineQuery(source.siteEngine, trimmed);
    if (!scopedQuery) return null;
    const engine = getEngine(source.siteEngine.engineId);
    return { kind: 'navigate', url: engine.buildSerpUrl(scopedQuery) };
  }
  if (source.kind === 'engine' && isEngineId(source.id)) {
    const engine = getEngine(source.id);
    return { kind: 'navigate', url: trimmed ? engine.buildSerpUrl(trimmed) : engine.buildHomeUrl() };
  }
  if (isProviderId(source.id)) {
    return {
      kind: 'openSearchPage',
      deepLink: trimmed ? buildSearchDeepLink(source.id, trimmed) : '/search.html',
    };
  }
  return null;
}

/** Resolves a Site Engine handoff from a freshly read definition. */
export function resolveCurrentSiteEngineHandoff(
  siteId: SourceId,
  query: string,
  siteDefinitions: readonly SiteEngineDefinition[],
): SerpHandoff | null {
  const siteEngine = siteDefinitions.find((definition) => definition.id === siteId);
  if (!siteEngine) return null;
  return resolveSerpHandoff({
    id: siteEngine.id,
    kind: 'site-engine',
    label: siteEngine.name,
    supportsAnswer: false,
    siteEngine,
  }, query);
}

/**
 * Post-write navigation decision after setActiveSource for a Site Engine chip.
 *
 * - `postWriteSiteEngines === null` → post-write config read failed; keep the
 *   pre-write navigate URL (write already succeeded).
 * - post-write handoff is navigate → use the refreshed URL.
 * - otherwise (deleted/invalid) → unresolved; caller applies snapshot, no nav.
 */
export function decidePostWriteSiteEngineNavigation(
  siteId: SourceId,
  query: string,
  postWriteSiteEngines: readonly SiteEngineDefinition[] | null,
  preWriteNavigateUrl: string,
): { kind: 'navigate'; url: string } | { kind: 'unresolved' } {
  if (postWriteSiteEngines == null) {
    return { kind: 'navigate', url: preWriteNavigateUrl };
  }
  const handoff = resolveCurrentSiteEngineHandoff(siteId, query, postWriteSiteEngines);
  if (handoff?.kind === 'navigate') return handoff;
  return { kind: 'unresolved' };
}
