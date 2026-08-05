// SERP 快切栏跳转意图解析（resolveSerpHandoff）。
//
// 回归 https://… 网页上下文直接 location.assign 到 chrome-extension:// 被客户端拦截
// （ERR_BLOCKED_BY_CLIENT）：provider 分支必须产出 openSearchPage 深链（委托 background 用
// tabs.update 导航），而非 navigate（location.assign）。

import { describe, it, expect } from 'vitest';
import {
  decidePostWriteSiteEngineNavigation,
  nextQueryAfterSerpContext,
  resolveCurrentCustomEngineHandoff,
  resolveCurrentSiteEngineHandoff,
  resolveSerpContext,
  resolveSerpHandoff,
} from '@/lib/serp-handoff';
import type { SearchSource, SourceId } from '@/lib/sources';
import type { SiteEngineDefinition } from '@/lib/site-engines';
import type { CustomEngineDefinition } from '@/lib/custom-engines';

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
const baidu: SearchSource = {
  id: 'baidu',
  kind: 'engine',
  label: 'engine_baidu',
  supportsAnswer: false,
  favicon: '/icons/baidu.svg',
};
const docs: SearchSource = {
  id: 'site:docs', kind: 'site-engine', label: 'Docs', supportsAnswer: false,
  siteEngine: { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/guide', engineId: 'google' },
};

const siteDefinitions: SiteEngineDefinition[] = [
  { id: 'site:docs', name: 'Docs', target: 'https://docs.example.com/guide', engineId: 'google' },
];

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

  it('hands off query and empty query to Baidu', () => {
    expect(resolveSerpHandoff(baidu, '中文 搜索')).toEqual({
      kind: 'navigate',
      url: 'https://www.baidu.com/s?wd=%E4%B8%AD%E6%96%87%20%E6%90%9C%E7%B4%A2',
    });
    expect(resolveSerpHandoff(baidu, '   ')).toEqual({
      kind: 'navigate',
      url: 'https://www.baidu.com/',
    });
  });
});

describe('resolveSerpHandoff — ai-engine chip', () => {
  // 构造方式与其他 kind 相同；resolveSerpHandoff 通过 registry 按 id 查，不需要 aiEngine 字段。
  // inject 型（chatgpt/deepseek/doubao/gemini）默认追加 enter=1；url-only 型（grok）不追加。
  const aiCases: ReadonlyArray<{ source: SearchSource; queryUrl: string; homeUrl: string; inject: boolean }> = [
    { source: { id: 'ai:grok', kind: 'ai-engine', label: 'ai_engine_grok', supportsAnswer: false }, queryUrl: 'https://grok.com/?q=hello+world', homeUrl: 'https://grok.com/', inject: false },
    { source: { id: 'ai:chatgpt', kind: 'ai-engine', label: 'ai_engine_chatgpt', supportsAnswer: false }, queryUrl: 'https://chatgpt.com/?q=hello+world&enter=1', homeUrl: 'https://chatgpt.com/', inject: true },
    { source: { id: 'ai:deepseek', kind: 'ai-engine', label: 'ai_engine_deepseek', supportsAnswer: false }, queryUrl: 'https://chat.deepseek.com/?q=hello+world&enter=1', homeUrl: 'https://chat.deepseek.com/', inject: true },
    { source: { id: 'ai:doubao', kind: 'ai-engine', label: 'ai_engine_doubao', supportsAnswer: false }, queryUrl: 'https://www.doubao.com/chat/?q=hello+world&enter=1', homeUrl: 'https://www.doubao.com/chat/', inject: true },
    { source: { id: 'ai:gemini', kind: 'ai-engine', label: 'ai_engine_gemini', supportsAnswer: false }, queryUrl: 'https://gemini.google.com/app?q=hello+world&enter=1', homeUrl: 'https://gemini.google.com/app', inject: true },
  ];

  it('navigates to the built URL with the query encoded for each of the 5 AI engines', () => {
    for (const { source, queryUrl } of aiCases) {
      expect(resolveSerpHandoff(source, 'hello world')).toEqual({
        kind: 'navigate',
        url: queryUrl,
      });
    }
  });

  it('encodes CJK and special characters in the q parameter', () => {
    expect(resolveSerpHandoff(aiCases[0].source, '中文 & x')).toEqual({
      kind: 'navigate',
      url: 'https://grok.com/?q=%E4%B8%AD%E6%96%87+%26+x',
    });
  });

  it('aiAutoEnter:false 时不追加 enter=1（仅原生预填，不自动回车）', () => {
    for (const { source, queryUrl } of aiCases) {
      const expected = queryUrl.replace('&enter=1', '');
      expect(resolveSerpHandoff(source, 'hello world', { aiAutoEnter: false })).toEqual({
        kind: 'navigate',
        url: expected,
      });
    }
  });

  it('navigates to each AI engine home URL when the query is empty or whitespace', () => {
    for (const { source, homeUrl } of aiCases) {
      expect(resolveSerpHandoff(source, '   ')).toEqual({
        kind: 'navigate',
        url: homeUrl,
      });
    }
  });

  it('does not hand off an unregistered ai-engine id', () => {
    const bogus: SearchSource = { id: 'ai:unknown' as SourceId, kind: 'ai-engine', label: 'X', supportsAnswer: false };
    expect(resolveSerpHandoff(bogus, 'hello')).toBeNull();
  });
});

describe('resolveSerpHandoff — provider chip (回归 ERR_BLOCKED_BY_CLIENT)', () => {
  it('yields an openSearchPage deep link carrying query+provider (not a navigate)', () => {
    expect(resolveSerpHandoff(tavily, 'hello world')).toEqual({
      kind: 'openSearchPage',
      deepLink: '/search.html?provider=tavily&query=hello+world',
    });
  });

  it('falls back to the search home deep link for an empty query', () => {
    expect(resolveSerpHandoff(tavily, '   ')).toEqual({
      kind: 'openSearchPage',
      deepLink: '/search.html',
    });
  });
});

describe('resolveSerpHandoff — provider-instance chip', () => {
  const researchSource: SearchSource = {
    id: 'inst:exa:research',
    kind: 'provider-instance',
    label: 'AI 研究',
    supportsAnswer: true,
    favicon: '/icons/exa.svg',
    providerInstance: { id: 'inst:exa:research', baseProviderId: 'exa', name: 'AI 研究', options: {} },
  };

  it('yields an openSearchPage deep link carrying the instance id + query (not a navigate)', () => {
    expect(resolveSerpHandoff(researchSource, 'hello world')).toEqual({
      kind: 'openSearchPage',
      deepLink: '/search.html?provider=inst%3Aexa%3Aresearch&query=hello+world',
    });
  });

  it('falls back to the search home deep link for an empty query', () => {
    expect(resolveSerpHandoff(researchSource, '   ')).toEqual({
      kind: 'openSearchPage',
      deepLink: '/search.html',
    });
  });

  it('does not hand off an instance source with a malformed instance id', () => {
    const broken: SearchSource = { id: 'inst:unknown:abc' as SourceId, kind: 'provider-instance', label: 'X', supportsAnswer: true };
    expect(resolveSerpHandoff(broken, 'hello')).toBeNull();
  });
});

describe('resolveSerpHandoff — Site Engine chip', () => {
  it('navigates through its fixed backing engine with a generated site query', () => {
    expect(resolveSerpHandoff(docs, 'install')).toEqual({
      kind: 'navigate',
      url: 'https://www.google.com/search?q=site%3Adocs.example.com%2Fguide%20install',
    });
  });

  it('keeps the generated site restriction when the base query is empty', () => {
    expect(resolveSerpHandoff(docs, '  ')).toEqual({
      kind: 'navigate',
      url: 'https://www.google.com/search?q=site%3Adocs.example.com%2Fguide',
    });
  });
});

describe('resolveSerpHandoff — Custom Engine chip', () => {
  const customDef: CustomEngineDefinition = { id: 'custom:ddg', name: 'DDG', urlTemplate: 'https://duckduckgo.com/?q=%s' };
  const customSource: SearchSource = {
    id: 'custom:ddg', kind: 'custom-engine', label: 'DDG', supportsAnswer: false,
    customEngine: customDef,
  };

  it('navigates to the built URL with the query encoded', () => {
    expect(resolveSerpHandoff(customSource, 'hello world')).toEqual({
      kind: 'navigate',
      url: 'https://duckduckgo.com/?q=hello%20world',
    });
  });

  it('returns null for an empty query (no navigation)', () => {
    expect(resolveSerpHandoff(customSource, '   ')).toBeNull();
  });

  it('encodes CJK and special characters in the URL', () => {
    expect(resolveSerpHandoff(customSource, '中文&a=b')).toEqual({
      kind: 'navigate',
      url: 'https://duckduckgo.com/?q=%E4%B8%AD%E6%96%87%26a%3Db',
    });
  });
});

describe('resolveCurrentSiteEngineHandoff', () => {
  it('uses the fresh definition instead of a stale Site Engine projection', () => {
    expect(resolveCurrentSiteEngineHandoff('site:docs', 'install', [{
      id: 'site:docs', name: 'Updated Docs', target: 'https://new-docs.example.com', engineId: 'bing',
    }])).toEqual({
      kind: 'navigate',
      url: 'https://www.bing.com/search?q=site%3Anew-docs.example.com%20install',
    });
  });

  it('does not hand off a deleted Site Engine', () => {
    expect(resolveCurrentSiteEngineHandoff('site:docs', 'install', [])).toBeNull();
  });
});

describe('resolveCurrentCustomEngineHandoff (M1 regression — stale navigation)', () => {
  const defs: CustomEngineDefinition[] = [
    { id: 'custom:ddg', name: 'DDG', urlTemplate: 'https://duckduckgo.com/?q=%s' },
  ];

  it('resolves a fresh definition to a navigate intent with the query encoded', () => {
    expect(resolveCurrentCustomEngineHandoff('custom:ddg', 'hello world', defs)).toEqual({
      kind: 'navigate',
      url: 'https://duckduckgo.com/?q=hello%20world',
    });
  });

  it('re-reads an edited template rather than navigating a stale one', () => {
    const edited: CustomEngineDefinition[] = [
      { id: 'custom:ddg', name: 'DDG', urlTemplate: 'https://new.example.com/search?q=%s' },
    ];
    expect(resolveCurrentCustomEngineHandoff('custom:ddg', 'install', edited)).toEqual({
      kind: 'navigate',
      url: 'https://new.example.com/search?q=install',
    });
  });

  it('returns null for an empty/whitespace query (no navigation)', () => {
    expect(resolveCurrentCustomEngineHandoff('custom:ddg', '   ', defs)).toBeNull();
  });

  it('does not hand off a deleted Custom Engine even with a query', () => {
    expect(resolveCurrentCustomEngineHandoff('custom:gone', 'install', defs)).toBeNull();
  });

  it('does not hand off when the definitions list is empty', () => {
    expect(resolveCurrentCustomEngineHandoff('custom:ddg', 'install', [])).toBeNull();
  });
});

describe('decidePostWriteSiteEngineNavigation', () => {
  const preWriteUrl = 'https://www.google.com/search?q=site%3Aold.example.com%20install';

  it('falls back to the pre-write URL when the post-write config read fails', () => {
    expect(decidePostWriteSiteEngineNavigation('site:docs', 'install', null, preWriteUrl)).toEqual({
      kind: 'navigate',
      url: preWriteUrl,
    });
  });

  it('navigates the post-write handoff URL when the definition was edited', () => {
    expect(decidePostWriteSiteEngineNavigation('site:docs', 'install', [{
      id: 'site:docs', name: 'Docs', target: 'https://new.example.com/guide', engineId: 'google',
    }], preWriteUrl)).toEqual({
      kind: 'navigate',
      url: 'https://www.google.com/search?q=site%3Anew.example.com%2Fguide%20install',
    });
  });

  it('returns unresolved when the Site Engine was deleted between reads', () => {
    expect(decidePostWriteSiteEngineNavigation('site:docs', 'install', [], preWriteUrl)).toEqual({
      kind: 'unresolved',
    });
  });
});

describe('resolveSerpContext', () => {
  it('recovers an exact Site Engine query and strips it to the empty base query', () => {
    expect(resolveSerpContext('google', 'site:docs.example.com/guide', siteDefinitions, 'site:docs'))
      .toEqual({ baseQuery: '', activeId: 'site:docs', matchingSiteId: 'site:docs' });
  });

  it('uses active source before source order to resolve duplicate matching scopes', () => {
    const duplicates: SiteEngineDefinition[] = [
      { id: 'site:first', name: 'First', target: 'example.com/one', engineId: 'baidu' },
      { id: 'site:second', name: 'Second', target: 'example.com/two', engineId: 'baidu' },
    ];
    expect(resolveSerpContext('baidu', 'site:example.com term', duplicates, 'site:first', ['site:second', 'site:first']))
      .toEqual({ baseQuery: 'term', activeId: 'site:first', matchingSiteId: 'site:first' });
    expect(resolveSerpContext('baidu', 'site:example.com term', duplicates, null, ['site:second', 'site:first']))
      .toEqual({ baseQuery: 'term', activeId: 'site:second', matchingSiteId: 'site:second' });
  });

  it('keeps a hidden matching Site Engine unselected while still stripping its base query', () => {
    expect(resolveSerpContext('google', 'site:docs.example.com/guide install', siteDefinitions, 'site:docs', [], ['site:docs']))
      .toEqual({ baseQuery: 'install', activeId: 'google', matchingSiteId: null });
  });

  it('activates a visible matching Site Engine even if its backing engine is hidden', () => {
    expect(resolveSerpContext('google', 'site:docs.example.com/guide install', siteDefinitions, 'google', [], ['google']))
      .toEqual({ baseQuery: 'install', activeId: 'site:docs', matchingSiteId: 'site:docs' });
  });

  it('leaves a nonmatching manual site query raw and keeps the backing engine active', () => {
    expect(resolveSerpContext('google', 'site:manual.example.com install', siteDefinitions, 'site:docs'))
      .toEqual({ baseQuery: 'site:manual.example.com install', activeId: 'google', matchingSiteId: null });
  });
});

describe('nextQueryAfterSerpContext', () => {
  it('adopts the stripped base query when a Site Engine still matches', () => {
    expect(nextQueryAfterSerpContext(
      { matchingSiteId: 'site:docs', baseQuery: 'install' },
      'site:docs.example.com/guide install',
      'previous',
    )).toBe('install');
  });

  it('keeps the in-memory base query when an unresolved site-scoped SERP no longer matches', () => {
    expect(nextQueryAfterSerpContext(
      { matchingSiteId: null, baseQuery: 'site:docs.example.com/guide install' },
      'site:docs.example.com/guide install',
      'install',
    )).toBe('install');
  });

  it('adopts context.baseQuery when the raw SERP query is not site-scoped', () => {
    expect(nextQueryAfterSerpContext(
      { matchingSiteId: null, baseQuery: 'plain query' },
      'plain query',
      'install',
    )).toBe('plain query');
  });

  it('adopts context.baseQuery when in-memory query is empty even if raw is site-scoped', () => {
    expect(nextQueryAfterSerpContext(
      { matchingSiteId: null, baseQuery: 'site:docs.example.com/guide install' },
      'site:docs.example.com/guide install',
      '',
    )).toBe('site:docs.example.com/guide install');
  });
});
