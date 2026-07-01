import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exaAdapter } from '@/lib/providers/exa';
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
});
