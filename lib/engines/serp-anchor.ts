// SERP 注入锚点策略（v2 快切栏用）。
//
// 从 content script 中抽出为纯数据/纯函数：内容脚本的顶层会触发 WXT 自动导入
// （defineContentScript/createShadowRootUi），不便直接单测；本模块只描述
// 「某 engine 的持久锚点选择器 + 插入位置」，可在 jsdom 下直接断言。
//
// ## 为什么锚「持久容器」而非「结果容器」
// `#b_results`（Bing）/`#search`、`#rso`（Google）是 SPA 导航时被换掉/重建的节点。
// 把 shadow host 挂到它或它的兄弟，会在 Bing/Google 重建结果列时被一起 detach，
// 导致栏消失（回归「Bing 有时注入不生效」）。
//
// 改锚**页面级持久元素**——搜索框所在的 header、或结果区的稳定外壳——
// 它们首屏 SSR 即存在、SPA 导航不重建，host 一旦挂上就不会被带走。
//
// 证据：
//  - Greasyfork「移动端聚合搜索引擎导航 SearchSwitcher」Bing 分支即锚
//    `document.getElementsByTagName("header")[0]`（= #b_header）appendChild，
//    一次性插入、无 MutationObserver、无重挂逻辑——验证「持久锚点 + 一次性插入」
//    是此场景的正解。
//  - WXT autoMount 的 ping-pong 在 SPA 合并式 swap 上死锁（isNotExist 永不触发），
//    且 host 挂到被换元素的兄弟必被带走——见 docs/solutions runtime-errors 待补条目。
//
// dogfood 维护说明：Google/Bing 改版可能改这些 ID；真机复核后再改此处即可。

import type { EngineId, SearchEngine } from './types';

/** WXT append 模式的本地镜像（与 wxt 的 ContentScriptAppendMode 字面量一致，避免在纯数据模块里 import wxt 类型）。 */
export type AppendMode = 'last' | 'first' | 'replace' | 'before' | 'after';

export interface AnchorStrategy {
  /** 持久锚点的 CSS 选择器。 */
  selector: string;
  /** 相对锚点的插入位置。 */
  append: AppendMode;
}

/** 各 engine 的持久锚点策略（按 EngineId 索引）。
 *  - Bing  → #b_header（搜索框 + scopebar 所在 header，SSR 即在、SPA 不重建），append:'after' → 栏落在 header 与 #b_content 之间。
 *  - Google → #appbar（结果区上方稳定外壳，SSR 即在、SPA 不重建），append:'after' → 栏落在 appbar 与 #cnt 之间。 */
const SERP_ANCHORS: Record<EngineId, AnchorStrategy> = {
  google: { selector: '#appbar', append: 'after' },
  bing: { selector: '#b_header', append: 'after' },
};

/**
 * 返回某 engine 的持久锚点策略。
 *
 *   google → { #appbar, after }
 *   bing  → { #b_header, after }
 *   null / 未知 engine → google 策略（安全兜底；content script 的 matches 已保证
 *     SERP 页必有 engine，此处兜底仅为类型完备）。
 */
export function pickAnchorStrategy(engine: SearchEngine | null): AnchorStrategy {
  if (!engine) return SERP_ANCHORS.google;
  return SERP_ANCHORS[engine.id] ?? SERP_ANCHORS.google;
}
