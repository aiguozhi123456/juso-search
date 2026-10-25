import { describe, it, expect, beforeEach, vi } from 'vitest';
import { deepseekAdapter } from '@/lib/providers/deepseek';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('deepseekAdapter', () => {
  it('maps a results payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          results: [
            {
              rerank_score: 2.4,
              title: 'DeepSeek V4 model released',
              url: 'https://example.com/deepseek-v4',
              snippet: 'DeepSeek V4 is now available.',
              summary: 'DeepSeek has released the V4 model with tool calling support.',
              content: '',
              site_name: 'Example News',
              site_icon: 'https://example.com/favicon.ico',
              date: '2026-06-01T00:00:00+00:00',
              authority: 3,
            },
            {
              url: 'https://no-title.com',
              summary: 'summary only',
            },
          ],
        }),
      ),
    );
    const out = await deepseekAdapter.search('q', {}, 'sk-x');
    expect(out.provider).toBe('deepseek');
    expect(out.answer).toBeUndefined();
    expect(out.results[0]).toMatchObject({
      title: 'DeepSeek V4 model released',
      url: 'https://example.com/deepseek-v4',
      snippet: 'DeepSeek V4 is now available.',
      content: 'DeepSeek has released the V4 model with tool calling support.',
      score: 2.4,
      publishedDate: '2026-06-01T00:00:00+00:00',
      favicon: 'https://example.com/favicon.ico',
    });
    // title 缺省回退 url；snippet 缺省回退 summary。
    expect(out.results[1]).toMatchObject({
      title: 'https://no-title.com',
      snippet: 'summary only',
      content: 'summary only',
    });
  });

  it('sends Bearer auth and request body with count clamped to the upstream cap', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await deepseekAdapter.search('hello', { maxResults: 60 }, 'sk-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.deepseek.com/v1/tools/search');
    expect(init.headers.Authorization).toBe('Bearer sk-abc');
    const body = JSON.parse(init.body);
    expect(body.query).toBe('hello');
    expect(body.count).toBe(50);
    expect(body.need_content).toBeUndefined();
  });

  it('defaults count to 10 when maxResults is unset', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await deepseekAdapter.search('q', {}, 'k');
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [unknown, { body: string }])[1].body);
    expect(body.count).toBe(10);
  });

  it('maps 401 to unauthorized ProviderError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(401, { error: { message: 'Authentication Fails', type: 'authentication_error', param: null, code: 'invalid_request_error' } })),
    );
    await expect(deepseekAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(deepseekAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 429 to rateLimit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})));
    await expect(deepseekAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(deepseekAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });
});
