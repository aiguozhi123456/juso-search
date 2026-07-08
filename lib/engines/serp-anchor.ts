// SERP 注入锚点选择器（v2 快切栏用）。
//
// 从 content script 中抽出为纯函数：内容脚本的顶层会触发 WXT 自动导入
// （defineContentScript/createShadowRootUi），不便直接单测；本模块只描述
// 「某 engine 的结果容器主选择器」，可在 jsdom 下直接断言。
//
// 选择器候选与 dogfood 维护说明见
// docs/solutions/architecture-patterns/serp-switch-bar-and-unified-source-model.md
// （「SERP DOM anchors are fragile」一节）：Google/Bing 结果容器选择器随改版漂移，
// 真机复核后再改此处即可。

import type { EngineId, SearchEngine } from './types';

/** 各 engine SERP 结果容器主选择器（按 EngineId 索引）。 */
const SERP_ANCHORS: Record<EngineId, string> = {
  google: '#search',
  bing: '#b_results',
};

/**
 * 返回某 engine SERP 结果容器的主 CSS 选择器。
 *
 * 不做 DOM 查询、不回退 `body`：调用方（WXT `autoMount`）用 MutationObserver
 * 等到该选择器命中再挂载。回退 body 会把 shadow host 插到 `<body>` 之外、不占布局，
 * 造成栏「完全看不见」（回归「Bing 有时注入不生效」的根因之一）。
 *
 *   google → '#search'（结果主区，稳定且独一）
 *   bing  → '#b_results'（结果主区）
 *   null / 未知 engine → '#search'（安全兜底；content script 的 matches 已保证
 *     SERP 页必有 engine，此处兜底仅为类型完备）。
 */
export function pickAnchorSelector(engine: SearchEngine | null): string {
  if (!engine) return SERP_ANCHORS.google;
  return SERP_ANCHORS[engine.id] ?? SERP_ANCHORS.google;
}
