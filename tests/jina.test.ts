import { describe, it, expect, beforeEach, vi } from 'vitest';
import { jinaAdapter } from '@/lib/providers/jina';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('jinaAdapter', () => {
  it('maps a results payload (no answer)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          code: 200,
          status: 20000,
          data: [
            { title: 'A', description: 'desc A', url: 'https://a.com', content: 'full A', usage: { tokens: 100 } },
            { title: 'B', description: 'desc B', url: 'https://b.com' },
          ],
        }),
      ),
    );
    const out = await jinaAdapter.search('q', {}, 'jina-x');
    expect(out.provider).toBe('jina');
    expect(out.answer).toBeUndefined();
    expect(out.results[0]).toMatchObject({
      title: 'A',
      url: 'https://a.com',
      snippet: 'desc A',
      content: 'full A',
    });
    expect(out.results[1].content).toBeUndefined();
  });

  it('falls back to url for title and content slice for snippet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          code: 200,
          status: 20000,
          data: [{ url: 'https://a.com', content: 'x'.repeat(400) }],
        }),
      ),
    );
    const out = await jinaAdapter.search('q', {}, 'jina-x');
    expect(out.results[0].title).toBe('https://a.com');
    expect(out.results[0].snippet).toBe('x'.repeat(300));
  });

  it('sends Bearer auth, Accept and X-Respond-With headers and request body', async () => {
    const fetchMock = vi.fn(async () => res(200, { code: 200, status: 20000, data: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await jinaAdapter.search('hello', { maxResults: 5 }, 'jina-x');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://s.jina.ai/');
    expect(init.headers.Authorization).toBe('Bearer jina-x');
    expect(init.headers.Accept).toBe('application/json');
    expect(init.headers['X-Respond-With']).toBe('no-content');
    const body = JSON.parse(init.body);
    expect(body).toEqual({ q: 'hello', num: 5 });
  });

  it('maps 401 to unauthorized ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { detail: { error: 'Unauthorized' } })));
    await expect(jinaAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(jinaAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 429 to rateLimit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, {})));
    await expect(jinaAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(jinaAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });
});
