import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exaAdapter, normalizeExaSettings, DEFAULT_EXA_SETTINGS } from '@/lib/providers/exa';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('exaAdapter', () => {
  it('maps output.content + grounding into answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          results: [{ title: 'A', url: 'https://a.com', text: 'full text A', highlights: ['h1', 'h2'], publishedDate: '2026-01-01T00:00:00Z' }],
          output: {
            content: 'Synthesized answer.',
            grounding: [
              { citations: [{ url: 'https://a.com', title: 'A' }, { url: 'https://a.com', title: 'dup' }] },
              { citations: [{ url: 'https://b.com', title: 'B' }] },
            ],
          },
        }),
      ),
    );
    const out = await exaAdapter.search('q', {}, 'exa-key');
    expect(out.provider).toBe('exa');
    expect(out.answer?.text).toBe('Synthesized answer.');
    // dedupe by url
    expect(out.answer?.citations).toEqual([
      { url: 'https://a.com', title: 'A' },
      { url: 'https://b.com', title: 'B' },
    ]);
    expect(out.results[0]).toMatchObject({
      title: 'A',
      url: 'https://a.com',
      snippet: 'h1 … h2',
      content: 'full text A',
      publishedDate: '2026-01-01T00:00:00Z',
    });
  });

  it('answer undefined when output absent (results-only)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200, { results: [{ url: 'https://a.com', highlights: ['x'] }] })),
    );
    const out = await exaAdapter.search('q', {}, 'k');
    expect(out.answer).toBeUndefined();
    expect(out.results[0].snippet).toBe('x');
    expect(out.results[0].title).toBe('https://a.com'); // falls back to url
  });

  it('sends x-api-key header and outputSchema', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await exaAdapter.search('q', { maxResults: 4 }, 'exa-key');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.exa.ai/search');
    expect(init.headers['x-api-key']).toBe('exa-key');
    const body = JSON.parse(init.body);
    expect(body.numResults).toBe(4);
    expect(body.outputSchema).toEqual({ type: 'text', description: expect.any(String) });
    expect(body.contents).toEqual({ text: true, highlights: true });
  });

  it('falls back to results as citations when grounding is absent', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(200, {
      results: [{ title: 'A', url: 'https://a.com', highlights: ['x'] }],
      output: { content: 'Ans' },
    })));
    const out = await exaAdapter.search('q', {}, 'k');
    expect(out.answer?.citations).toEqual([{ url: 'https://a.com', title: 'A' }]);
  });

  it('maps network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }));
    await expect(exaAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });

  it('maps 401 to unauthorized', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, {})));
    await expect(exaAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(exaAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('keeps provider 400 details for request debugging', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { message: 'Invalid outputSchema' })));

    await expect(exaAdapter.search('q', {}, 'exa-key')).rejects.toMatchObject({
      kind: 'provider',
      status: 400,
      message: expect.stringContaining('Invalid outputSchema'),
    });
  });

  it('applies providerSettings from opts', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    // numResults 已从 Exa 实例选项移除：遗留持久化里的 numResults 被 normalize 忽略，
    // 结果条数只由 opts.maxResults 决定（未传时用适配器默认 8）。
    await exaAdapter.search('q', {
      providerSettings: {
        searchType: 'fast',
        category: 'news',
        numResults: 15,
        includeDomains: ['example.com', 'test.org'],
        excludeDomains: ['spam.com'],
        textMaxCharacters: 2000,
        highlightsMaxCharacters: 500,
      },
    }, 'exa-key');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.type).toBe('fast');
    expect(body.category).toBe('news');
    expect(body.numResults).toBe(8);
    expect(body.includeDomains).toEqual(['example.com', 'test.org']);
    expect(body.excludeDomains).toEqual(['spam.com']);
    expect(body.contents.text).toEqual({ maxCharacters: 2000 });
    expect(body.contents.highlights).toEqual({ maxCharacters: 500 });
  });

  it('omits category/domains when empty and uses default contents', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await exaAdapter.search('q', { providerSettings: {} }, 'exa-key');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    const body = JSON.parse(init.body);
    expect(body.type).toBe('auto');
    expect(body.numResults).toBe(8);
    expect(body.category).toBeUndefined();
    expect(body.includeDomains).toBeUndefined();
    expect(body.excludeDomains).toBeUndefined();
    expect(body.contents).toEqual({ text: true, highlights: true });
  });

  it('maxResults override works: opts.maxResults lands in the body, default is 8 when unset', async () => {
    const fetchMock = vi.fn(async () => res(200, { results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    // 遗留实例选项里的 numResults 不再参与结果条数：maxResults 是唯一入口。
    await exaAdapter.search('q', { maxResults: 3, providerSettings: { numResults: 20 } }, 'exa-key');
    let [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).numResults).toBe(3);

    fetchMock.mockClear();
    await exaAdapter.search('q', {}, 'exa-key');
    [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: string }];
    expect(JSON.parse(init.body).numResults).toBe(8);
  });
});

describe('normalizeExaSettings', () => {
  it('returns defaults for null/undefined/garbage', () => {
    expect(normalizeExaSettings(null)).toEqual(DEFAULT_EXA_SETTINGS);
    expect(normalizeExaSettings(undefined)).toEqual(DEFAULT_EXA_SETTINGS);
    expect(normalizeExaSettings('garbage')).toEqual(DEFAULT_EXA_SETTINGS);
    expect(normalizeExaSettings(42)).toEqual(DEFAULT_EXA_SETTINGS);
  });

  it('clamps out-of-range values', () => {
    const s = normalizeExaSettings({ textMaxCharacters: -5, highlightsMaxCharacters: 99999 });
    expect(s.textMaxCharacters).toBeNull();
    expect(s.highlightsMaxCharacters).toBeNull();
  });

  it('ignores unknown persisted fields like numResults (no migration needed)', () => {
    const s = normalizeExaSettings({ numResults: 999, searchType: 'auto' });
    expect(s).toEqual(DEFAULT_EXA_SETTINGS);
  });

  it('filters invalid domains and trims', () => {
    const s = normalizeExaSettings({ includeDomains: ['a.com', '', '  ', 'b.com'], excludeDomains: 'not-array' });
    expect(s.includeDomains).toEqual(['a.com', 'b.com']);
    expect(s.excludeDomains).toEqual([]);
  });

  it('rejects unknown searchType and category', () => {
    const s = normalizeExaSettings({ searchType: 'turbo', category: 'linkedin' });
    expect(s.searchType).toBe('auto');
    expect(s.category).toBe('');
  });
});
