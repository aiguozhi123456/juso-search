import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractEngineSearch } from '@/lib/engines/extractors';
import type { EngineId } from '@/lib/engines/types';

const fixture = (name: string) => readFileSync(join(process.cwd(), 'tests/fixtures/engines', name), 'utf8');

function extract(engine: EngineId, name: string, maxResults?: number) {
  const document = new DOMParser().parseFromString(fixture(name), 'text/html');
  return extractEngineSearch({ document, engine, query: 'test query', pageUrl: `https://www.${engine}.com/search?q=test`, maxResults });
}

describe('engine natural-result extractors', () => {
  it('extracts and cleans Google natural results', () => {
    expect(extract('google', 'google-basic.html')).toEqual({
      engine: 'google', query: 'test query', results: [
        { title: 'Example guide', url: 'https://example.com/guide', snippet: 'Useful guide text.' },
        { title: 'Second result', url: 'https://example.org/second', snippet: 'Second snippet' },
      ],
    });
  });

  it('excludes Google AI, knowledge, and featured-answer blocks', () => {
    expect(extract('google', 'google-special-blocks.html')).toEqual({
      engine: 'google', query: 'test query', results: [{ title: 'Natural result', url: 'https://example.com/natural', snippet: 'Natural snippet' }],
    });
  });

  it('only unwraps Google redirects hosted by Google', () => {
    expect(extract('google', 'google-external-url-path.html')).toEqual({
      engine: 'google', query: 'test query', results: [{ title: 'External URL path', url: 'https://example.com/url?q=https%3A%2F%2Fevil.example', snippet: 'External snippet' }],
    });
  });

  it('extracts Bing redirect URLs and rejects ads and invalid schemes', () => {
    expect(extract('bing', 'bing-basic.html')).toEqual({
      engine: 'bing', query: 'test query', results: [{ title: 'Bing title', url: 'https://example.com/bing', snippet: 'Bing snippet' }],
    });
  });

  it('only unwraps Bing redirects hosted by Bing', () => {
    expect(extract('bing', 'bing-external-ck-path.html')).toEqual({
      engine: 'bing', query: 'test query', results: [{ title: 'External CK path', url: 'https://example.com/ck/a?u=a1aHR0cHM6Ly9ldmlsLmV4YW1wbGU', snippet: 'External snippet' }],
    });
  });

  it('prefers Baidu mu URLs and deduplicates them', () => {
    expect(extract('baidu', 'baidu-basic.html')).toEqual({
      engine: 'baidu', query: 'test query', results: [{ title: 'Baidu title', url: 'https://example.cn/article', snippet: 'Baidu abstract' }],
    });
  });

  it('resolves Baidu real URLs from local DOM fields without follow-redirect', () => {
    expect(extract('baidu', 'baidu-url-fallbacks.html')).toEqual({
      engine: 'baidu',
      query: 'test query',
      results: [
        { title: 'Mdurl title', url: 'https://example.cn/from-mdurl', snippet: 'From data-mdurl' },
        { title: 'Log title', url: 'https://example.cn/from-log', snippet: 'From data-log mu' },
        { title: 'Log quotes title', url: 'https://example.cn/from-log-single-quotes', snippet: 'Mobile log with single-quoted JSON' },
        { title: 'Scholar title', url: 'https://example.cn/scholar', snippet: 'From sc_vurl' },
        { title: 'Direct title', url: 'https://example.cn/direct', snippet: 'Bare external href' },
        { title: 'Prefer mu', url: 'https://example.cn/preferred', snippet: 'mu wins over mdurl and href' },
      ],
    });
  });

  it('extracts Yandex natural results and rejects ads and invalid schemes', () => {
    expect(extract('yandex', 'yandex-basic.html')).toEqual({
      engine: 'yandex', query: 'test query', results: [{ title: 'Yandex title', url: 'https://example.com/yandex', snippet: 'Yandex snippet' }],
    });
  });

  it('extracts DuckDuckGo natural results and rejects ads and invalid schemes', () => {
    expect(extract('duckduckgo', 'duckduckgo-basic.html')).toEqual({
      engine: 'duckduckgo', query: 'test query', results: [{ title: 'DuckDuckGo title', url: 'https://example.com/ddg', snippet: 'DuckDuckGo snippet' }],
    });
  });

  it('extracts Bilibili cards with rich snippet metadata and resolves protocol-relative URLs', () => {
    const document = new DOMParser().parseFromString(fixture('bilibili-basic.html'), 'text/html');
    const result = extractEngineSearch({ document, engine: 'bilibili', query: 'test query', pageUrl: 'https://search.bilibili.com/all?keyword=test' });
    expect(result).toEqual({
      engine: 'bilibili',
      query: 'test query',
      results: [
        // 聚合卡（顶部「作者最新视频」）：无 UP主/弹幕，snippet 字段优雅降级。
        { title: '千星奇域 7.0版本传说套装PV', url: 'https://www.bilibili.com/video/BV1JS316dELY/', snippet: '播放: 1.5万 · 时长: 01:01' },
        // 真结果卡：全字段富元数据；protocol-relative URL 解析为 https。
        { title: '原神 超越PV 骤雪', url: 'https://www.bilibili.com/video/BV1zi7Y6BEdS/', snippet: 'UP主: 原神 · 播放: 952.7万 · 弹幕: 7.8万 · 时长: 20:57' },
        { title: '原神 角色演示 钟离 听书人', url: 'https://www.bilibili.com/video/BV1hD4y1X7Rm/', snippet: 'UP主: 原神 · 播放: 703.6万 · 弹幕: 6.3万 · 时长: 03:38' },
        // 无 http(s) URL 的卡被丢弃；含 data-ad 的推广卡被排除。
      ],
    });
  });

  it('extracts Xiaohongshu notes with rich snippet and fills placeholder for untitled notes', () => {
    const document = new DOMParser().parseFromString(fixture('xiaohongshu-basic.html'), 'text/html');
    const result = extractEngineSearch({ document, engine: 'xiaohongshu', query: 'test query', pageUrl: 'https://www.xiaohongshu.com/search_result?keyword=test' });
    expect(result).toEqual({
      engine: 'xiaohongshu',
      query: 'test query',
      results: [
        // 真笔记（有标题）：作者名干净、点赞数；相对 URL 解析为 https。
        { title: '原神前瞻活动', url: 'https://www.xiaohongshu.com/explore/6a6c986d0000000033010cc1', snippet: '作者: 雨滴归云 · 点赞: 18' },
        { title: '原神7.0卡池爆料合集', url: 'https://www.xiaohongshu.com/explore/6b7d000000000000004412dd2', snippet: '作者: 后日谈STUDIO · 点赞: 1.2万' },
        // 无标题笔记：填占位 (无标题)。
        { title: '(无标题)', url: 'https://www.xiaohongshu.com/explore/7c8e000000000000005523ee3', snippet: '作者: 流星J · 点赞: 324' },
        // 无 /explore/ 链接的广告/直播/热搜卡 + 无效 scheme 的卡均被丢弃。
      ],
    });
  });

  it('extracts Douyin video/note cards by synthesizing URLs from waterfall ids and parsing caption text', () => {
    const document = new DOMParser().parseFromString(fixture('douyin-basic.html'), 'text/html');
    const result = extractEngineSearch({ document, engine: 'douyin', query: 'test query', pageUrl: 'https://www.douyin.com/search/test' });
    expect(result).toEqual({
      engine: 'douyin',
      query: 'test query',
      results: [
        // 视频卡：URL 由 id 拼成 /video/{id}；title 取文案全文；snippet 拆出 点赞+作者。
        {
          title: '#原神 #阿罗夏 疾掠弋缇 · 阿罗夏 | 似隼疾掠，弋猎于冬 《原神》「无神怜爱的雪国」前瞻特别节目将于7月31日20:00正式开启。',
          url: 'https://www.douyin.com/video/7668537075284643087',
          snippet: '作者: @原神 · 点赞: 15.8万',
        },
        {
          title: '#原神 #原神至冬 《原神》7.0版本「无神怜爱的雪国」活动汇总',
          url: 'https://www.douyin.com/video/7668682492911635764',
          snippet: '作者: @原神 · 点赞: 3784',
        },
        // 图文卡：URL 用 /note/{id}。
        {
          title: '原神至冬最新兑换码单个码最大的一次。#原神 #原神空月之歌',
          url: 'https://www.douyin.com/note/7632304936659804392',
          snippet: '作者: @苏打ooo · 点赞: 461',
        },
        {
          title: '亲爱的旅行者，派蒙的特别节目预告时间到啦 《原神》7.0版本前瞻特别节目将于7月31日晚20:00正式开启。',
          url: 'https://www.douyin.com/video/7667794922409446706',
          snippet: '作者: @原神 · 点赞: 31.8万',
        },
        // #0 用户聚合卡（含 /user/ 链接）、#4 相关搜索卡 均无时长/图文前缀，被 parseCardFields 丢弃。
      ],
    });
  });

  it('clamps the requested maximum result count', () => {
    expect((extract('google', 'google-basic.html', 1) as { results: unknown[] }).results).toHaveLength(1);
    expect((extract('google', 'google-basic.html', 0) as { results: unknown[] }).results).toHaveLength(1);
  });

  it.each([
    ['google', 'google-challenge.html', 'challenge'],
    ['bing', 'bing-consent.html', 'consent'],
    ['baidu', 'baidu-unsupported.html', 'no-results'],
  ] as const)('reports %s page states without treating them as empty results', (engine, name, error) => {
    expect(extract(engine, name)).toEqual({ engine, query: 'test query', error });
  });

  it('extracts Google results nested inside wrapper containers', () => {
    expect(extract('google', 'google-nested-wrapper.html')).toEqual({
      engine: 'google', query: 'test query', results: [
        { title: 'First nested result', url: 'https://example.com/result1', snippet: 'First snippet' },
        { title: 'Second nested result', url: 'https://example.com/result2', snippet: 'Second snippet' },
        { title: 'Third nested result', url: 'https://example.com/result3', snippet: 'Third snippet' },
      ],
    });
  });

  it('filters special blocks nested inside wrappers without blocking organic siblings', () => {
    expect(extract('google', 'google-nested-special.html')).toEqual({
      engine: 'google', query: 'test query', results: [{ title: 'Natural result', url: 'https://example.com/natural', snippet: 'Natural snippet' }],
    });
  });

  it('reports unsupported layout when a result root is absent', () => {
    const document = new DOMParser().parseFromString('<main><article>special card</article></main>', 'text/html');
    expect(extractEngineSearch({ document, engine: 'google', query: 'test', pageUrl: 'https://www.google.com/search?q=test' })).toEqual({
      engine: 'google', query: 'test', error: 'unsupported-layout',
    });
  });
});
