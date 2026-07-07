import { describe, it, expect, beforeEach, vi } from 'vitest';
import { stepfunAdapter } from '@/lib/providers/stepfun';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('stepfunAdapter', () => {
  it('maps results and stays answer-less', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          query: 'q',
          results: [
            { url: 'https://a.com', position: 1, title: 'A', time: '2026-03-20T00:00:00', snippet: 'snip A', content: 'full A' },
            { url: 'https://b.com', position: 2, title: 'B', snippet: 'snip B' },
          ],
        }),
      ),
    );
    const out = await stepfunAdapter.search('q', {}, 'sf-key');
    expect(stepfunAdapter.supportsAnswer).toBe(false);
    expect(out.answer).toBeUndefined();
    expect(out.results).toHaveLength(2);
    expect(out.results[0]).toMatchObject({
      title: 'A',
      url: 'https://a.com',
      snippet: 'snip A',
      content: 'full A',
      publishedDate: '2026-03-20T00:00:00',
    });
  });

  it('sends Bearer header and n param', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await stepfunAdapter.search('hi', { maxResults: 6 }, 'sf-key');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.stepfun.com/v1/search');
    expect(init.headers.Authorization).toBe('Bearer sf-key');
    expect(JSON.parse(init.body).n).toBe(6);
  });

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, {})));
    await expect(stepfunAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(stepfunAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await expect(stepfunAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });

  it('keeps provider 400 details for request debugging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { error: { message: 'n must be between 1 and 20' } })));

    await expect(stepfunAdapter.search('q', {}, 'sf-key')).rejects.toMatchObject({
      kind: 'provider',
      status: 400,
      message: expect.stringContaining('n must be between 1 and 20'),
    });
  });
});
