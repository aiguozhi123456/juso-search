// SERP 注入锚点选择器（pickAnchorSelector）—— v2 快切栏锚点逻辑。
//
// 回归「Bing 有时注入不生效」：原 pickAnchor 在 document_idle 时同步查 DOM，
// #b_results 尚未挂载时回退 body，导致 shadow host 被插到 <body> 之外、不占布局、不可见。
// 现改为 autoMount + 选择器函数（不回退 body），选择器映射的正确性在此钉死。

import { describe, it, expect } from 'vitest';
import { pickAnchorSelector } from '@/lib/engines/serp-anchor';
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

describe('pickAnchorSelector', () => {
  it('returns the google result container selector', () => {
    expect(pickAnchorSelector(google)).toBe('#search');
  });

  it('returns the bing result container selector', () => {
    expect(pickAnchorSelector(bing)).toBe('#b_results');
  });

  it('falls back to #search when engine is null (no body fallback)', () => {
    // 回归：绝不回退 body —— body-before 会把 shadow host 挂到 <body> 之外。
    expect(pickAnchorSelector(null)).toBe('#search');
  });

  it('never returns "body" (would render invisible outside <body>)', () => {
    // 防御性回归：任何输入都不应给出 body 锚点。
    for (const engine of [google, bing, null]) {
      expect(pickAnchorSelector(engine)).not.toBe('body');
    }
  });
});
