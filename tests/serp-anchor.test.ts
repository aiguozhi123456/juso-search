// SERP 注入锚点策略（pickAnchorStrategy）—— v2 快切栏锚点逻辑。
//
// 回归「Bing 有时注入不生效」的根因：原锚 #b_results / #search 是 SPA 导航时被
// 重建的节点，host 挂其兄弟必被带走；且 autoMount 的 ping-pong 在合并式 swap 上死锁。
// Bing 现锚 #b_content 前（append:'before'）并运行时同步 #b_content content box，
// 避开 #b_content 内部的 inline/负 margin 结果层偷点击；Google 回到本轮会话前
// 的 #appbar + after（用户确认 #cnt + first 仍左偏）。
// 选择器与 append 模式的正确性在此钉死。

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

  it('keeps google on the pre-session appbar anchor', () => {
    expect(pickAnchorStrategy(google)).toEqual({ selector: '#appbar', append: 'after' });
  });

  it('falls back to the google strategy when engine is null', () => {
    expect(pickAnchorStrategy(null)).toEqual({ selector: '#appbar', append: 'after' });
  });
});

describe('pickAnchorStrategy — regression: never anchor SPA-swapped containers', () => {
  // 回归：#b_results / #search / #rso 是 SPA 导航时被重建的节点，挂它们或其兄弟
  // 会在 Bing/Google 重建结果列时把 host 一起 detach。这里钉死：任何 engine 的
  // 策略都不应返回这些易变选择器，也不应回退 body。
  const swappedSelectors = ['#b_results', '#search', '#rso', 'body'];

  for (const engine of [google, bing]) {
    it(`${engine.id} strategy avoids SPA-swapped selectors`, () => {
      const { selector } = pickAnchorStrategy(engine);
      expect(swappedSelectors).not.toContain(selector);
    });
  }
});
