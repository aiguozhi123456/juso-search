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
import { isEngineId, isProviderId } from './sources';
import { getEngine } from './engines/registry';
import { buildSearchDeepLink } from './deep-link';

export type SerpHandoff =
  | { kind: 'navigate'; url: string } // engine：当前 tab location.assign 到 https URL
  | { kind: 'openSearchPage'; deepLink: string }; // provider：委托 background 导航扩展页

/** 解析 chip 选中后的跳转意图；不识别的源返回 null。 */
export function resolveSerpHandoff(source: SearchSource, query: string): SerpHandoff | null {
  const trimmed = query.trim();
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
