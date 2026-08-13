import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parallelAdapter } from '@/lib/providers/parallel';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('parallelAdapter', () => {
  it('maps results payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          search_id: 'search_1',
          results: [
            {
              url: 'https://a.com',
              title: 'A',
              publish_date: '2024-01-15',
              excerpts: ['excerpt 1', 'excerpt 2'],
            },
            {
              url: 'https://b.com',
              title: 'B',
              publish_date: null,
              excerpts: ['only'],
            },
          ],
          session_id: 'session_1',
        }),
      ),
    );
    const out = await parallelAdapter.search('q', {}, 'par-x');
    expect(out.provider).toBe('parallel');
    expect(out.answer).toBeUndefined();
    expect(out.results[0]).toMatchObject({
      title: 'A',
      url: 'https://a.com',
      snippet: 'excerpt 1\n\nexcerpt 2',
      content: 'excerpt 1\n\nexcerpt 2',
      publishedDate: '2024-01-15',
    });
    expect(out.results[1]).toMatchObject({
      title: 'B',
      url: 'https://b.com',
      snippet: 'only',
      content: 'only',
    });
    expect(out.results[1].publishedDate).toBeUndefined();
  });

  it('answer is undefined when not present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200, { results: [{ url: 'https://a.com', title: 'A', excerpts: ['s'] }] })),
    );
    const out = await parallelAdapter.search('q', {}, 'k');
    expect(out.answer).toBeUndefined();
    expect(out.results[0].snippet).toBe('s');
  });

  it('sends x-api-key auth and request body', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await parallelAdapter.search('hello', {}, 'par-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.parallel.ai/v1/search');
    expect(init.headers['x-api-key']).toBe('par-abc');
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.objective).toBe('hello');
    expect(body.search_queries).toEqual(['hello']);
  });

  it('maps 401 to unauthorized ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { type: 'error', error: { message: 'Unauthorized' } })));
    await expect(parallelAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(parallelAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 429 to rateLimit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})));
    await expect(parallelAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(parallelAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });
});
