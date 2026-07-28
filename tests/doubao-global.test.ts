import { describe, it, expect, beforeEach, vi } from 'vitest';
import { doubaoGlobalAdapter } from '@/lib/providers/doubao-global';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('doubaoGlobalAdapter', () => {
  it('maps a Documents payload, joining text snippets (no answer)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          ResponseMetadata: { RequestId: 'test' },
          Result: {
            TotalDocCount: 20,
            Documents: [
              {
                Rank: 0,
                Url: 'https://example.com/a',
                Title: '天安门',
                Snippet: [
                  { Type: 'text', Text: '第一段摘要' },
                  { Type: 'image', Image: { Width: 100, Height: 50, ImageUrl: 'https://img.com/a.jpg' } },
                  { Type: 'text', Text: '第二段摘要' },
                ],
                DocumentInfo: { ContentCharCount: 1000, Filetype: 'webpage', PublishTime: '2025-01-01T00:00:00+08:00' },
                HostInfo: { Hostname: '百科', IconUrl: 'https://example.com/icon.png' },
              },
              {
                Rank: 1,
                Url: 'https://example.com/b',
                Title: '第二个结果',
                Snippet: [{ Type: 'text', Text: '只有文本' }],
              },
            ],
            ErrorCode: 0,
            ErrorMsg: '',
          },
        }),
      ),
    );
    const out = await doubaoGlobalAdapter.search('天安门', {}, 'doubao-g-key');
    expect(out.provider).toBe('doubao-global');
    expect(out.answer).toBeUndefined();
    expect(out.results[0]).toMatchObject({
      title: '天安门',
      url: 'https://example.com/a',
      snippet: '第一段摘要\n第二段摘要',
      content: '第一段摘要\n第二段摘要',
      publishedDate: '2025-01-01T00:00:00+08:00',
      favicon: 'https://example.com/icon.png',
    });
    expect(out.results[1].snippet).toBe('只有文本');
    expect(out.results[1].favicon).toBeUndefined();
  });

  it('falls back to url for title when title is missing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          ResponseMetadata: {},
          Result: {
            TotalDocCount: 1,
            Documents: [{ Url: 'https://example.com/c', Snippet: [] }],
          },
        }),
      ),
    );
    const out = await doubaoGlobalAdapter.search('q', {}, 'k');
    expect(out.results[0].title).toBe('https://example.com/c');
    expect(out.results[0].snippet).toBe('');
    expect(out.results[0].content).toBeUndefined();
  });

  it('sends Bearer auth and request body with Query/DocCount/MaxSnippetLength', async () => {
    const fetchMock = vi.fn(async () => res(200, { ResponseMetadata: {}, Result: { TotalDocCount: 0, Documents: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await doubaoGlobalAdapter.search('hello', { maxResults: 5 }, 'doubao-g-key');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://open.feedcoopapi.com/search_api/global_search');
    expect(init.headers.Authorization).toBe('Bearer doubao-g-key');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ Query: 'hello', DocCount: 5, MaxSnippetLength: 1000 });
  });

  it('maps business error 700901 to unauthorized (HTTP 200, Result null)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          ResponseMetadata: { Error: { CodeN: 700901, Code: '700901', Message: 'APIKey invalid' } },
          Result: null,
        }),
      ),
    );
    await expect(doubaoGlobalAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(doubaoGlobalAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 401 to unauthorized ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { detail: { error: 'Unauthorized' } })));
    await expect(doubaoGlobalAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(doubaoGlobalAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 429 to rateLimit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})));
    await expect(doubaoGlobalAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(doubaoGlobalAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });
});
