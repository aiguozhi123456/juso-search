// SERP 注入锚点策略（pickAnchorStrategy）—— v2 快切栏锚点逻辑。
//
// Bing 注入失效的根因：Bing 的 #b_results 被 SPA 激进重建，host 挂其兄弟会被带走；
// 且 autoMount 的 ping-pong 在合并式 swap 上死锁。注意 Google 的 #search 与 Bing 的
// #b_results 行为不同——#search 元素身份在 SPA 导航时保持（只更新内部 #rso 子树），
// host 作前置兄弟能存活，故 Google 可用 #search + before（dogfood 验证）。
// 两套独立方案：Google #search + before（继承 #center_col 居中对齐）；
// Bing #b_content 前 + 运行时同步 content box（避开内部旧式 inline/负 margin 布局偷点击）。

import { describe, it, expect } from 'vitest';
import { pickAnchorStrategy } from '@/lib/engines/serp-anchor';
import type { SearchEngine } from '@/lib/engines/types';

const google: SearchEngine = {
  id: 'google',
  label: 'engine_google',
  favicon: '/icons/google.svg',
  serpUrlTemplate: 'https://www.google.com/search?q={q}',
  queryParam: 'q',
};
const bing: SearchEngine = {
  id: 'bing',
  label: 'engine_bing',
  favicon: '/icons/bing.svg',
  serpUrlTemplate: 'https://www.bing.com/search?q={q}',
  queryParam: 'q',
};

describe('pickAnchorStrategy', () => {
  it('mounts bing before #b_content and aligns to its content box', () => {
    expect(pickAnchorStrategy(bing)).toEqual({
      selector: '#b_content',
      append: 'before',
      alignTo: '#b_content',
    });
  });

  it('mounts google before #search (inherits centered column alignment)', () => {
    expect(pickAnchorStrategy(google)).toEqual({ selector: '#search', append: 'before' });
  });

  it('falls back to the google strategy when engine is null', () => {
    expect(pickAnchorStrategy(null)).toEqual({ selector: '#search', append: 'before' });
  });
});

describe('pickAnchorStrategy — regression: Bing avoids its rebuilt result node', () => {
  // 回归「Bing 注入失效」：Bing 的 #b_results 被 SPA 激进重建，host 挂其兄弟会被带走。
  // 注意：Google 的 #search 与此不同——其元素身份在 SPA 导航时保持（只更新内部 #rso），
  // 故 Google 用 #search + before 是安全的，不应列入禁用。此处只约束 Bing 避开 #b_results。
  it('bing never anchors the SPA-rebuilt #b_results', () => {
    expect(pickAnchorStrategy(bing).selector).not.toBe('#b_results');
  });

  it('no engine falls back to body (body-before renders outside <body>, invisible)', () => {
    for (const engine of [google, bing, null]) {
      expect(pickAnchorStrategy(engine).selector).not.toBe('body');
    }
  });
});
