import { describe, it, expect, beforeEach, vi } from 'vitest';
import { anysearchAdapter } from '@/lib/providers/anysearch';
import { ProviderError } from '@/lib/providers/types';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('anysearchAdapter', () => {
  it('maps a results payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        res(200, {
          code: 0,
          message: 'success',
          request_id: '7d6f4e91-2a83-4c5b-9f10-6e8a3d27b541',
          data: {
            results: [
              {
                title: 'Go 1.26 Release Notes',
                url: 'https://go.dev/doc/go1.26',
                snippet: 'Introduction to the changes in Go 1.26.',
                content: 'Go 1.26 introduces changes to the language and toolchain.',
              },
              { title: '', url: 'https://empty-title.com' },
            ],
            metadata: { total_results: 2, search_time_ms: 312 },
          },
        }),
      ),
    );
    const out = await anysearchAdapter.search('q', {}, 'as-x');
    expect(out.provider).toBe('anysearch');
    expect(out.answer).toBeUndefined();
    expect(out.results[0]).toMatchObject({
      title: 'Go 1.26 Release Notes',
      url: 'https://go.dev/doc/go1.26',
      snippet: 'Introduction to the changes in Go 1.26.',
      content: 'Go 1.26 introduces changes to the language and toolchain.',
    });
    // title 可为空串：回退 url；snippet/content 可省略。
    expect(out.results[1]).toMatchObject({
      title: 'https://empty-title.com',
      url: 'https://empty-title.com',
      snippet: '',
    });
    expect(out.results[1].content).toBeUndefined();
  });

  it('sends Bearer auth and request body with max_results clamped to the upstream cap of 10', async () => {
    const fetchMock = vi.fn(async () => res(200, { code: 0, data: { results: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    await anysearchAdapter.search('hello', { maxResults: 20 }, 'as-abc');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.anysearch.com/v1/search');
    expect(init.headers.Authorization).toBe('Bearer as-abc');
    const body = JSON.parse(init.body);
    expect(body.query).toBe('hello');
    expect(body.max_results).toBe(10);
  });

  it('throws a provider error on HTTP 200 with a non-zero business code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(200, { code: -1, message: 'Query is required.', request_id: 'x' })),
    );
    await expect(anysearchAdapter.search('q', {}, 'k')).rejects.toBeInstanceOf(ProviderError);
    await expect(anysearchAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'provider' });
  });

  it('maps 401 to unauthorized ProviderError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(401, { code: -1, message: 'Invalid API key.' })));
    await expect(anysearchAdapter.search('q', {}, 'bad')).rejects.toBeInstanceOf(ProviderError);
    await expect(anysearchAdapter.search('q', {}, 'bad')).rejects.toMatchObject({ kind: 'unauthorized' });
  });

  it('maps 429 to rateLimit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(429, { code: -1, message: 'rate limited' })));
    await expect(anysearchAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'rateLimit' });
  });

  it('maps network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network');
      }),
    );
    await expect(anysearchAdapter.search('q', {}, 'k')).rejects.toMatchObject({ kind: 'network' });
  });

  // ── 免 key 免费层（官方匿名层，IP 限速/限额）──
  it('declares keyOptional and omits Authorization on an empty key', async () => {
    const fetchMock = vi.fn(async () => res(200, { code: 0, data: { results: [{ title: 'A', url: 'https://a.com', snippet: 's' }] } }));
    vi.stubGlobal('fetch', fetchMock);
    expect(anysearchAdapter.keyOptional).toBe(true);
    const out = await anysearchAdapter.search('q', {}, '');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
    expect(init.headers.Authorization).toBeUndefined();
    expect(out.results[0]?.url).toBe('https://a.com');
  });

  it('maps an anonymous 402 to rateLimit with a dedicated message and never echoes the credential body', async () => {
    // 402 响应体含上游自动注册的凭证（api_key 等）——特判必须丢弃 detail，绝不透传。
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => res(402, { code: 402, message: 'anonymous quota exceeded', api_key: 'sk-generated-secret' })),
    );
    let caught: unknown;
    try {
      await anysearchAdapter.search('q', {}, '');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const err = caught as ProviderError;
    expect(err.kind).toBe('rateLimit');
    expect(err.message).toContain('AnySearch');
    expect(err.message).not.toContain('sk-generated-secret');
    expect(err.message).not.toContain('anonymous quota exceeded');
  });

  it('keeps the default provider mapping for a keyed 402', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(402, { code: 402, message: 'payment required' })));
    await expect(anysearchAdapter.search('q', {}, 'as-x')).rejects.toMatchObject({ kind: 'provider' });
  });
});
