// SERP 快切栏跳转意图解析（resolveSerpHandoff）。
//
// 回归 https://… 网页上下文直接 location.assign 到 chrome-extension:// 被客户端拦截
// （ERR_BLOCKED_BY_CLIENT）：provider 分支必须产出 openSearchPage 深链（委托 background 用
// tabs.update 导航），而非 navigate（location.assign）。

import { describe, it, expect } from 'vitest';
import { resolveSerpHandoff } from '@/lib/serp-handoff';
import type { SearchSource } from '@/lib/sources';

const tavily: SearchSource = {
  id: 'tavily',
  kind: 'provider',
  label: 'provider_tavily',
  supportsAnswer: true,
};
const google: SearchSource = {
  id: 'google',
  kind: 'engine',
  label: 'engine_google',
  supportsAnswer: false,
  favicon: '/icons/google.svg',
};

describe('resolveSerpHandoff — engine chip', () => {
  it('yields a navigate intent to the SERP with the query', () => {
    expect(resolveSerpHandoff(google, 'hello world')).toEqual({
      kind: 'navigate',
      url: 'https://www.google.com/search?q=hello%20world',
    });
  });

  it('yields a navigate intent to the engine home when the query is empty', () => {
    expect(resolveSerpHandoff(google, '   ')).toEqual({
      kind: 'navigate',
      url: 'https://www.google.com/',
    });
  });
});

describe('resolveSerpHandoff — provider chip (回归 ERR_BLOCKED_BY_CLIENT)', () => {
  it('yields an openSearchPage deep link carrying query+provider (not a navigate)', () => {
    expect(resolveSerpHandoff(tavily, 'hello world')).toEqual({
      kind: 'openSearchPage',
      deepLink: 'search.html?provider=tavily&query=hello+world',
    });
  });

  it('falls back to the search home deep link for an empty query', () => {
    expect(resolveSerpHandoff(tavily, '   ')).toEqual({
      kind: 'openSearchPage',
      deepLink: '/search.html',
    });
  });
});
