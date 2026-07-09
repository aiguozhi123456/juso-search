// SERP 注入锚点策略（v2 快切栏用）。
//
// 从 content script 中抽出为纯数据/纯函数：内容脚本的顶层会触发 WXT 自动导入
// （defineContentScript/createShadowRootUi），不便直接单测；本模块只描述
// 「某 engine 的持久锚点选择器 + 插入位置」，可在 jsdom 下直接断言。
//
// ## 为什么锚「居中内容列内部」而非 header 的兄弟
// 最初（2484a79）锚 `#b_header`/`#appbar` 的兄弟（append:'after'）→ host 成为 `<body>` 直接
// 子级，全宽铺满，而 Bing/Google 的 header/搜索框/结果是**居中的定宽列**（`#b_header`:
// `width:1243px; margin:0 auto`），host 左边 x=0、搜索框左边 x≈338px（1920px 屏）→ 左对不齐。
//
// 改锚**居中内容列本身**、作为其首子（append:'first'）：host 成为该列的子元素，**自动继承**
// 列的居中 box，与搜索框左边天然对齐，零 CSS 硬编码、跨断点自动正确。
//
// ## 持久性（回归「Bing 注入失效」的保障）
// `#b_content`（Bing）/`#cnt`（Google）是 SPA 导航的**外壳**：首屏 SSR 即存在、SPA 导航只
// 重建其内部（Bing 的 `<main>`/`#b_results`、Google 的 `#rcnt`/`#rso`），外壳本身不换。
// host 挂外壳首子，SPA 导航不会带走它。证据：
//  - Bing：`infokiller/web-search-navigator` 观察 `#rcnt` 子树（证明 #rcnt 持久、子树换）。
//  - Greasyfork SearchSwitcher 锚 `header` 一次性 appendChild 验证「持久锚点 + 一次性插入」可行。
//
// ## Bing 加载闪现（content script 需主动处理）
// Bing 的 BM（Behavioral Metrics）模块在加载时会对 `#b_content` 设 `visibility:hidden`
// （cookie-gated flight，触发 `CI.BM HV` 事件）。`visibility` 是继承的，作为 `#b_content`
// 首子的 host 会被一起隐藏。`visibility:hidden` 可继承但**可覆盖**（不像 `display:none`），
// 故 content script 在 onMount 里设 `shadowHost.style.visibility='visible'` 即可，不影响布局。
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

/** 各 engine 的居中内容列锚点策略（按 EngineId 索引）。
 *  - Bing  → #b_content（居中结果区外壳，SSR 即在、SPA 只重建其 <main>/#b_results），append:'first' → host 作为列首子，落在 <main> 之上、#b_tween/#b_results 之上，且自动继承列的居中对齐。
 *  - Google → #cnt（居中内容区外壳，SSR 即在、SPA 只重建其 #rcnt/#rso），append:'first' → host 作为列首子，落在 #before-appbar/#appbar/结果 之上，自动继承列对齐。
 *
 *  注：append:'first' 让 host 成为列的子元素而非兄弟，是「左对齐 search box」的关键——
 *  兄弟式（append:'after' 在 #b_header/#appbar 上）会让 host 落到 <body> 全宽坐标系，全宽铺满。 */
const SERP_ANCHORS: Record<EngineId, AnchorStrategy> = {
  google: { selector: '#cnt', append: 'first' },
  bing: { selector: '#b_content', append: 'first' },
};

/**
 * 返回某 engine 的居中内容列锚点策略。
 *
 *   google → { #cnt, first }
 *   bing  → { #b_content, first }
 *   null / 未知 engine → google 策略（安全兜底；content script 的 matches 已保证
 *     SERP 页必有 engine，此处兜底仅为类型完备）。
 */
export function pickAnchorStrategy(engine: SearchEngine | null): AnchorStrategy {
  if (!engine) return SERP_ANCHORS.google;
  return SERP_ANCHORS[engine.id] ?? SERP_ANCHORS.google;
}
