import { describe, it, expect, beforeEach, vi } from 'vitest';
import { doubaoAdapter } from '@/lib/providers/doubao';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('doubaoAdapter', () => {
  it('maps a WebResults payload (no answer)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          ResponseMetadata: { RequestId: 'test' },
          Result: {
            ResultCount: 2,
            WebResults: [
              {
                Title: '北京攻略',
                Url: 'https://example.com/a',
                Snippet: '简短片段',
                Summary: '较长摘要',
                Content: '完整正文',
                PublishTime: '2025-06-19T15:10:00+08:00',
                LogoUrl: 'https://example.com/favicon.png',
                RankScore: 0.95,
              },
              {
                Title: '另一篇',
                Url: 'https://example.com/b',
                Snippet: '片段B',
              },
            ],
            SearchContext: { OriginQuery: '北京', SearchType: 'web' },
            TimeCost: 372,
            LogId: 'test',
          },
        }),
      ),
    );
    const out = await doubaoAdapter.search('北京', {}, 'doubao-key');
    expect(out.provider).toBe('doubao');
    expect(out.answer).toBeUndefined();
    expect(out.results[0]).toMatchObject({
      title: '北京攻略',
      url: 'https://example.com/a',
      snippet: '简短片段',
      content: '完整正文',
      score: 0.95,
      publishedDate: '2025-06-19T15:10:00+08:00',
      favicon: 'https://example.com/favicon.png',
    });
    expect(out.results[1].content).toBeUndefined();
    expect(out.results[1].snippet).toBe('片段B');
  });

  it('falls back to Summary for snippet when Snippet is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          ResponseMetadata: {},
          Result: {
            ResultCount: 1,
            WebResults: [{ Url: 'https://example.com/c', Summary: 'x'.repeat(400) }],
          },
        }),
      ),
    );
    const out = await doubaoAdapter.search('q', {}, 'k');
    expect(out.results[0].title).toBe('https://example.com/c');
    expect(out.results[0].snippet).toBe('x'.repeat(300));
    expect(out.results[0].content).toBe('x'.repeat(400));
  });

  it('sends Bearer auth and request body with Query/SearchType/Count/Filter', async () => {
    const fetchMock = vi.fn(async () => res(200, { ResponseMetadata: {}, Result: { ResultCount: 0, WebResults: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await doubaoAdapter.search('hello', { maxResults: 5 }, 'doubao-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://open.feedcoopapi.com/search_api/web_search');
    expect(init.headers.Authorization).toBe('Bearer doubao-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ Query: 'hello', SearchType: 'web', Count: 5, Filter: { NeedUrl: true } });
  });

  it('maps business error 10403 to unauthorized (HTTP 200, Result null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          ResponseMetadata: { Error: { CodeN: 10403, Code: '10403', Message: 'InvalidAccountId' } },
          Result: null,
        }),
      ),
    );
    await expect(doubaoAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(doubaoAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps business error 700429 to rateLimit (HTTP 200, Result null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          ResponseMetadata: { Error: { CodeN: 700429, Code: '700429', Message: 'FreeRateLimitExceeded' } },
          Result: null,
        }),
      ),
    );
    await expect(doubaoAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps 401 to unauthorized ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { detail: { error: 'Unauthorized' } })));
    await expect(doubaoAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(doubaoAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 429 to rateLimit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})));
    await expect(doubaoAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(doubaoAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });
});
