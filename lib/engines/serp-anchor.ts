// SERP 注入锚点策略（v2 快切栏用）。
//
// 从 content script 中抽出为纯数据/纯函数：内容脚本的顶层会触发 WXT 自动导入
// （defineContentScript/createShadowRootUi），不便直接单测；本模块只描述
// 「某 engine 的持久锚点选择器 + 插入位置」，可在 jsdom 下直接断言。
//
// ## 为什么 Bing 锚在 `#b_content` 前、再同步它的 content box
// 2484a79 用 `#b_header + after` 可避开 SPA 结果重建，但 host 成为 `<body>` 直接子级、
// 全宽铺满；Bing 的 header/search box/results 是**居中的定宽列**（`#b_header`:
// `width:1243px; margin:0 auto`），host 左边 x=0、搜索框左边 x≈338px（1920px 屏）→ 左对不齐。
// e65ddf4 改成 `#b_content + first` 可继承列对齐，但进入了 Bing 的旧式结果布局：
// `main/aside` inline，`#b_tween` 有负 margin/relative，后续层会压到栏上导致 hit-test 偏移。
//
// 当前方案：host 插在 `#b_content` **之前**（不进入结果外壳内部，避开 overlay/inline 布局），
// 运行时按 `#b_content` 的 content box 同步 host 的 `margin-left/width`，得到与搜索框一致的
// 左对齐，又不被 Bing 结果内部层偷点击。
//
// ## 持久性（回归「Bing 注入失效」的保障）
// `#b_content`（Bing）是 SPA 导航的**外壳**：首屏 SSR 即存在，SPA 导航只重建其内部
// `<main>`/`#b_results`。host 作为它的前置兄弟，既不会被内部重建带走，也不继承
// Bing BM 对 `#b_content` 的 visibility 隐藏。
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
  /** 需要按某个元素的 content box 同步 host 宽度/左边距时使用。 */
  alignTo?: string;
}

/** 各 engine 的持久锚点策略（按 EngineId 索引）。
 *  - Bing  → 插在 #b_content 前（避开结果内部 overlay），并按 #b_content content box 同步尺寸。
 *  - Google → 回到本轮会话前的 #appbar + after（用户确认 #cnt + first 仍左偏）。 */
const SERP_ANCHORS: Record<EngineId, AnchorStrategy> = {
  google: { selector: '#appbar', append: 'after' },
  bing: { selector: '#b_content', append: 'before', alignTo: '#b_content' },
};

/**
 * 返回某 engine 的持久锚点策略。
 *
 *   google → { #appbar, after }
 *   bing  → { #b_content, before, alignTo: #b_content }
 *   null / 未知 engine → google 策略（安全兜底；content script 的 matches 已保证
 *     SERP 页必有 engine，此处兜底仅为类型完备）。
 */
export function pickAnchorStrategy(engine: SearchEngine | null): AnchorStrategy {
  if (!engine) return SERP_ANCHORS.google;
  return SERP_ANCHORS[engine.id] ?? SERP_ANCHORS.google;
}
