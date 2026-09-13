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

  it('extracts Baidu zhannei site-instance results from the #results.content-main container', () => {
    // zhannei 站内 SERP（站点实例 baidu zhannei 模式的落点）：容器与主站不同，
    // 页面 URL 为 zhannei.baidu.com/cse/site。fixture 按 2026-09-13 真机校准的卡片结构
    // （div.result.f.s0 + h3.c-title > a + .c-abstract + .c-showurl）复刻；mu/跳转壳为防御性变体。
    const document = new DOMParser().parseFromString(fixture('zhannei-basic.html'), 'text/html');
    expect(extractEngineSearch({ document, engine: 'baidu', query: 'test query', pageUrl: 'https://zhannei.baidu.com/cse/site?q=test&cc=example.com' })).toEqual({
      engine: 'baidu',
      query: 'test query',
      results: [
        { title: 'Example One intro', url: 'https://example.com/one', snippet: 'First abstract text.' },
        { title: 'Example Two', url: 'https://example.com/two', snippet: 'Second abstract.' },
      ],
    });
  });

  it('keeps the main Baidu path on #content_left even when a #results container exists', () => {
    // 主站页面 URL（www.baidu.com/s）永不走 zhannei 分支——分支按 pageUrl host 判定。
    const document = new DOMParser().parseFromString(fixture('baidu-basic.html'), 'text/html');
    expect(extractEngineSearch({ document, engine: 'baidu', query: 'test query', pageUrl: 'https://www.baidu.com/s?wd=test' })).toEqual({
      engine: 'baidu', query: 'test query', results: [{ title: 'Baidu title', url: 'https://example.cn/article', snippet: 'Baidu abstract' }],
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

  it('extracts Weixin article results with redirect-wrapper URLs and rich snippet fallback', () => {
    const document = new DOMParser().parseFromString(fixture('weixin-basic.html'), 'text/html');
    const result = extractEngineSearch({ document, engine: 'weixin', query: 'test query', pageUrl: 'https://weixin.sogou.com/weixin?type=2&query=test&ie=utf8' });
    expect(result).toEqual({
      engine: 'weixin',
      query: 'test query',
      results: [
        {
          title: 'DeepSeek 技术深度解析',
          url: 'https://weixin.sogou.com/link?url=dn9a_-gY295K0Rci&type=2&query=deepseek&token=abc&k=4&h=k',
          snippet: '本文深入分析 DeepSeek 的架构设计与训练策略。',
        },
      ],
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
        // snippet 为纯展示元数据 → snippetKind:'metadata'（聚合重排剔除出重排文档）。
        { title: '千星奇域 7.0版本传说套装PV', url: 'https://www.bilibili.com/video/BV1JS316dELY/', snippet: '播放: 1.5万 · 时长: 01:01', snippetKind: 'metadata' },
        // 真结果卡：全字段富元数据；protocol-relative URL 解析为 https。
        { title: '原神 超越PV 骤雪', url: 'https://www.bilibili.com/video/BV1zi7Y6BEdS/', snippet: 'UP主: 原神 · 播放: 952.7万 · 弹幕: 7.8万 · 时长: 20:57', snippetKind: 'metadata' },
        { title: '原神 角色演示 钟离 听书人', url: 'https://www.bilibili.com/video/BV1hD4y1X7Rm/', snippet: 'UP主: 原神 · 播放: 703.6万 · 弹幕: 6.3万 · 时长: 03:38', snippetKind: 'metadata' },
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
        // snippet 为纯展示元数据 → snippetKind:'metadata'（聚合重排剔除出重排文档）。
        { title: '原神前瞻活动', url: 'https://www.xiaohongshu.com/explore/6a6c986d0000000033010cc1', snippet: '作者: 雨滴归云 · 点赞: 18', snippetKind: 'metadata' },
        { title: '原神7.0卡池爆料合集', url: 'https://www.xiaohongshu.com/explore/6b7d000000000000004412dd2', snippet: '作者: 后日谈STUDIO · 点赞: 1.2万', snippetKind: 'metadata' },
        // 无标题笔记：填占位 (无标题)。
        { title: '(无标题)', url: 'https://www.xiaohongshu.com/explore/7c8e000000000000005523ee3', snippet: '作者: 流星J · 点赞: 324', snippetKind: 'metadata' },
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
        // 视频卡：URL 由 id 拼成 /video/{id}；title 取文案全文（语义在 title，不动）；
        // snippet 为纯展示元数据（作者/点赞）→ snippetKind:'metadata'。
        {
          title: '#原神 #阿罗夏 疾掠弋缇 · 阿罗夏 | 似隼疾掠，弋猎于冬 《原神》「无神怜爱的雪国」前瞻特别节目将于7月31日20:00正式开启。',
          url: 'https://www.douyin.com/video/7668537075284643087',
          snippet: '作者: @原神 · 点赞: 15.8万',
          snippetKind: 'metadata',
        },
        {
          title: '#原神 #原神至冬 《原神》7.0版本「无神怜爱的雪国」活动汇总',
          url: 'https://www.douyin.com/video/7668682492911635764',
          snippet: '作者: @原神 · 点赞: 3784',
          snippetKind: 'metadata',
        },
        // 图文卡：URL 用 /note/{id}。
        {
          title: '原神至冬最新兑换码单个码最大的一次。#原神 #原神空月之歌',
          url: 'https://www.douyin.com/note/7632304936659804392',
          snippet: '作者: @苏打ooo · 点赞: 461',
          snippetKind: 'metadata',
        },
        {
          title: '亲爱的旅行者，派蒙的特别节目预告时间到啦 《原神》7.0版本前瞻特别节目将于7月31日晚20:00正式开启。',
          url: 'https://www.douyin.com/video/7667794922409446706',
          snippet: '作者: @原神 · 点赞: 31.8万',
          snippetKind: 'metadata',
        },
        // #0 用户聚合卡（含 /user/ 链接）、#4 相关搜索卡 均无时长/图文形状，被丢弃（兜底 blob 解析同样失配）。
      ],
    });
  });

  it('extracts Douyin glued-caption cards by leaf shapes after whitespace removal (2026-09-13 regression)', () => {
    // 复刻 2026-09-13 实测 DOM：class 混淆、卡内无 <a>、字段各为独立叶子，
    // 且 card.textContent 的 token 间无空白（10:041.3万…、图文408…、#话题@作者）。
    const document = new DOMParser().parseFromString(fixture('douyin-glued.html'), 'text/html');
    const result = extractEngineSearch({ document, engine: 'douyin', query: 'test query', pageUrl: 'https://www.douyin.com/search/test' });
    expect(result).toEqual({
      engine: 'douyin',
      query: 'test query',
      results: [
        // 视频卡：时长叶子 + 点赞叶子 + 「@」叶子的下一兄弟元素为作者。
        {
          title: '新疆乌鲁木齐美食攻略 拌面凉皮面肺子 烤肉抓饭椒麻鸡 还有新疆炒米粉～#乌鲁木齐美食 #迈扣来了',
          url: 'https://www.douyin.com/video/7655237577460416832',
          snippet: '作者: @迈扣来了 · 点赞: 1.3万',
          snippetKind: 'metadata',
        },
        // 图文卡：以「图文」叶子分类，URL 用 /note/{id}。
        {
          title: '感觉是安阳目前top1好吃的！！！！夯爆了好好吃 #安阳美食 #口袋虾球',
          url: 'https://www.douyin.com/note/7682991989692042971',
          snippet: '作者: @霹雳小熊吃不胖 · 点赞: 408',
          snippetKind: 'metadata',
        },
        // 无点赞叶子的视频卡：snippet 只剩作者，优雅降级。
        {
          title: '这道菜，我请你吃｜第一期：蛏子捞饭 #北京美食推荐',
          url: 'https://www.douyin.com/video/7684620269587057960',
          snippet: '作者: @美食和Ta的朋友们',
          snippetKind: 'metadata',
        },
        // 相关搜索卡（全 <p> 叶子）、用户聚合卡（<a> + 获赞粉丝文本）均无时长/图文叶子，被丢弃。
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
