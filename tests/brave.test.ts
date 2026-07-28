import { describe, it, expect, beforeEach, vi } from 'vitest';
import { braveAdapter } from '@/lib/providers/brave';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('braveAdapter', () => {
  it('sends an authenticated GET request with Brave query parameters and caps count', async () => {
    const fetchMock = vi.fn(async () => res(200, { web: { results: [] } }));
    vi.stubGlobal('fetch', fetchMock);

    await braveAdapter.search('cats & dogs', { maxResults: 30 }, 'brave-key');

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string> }];
    expect(url).toBe('https://api.search.brave.com/res/v1/web/search?q=cats+%26+dogs&count=20&result_filter=web&text_decorations=false');
    expect(init.method).toBe('GET');
    expect(init.headers).toMatchObject({ 'X-Subscription-Token': 'brave-key', Accept: 'application/json' });
  });

  it('normalizes web results and uses snippets only when description is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      web: { results: [
        { title: 'Title', url: 'https://a.example', description: 'Description', extra_snippets: ['ignored'] },
        { url: 'https://b.example', extra_snippets: ['one', 'two'] },
      ] },
    })));

    const out = await braveAdapter.search('q', {}, 'key');
    expect(out).toMatchObject({ provider: 'brave', results: [
      { title: 'Title', url: 'https://a.example', snippet: 'Description' },
      { title: 'https://b.example', url: 'https://b.example', snippet: 'one … two' },
    ] });
    expect(out.answer).toBeUndefined();
  });

  it('maps network and authorization errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await expect(braveAdapter.search('q', {}, 'key')).rejects.toMatchObject({ kind: 'network' });

    vi.stubGlobal('fetch', vi.fn(async () => res(401, {})));
    await expect(braveAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(braveAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });
});
