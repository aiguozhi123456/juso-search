import { describe, it, expect, beforeEach, vi } from 'vitest';
import { tavilyAdapter } from '@/lib/providers/tavily';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('tavilyAdapter', () => {
  it('maps an answer + results payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          query: 'q',
          answer: 'Messi is an Argentine footballer.',
          results: [
            { title: 'A', url: 'https://a.com', content: 'snippet A', score: 0.9, favicon: 'https://a.com/f.png' },
            { title: 'B', url: 'https://b.com', content: 'snippet B' },
          ],
        }),
      ),
    );
    const out = await tavilyAdapter.search('q', {}, 'tvly-x');
    expect(out.provider).toBe('tavily');
    expect(out.answer?.text).toBe('Messi is an Argentine footballer.');
    expect(out.answer?.citations).toHaveLength(2);
    expect(out.answer?.citations[0]).toEqual({ url: 'https://a.com', title: 'A' });
    expect(out.results[0]).toMatchObject({
      title: 'A',
      url: 'https://a.com',
      snippet: 'snippet A',
      score: 0.9,
      favicon: 'https://a.com/f.png',
    });
  });

  it('answer is undefined when not present', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200, { results: [{ title: 'A', url: 'https://a.com', content: 's' }] })),
    );
    const out = await tavilyAdapter.search('q', {}, 'k');
    expect(out.answer).toBeUndefined();
    expect(out.results[0].snippet).toBe('s');
  });

  it('sends Bearer auth and request body', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await tavilyAdapter.search('hello', { maxResults: 5 }, 'tvly-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.headers.Authorization).toBe('Bearer tvly-abc');
    const body = JSON.parse(init.body);
    expect(body.query).toBe('hello');
    expect(body.include_answer).toBe(true);
    expect(body.max_results).toBe(5);
  });

  it('maps 401 to unauthorized ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { detail: { error: 'Unauthorized' } })));
    await expect(tavilyAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(tavilyAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 429 to rateLimit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})));
    await expect(tavilyAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(tavilyAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });
});
