import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isRerankConfigured,
  normalizeRerankConfig,
  RERANK_TIMEOUT_MS,
  rerankDocuments,
  RerankError,
  testRerank,
  validateRerankEndpoint,
  type RerankRequestBody,
} from '@/lib/aggregate/rerank-client';
import type { RerankConfig } from '@/lib/aggregate/types';
import { res } from './helpers';

const CONFIG: RerankConfig = { endpoint: 'http://127.0.0.1:8000/v1/rerank', model: 'bge-reranker-base', apiKey: 'sk-local' };

type FetchMock = ReturnType<typeof vi.fn>;

function installFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): FetchMock {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastBody(fetchMock: FetchMock): RerankRequestBody {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  return JSON.parse(String(init.body)) as RerankRequestBody;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('rerankDocuments: success (KTD14 protocol)', () => {
  it('posts the Cohere/Jina-style body and returns the server-ordered results', async () => {
    const fetchMock = installFetch(async () => res(200, { results: [{ index: 2, relevance_score: 0.95 }, { index: 0, relevance_score: 0.1 }] }));

    const out = await rerankDocuments(CONFIG, { query: 'q', documents: ['d0', 'd1', 'd2'], top_n: 2 });

    expect(out).toEqual([{ index: 2, relevance_score: 0.95 }, { index: 0, relevance_score: 0.1 }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CONFIG.endpoint);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: `Bearer ${CONFIG.apiKey}` });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(lastBody(fetchMock)).toEqual({ model: CONFIG.model, query: 'q', documents: ['d0', 'd1', 'd2'], top_n: 2 });
  });

  it('omits the Authorization header when no apiKey is configured (local servers)', async () => {
    const fetchMock = installFetch(async () => res(200, { results: [] }));

    await rerankDocuments({ endpoint: CONFIG.endpoint }, { query: 'q', documents: ['d'] });

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.stringify(init.headers)).not.toContain('Authorization');
  });

  it('uses the injected fetch wrapper (worker seams must pass (...args) => fetch(...args))', async () => {
    const injected = vi.fn(async () => res(200, { results: [] }));

    await rerankDocuments(CONFIG, { query: 'q', documents: ['d'] }, { fetch: injected });

    expect(injected).toHaveBeenCalledTimes(1);
  });
});

describe('rerankDocuments: error taxonomy (KTD6)', () => {
  it('throws keyMissing when the endpoint is not configured, without calling fetch', async () => {
    const fetchMock = installFetch(async () => res(200, { results: [] }));

    await expect(rerankDocuments({ endpoint: '' }, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'keyMissing' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps 401/403 to unauthorized', async () => {
    installFetch(async () => res(401, { detail: 'bad key' }));
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });
  });

  it('maps 429 to rateLimit', async () => {
    installFetch(async () => res(429, {}));
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'rateLimit', status: 429 });
  });

  it('maps 5xx and other 4xx to provider', async () => {
    installFetch(async () => res(502, {}));
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'provider', status: 502 });

    installFetch(async () => res(400, { detail: 'invalid documents' }));
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'provider', status: 400 });
  });

  it('maps a 2xx response with unparseable JSON to parse', async () => {
    installFetch(async () => ({ ok: true, status: 200, json: async () => { throw new Error('Unexpected token'); } } as unknown as Response));
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'parse' });
  });

  it.each([
    ['missing results', {}],
    ['non-array results', { results: 'nope' }],
    ['non-object top level', [1, 2]],
    ['entry missing index', { results: [{ relevance_score: 1 }] }],
    ['non-integer index', { results: [{ index: '0', relevance_score: 1 }] }],
    ['non-numeric score', { results: [{ index: 0, relevance_score: 'high' }] }],
  ])('maps malformed response shape (%s) to parse', async (_name, body) => {
    installFetch(async () => res(200, body));
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toBeInstanceOf(RerankError);
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'parse' });
  });

  it('maps a request-transport failure to network', async () => {
    installFetch(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'network' });
  });

  it('aborts after ~10s and reports a distinct timeout message (KTD6)', async () => {
    vi.useFakeTimers();
    installFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));

    const captured = rerankDocuments(CONFIG, { query: 'q', documents: ['d'] }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(RERANK_TIMEOUT_MS + 1);
    const err = await captured;

    expect(err).toBeInstanceOf(RerankError);
    expect((err as RerankError).kind).toBe('network');
    expect((err as RerankError).message).toMatch(/timed out/);
  });

  it('honors a caller signal abort as network', async () => {
    installFetch(async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      return res(200, { results: [] });
    });
    const controller = new AbortController();
    controller.abort();

    await expect(rerankDocuments(CONFIG, { query: 'q', documents: ['d'] }, { signal: controller.signal })).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('testRerank (KTD6 mini request)', () => {
  it('sends 1 query + 2 small documents over the same client', async () => {
    const fetchMock = installFetch(async () => res(200, { results: [{ index: 1, relevance_score: 0.5 }, { index: 0, relevance_score: 0.2 }] }));

    const out = await testRerank(CONFIG);

    expect(out).toHaveLength(2);
    const body = lastBody(fetchMock);
    expect(typeof body.query).toBe('string');
    expect(body.query.length).toBeGreaterThan(0);
    expect(body.documents).toHaveLength(2);
    expect(body.documents.every((d) => typeof d === 'string' && d.length > 0)).toBe(true);
    expect(body.top_n).toBe(2);
    expect(body.model).toBe(CONFIG.model);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(CONFIG.endpoint);
  });

  it('surfaces keyMissing for an unconfigured endpoint', async () => {
    installFetch(async () => res(200, { results: [] }));
    await expect(testRerank({ endpoint: '' })).rejects.toMatchObject({ kind: 'keyMissing' });
  });
});

describe('rerank config helpers', () => {
  it('isRerankConfigured keys off a non-empty endpoint only', () => {
    expect(isRerankConfigured(null)).toBe(false);
    expect(isRerankConfigured(undefined)).toBe(false);
    expect(isRerankConfigured({ endpoint: '' })).toBe(false);
    expect(isRerankConfigured({ endpoint: '   ' })).toBe(false);
    expect(isRerankConfigured({ endpoint: 'http://127.0.0.1:8000/v1/rerank' })).toBe(true);
  });

  it('normalizeRerankConfig applies the Default-by-Getter shape and drops empty optional strings', () => {
    expect(normalizeRerankConfig(undefined)).toEqual({ endpoint: '' });
    expect(normalizeRerankConfig('junk')).toEqual({ endpoint: '' });
    expect(normalizeRerankConfig({ endpoint: ' http://x ', model: '', apiKey: '' })).toEqual({ endpoint: 'http://x' });
    expect(normalizeRerankConfig({ endpoint: 'http://x', model: 'm', apiKey: 'k' })).toEqual({ endpoint: 'http://x', model: 'm', apiKey: 'k' });
  });
});

describe('validateRerankEndpoint (KTD12 whitelist: loopback + siliconflow cloud)', () => {
  it('accepts https api.siliconflow.cn and keeps host/path/query intact', () => {
    expect(validateRerankEndpoint('https://api.siliconflow.cn/v1/rerank'))
      .toEqual({ ok: true, endpoint: 'https://api.siliconflow.cn/v1/rerank', rewritten: false });
  });

  it('rejects other https hosts as not_loopback', () => {
    expect(validateRerankEndpoint('https://evil.example.com/v1/rerank')).toEqual({ ok: false, reason: 'not_loopback' });
    expect(validateRerankEndpoint('https://api.siliconflow.cn.evil.com/v1/rerank')).toEqual({ ok: false, reason: 'not_loopback' });
  });

  it('rejects plain-http siliconflow as not_loopback', () => {
    expect(validateRerankEndpoint('http://api.siliconflow.cn/v1/rerank')).toEqual({ ok: false, reason: 'not_loopback' });
  });
});
