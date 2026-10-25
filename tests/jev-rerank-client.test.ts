import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  JEV_DEFAULT_MODEL,
  normalizeRerankConfig,
  partitionJevChunks,
  RERANK_JEV_TIMEOUT_MS,
  RERANK_TIMEOUT_MS,
  rerankDocuments,
  RerankError,
  testRerank,
  validateRerankEndpoint,
} from '@/lib/aggregate/rerank-client';
import type { RerankConfig } from '@/lib/aggregate/types';
import { res } from './helpers';

// jev 协议（TypeSafe SystemOne，protocol: 'jev'）：listwise 线格式 / 响应收紧 / 分块拆分重试 / 30s 超时。

const JEV_CONFIG: RerankConfig = { endpoint: 'https://api.typesafe.ai/v1/systemone', apiKey: 'ts-key', protocol: 'jev' };

type FetchMock = ReturnType<typeof vi.fn>;

function installFetch(impl: (url: string, init?: RequestInit) => Promise<Response>): FetchMock {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** jev 成功响应构造：answers 键 = doc_0..doc_N-1。 */
function jevOk(scores: number[]): unknown {
  return { answers: Object.fromEntries(scores.map((score, i) => [`doc_${i}`, { type: 'noul', noul: score }])) };
}

/** 取最近一次请求的 SystemOne 请求体。 */
function lastJevBody(fetchMock: FetchMock): {
  model: string;
  state: { query: string; documents: Record<string, string> };
  questions: Record<string, { type: string; instructions: string; criteria: Record<string, string> }>;
  top_n?: unknown;
} {
  const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
  return JSON.parse(String(init.body));
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('validateRerankEndpoint: typesafe cloud branch (jev)', () => {
  it('accepts https api.typesafe.ai and keeps host/path intact', () => {
    expect(validateRerankEndpoint('https://api.typesafe.ai/v1/systemone'))
      .toEqual({ ok: true, endpoint: 'https://api.typesafe.ai/v1/systemone', rewritten: false });
  });

  it('rejects plain-http typesafe, lookalike hosts and other https hosts', () => {
    expect(validateRerankEndpoint('http://api.typesafe.ai/v1/systemone')).toEqual({ ok: false, reason: 'not_loopback' });
    expect(validateRerankEndpoint('https://api.typesafe.cn.evil.com/v1/systemone')).toEqual({ ok: false, reason: 'not_loopback' });
    expect(validateRerankEndpoint('https://typesafe.ai/v1/systemone')).toEqual({ ok: false, reason: 'not_loopback' });
  });
});

describe('normalizeRerankConfig: protocol normalization', () => {
  it("keeps 'jev' only — anything else falls back to the cohere default (zero migration for old data)", () => {
    expect(normalizeRerankConfig({ endpoint: 'http://x', protocol: 'jev' })).toEqual({ endpoint: 'http://x', protocol: 'jev' });
    expect(normalizeRerankConfig({ endpoint: 'http://x', protocol: 'cohere' })).toEqual({ endpoint: 'http://x' });
    expect(normalizeRerankConfig({ endpoint: 'http://x', protocol: 'gpt' })).toEqual({ endpoint: 'http://x' });
    expect(normalizeRerankConfig({ endpoint: 'http://x' })).toEqual({ endpoint: 'http://x' });
  });
});

describe('rerankDocuments: jev protocol request shape', () => {
  it('posts the SystemOne listwise body (model default jev-latest, shared state, one noul question per doc)', async () => {
    const fetchMock = installFetch(async () => res(200, jevOk([0.87, 0.12])));

    const out = await rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d0', 'd1'], top_n: 1 });

    expect(out).toEqual([{ index: 0, relevance_score: 0.87 }, { index: 1, relevance_score: 0.12 }]);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(JEV_CONFIG.endpoint);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json', Authorization: 'Bearer ts-key' });
    const body = lastJevBody(fetchMock);
    expect(body.model).toBe(JEV_DEFAULT_MODEL);
    expect(body.state).toEqual({ query: 'q', documents: { doc_0: 'd0', doc_1: 'd1' } });
    expect(Object.keys(body.questions)).toEqual(['doc_0', 'doc_1']);
    expect(body.questions.doc_1).toMatchObject({ type: 'noul' });
    expect(body.questions.doc_1.instructions).toContain('`documents.doc_1`');
    expect(body.questions.doc_1.criteria.true.length).toBeGreaterThan(0);
    expect(body.questions.doc_1.criteria.false.length).toBeGreaterThan(0);
    // SystemOne 无 top_n 参数：调用方的 top_n 被 jev 路径忽略（topN 截断在 applyRerankOrdering）。
    expect('top_n' in body).toBe(false);
  });

  it('sends an explicit model when configured and omits Authorization without a key', async () => {
    const fetchMock = installFetch(async () => res(200, jevOk([0.5])));

    await rerankDocuments({ endpoint: JEV_CONFIG.endpoint, model: 'jev-latest', protocol: 'jev' }, { query: 'q', documents: ['d'] });

    expect(lastJevBody(fetchMock).model).toBe('jev-latest');
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.stringify(init.headers)).not.toContain('Authorization');
  });

  it('uses the injected fetch wrapper on the jev path too', async () => {
    const injected = vi.fn(async () => res(200, jevOk([0.5])));
    await rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d'] }, { fetch: injected });
    expect(injected).toHaveBeenCalledTimes(1);
  });
});

describe('rerankDocuments: jev response validation (parse taxonomy)', () => {
  it.each([
    ['missing answers', {}],
    ['non-object answers', { answers: 'nope' }],
    ['unexpected extra key', { answers: { doc_0: { type: 'noul', noul: 0.5 }, doc_X: { type: 'noul', noul: 0.5 } } }],
    ['missing entry', { answers: { doc_0: { type: 'noul', noul: 0.5 } } }],
    ['wrong answer type', { answers: { doc_0: { type: 'score', noul: 0.5 } } }],
    ['out-of-range noul', { answers: { doc_0: { type: 'noul', noul: 1.5 } } }],
    ['negative noul', { answers: { doc_0: { type: 'noul', noul: -0.1 } } }],
    ['non-numeric noul', { answers: { doc_0: { type: 'noul', noul: 'high' } } }],
  ])('maps malformed jev response (%s) to parse', async (_name, body) => {
    installFetch(async () => res(200, body));
    await expect(rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d0', 'd1'] })).rejects.toMatchObject({ kind: 'parse' });
  });

  it('maps 401/429/5xx through the shared status mapping', async () => {
    installFetch(async () => res(401, { detail: 'bad key' }));
    await expect(rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'unauthorized', status: 401 });

    installFetch(async () => res(429, {}));
    await expect(rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'rateLimit', status: 429 });

    installFetch(async () => res(502, {}));
    await expect(rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d'] })).rejects.toMatchObject({ kind: 'provider', status: 502 });
  });

  it('maps a plain 400 (not max_tokens_exceeded) straight to provider without retrying', async () => {
    const fetchMock = installFetch(async () => res(400, { detail: 'invalid questions' }));
    await expect(rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d0', 'd1'] })).rejects.toMatchObject({ kind: 'provider', status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('rerankDocuments: jev chunking and max_tokens_exceeded split-retry', () => {
  it('partitions by doc count and char budget', () => {
    expect(partitionJevChunks(Array.from({ length: 45 }, (_, i) => `d${i}`)).map((c) => c.length)).toEqual([20, 20, 5]);
    const long = ['x'.repeat(9000), 'y'.repeat(9000), 'z'.repeat(9000)];
    expect(partitionJevChunks(long).map((c) => c.length)).toEqual([2, 1]);
  });

  it('scores chunked documents sequentially and maps scores back to global indices', async () => {
    const fetchMock = installFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
      return res(200, jevOk(Object.keys(body.questions).map(() => 0.5)));
    });

    const out = await rerankDocuments(JEV_CONFIG, { query: 'q', documents: Array.from({ length: 25 }, (_, i) => `d${i}`) });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(out).toHaveLength(25);
    expect(out[0]).toEqual({ index: 0, relevance_score: 0.5 });
    expect(out[20]).toEqual({ index: 20, relevance_score: 0.5 });
    expect(out[24]).toEqual({ index: 24, relevance_score: 0.5 });
  });

  it('splits a chunk in half and retries on max_tokens_exceeded (400/422 detail.error_type)', async () => {
    // 3 文档对半 = [0]（1 doc）+ [1,2]（2 docs），两半并行发出。
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(res(400, { detail: { error_type: 'max_tokens_exceeded', message: 'too big' } }))
      .mockResolvedValueOnce(res(200, jevOk([0.5])))
      .mockResolvedValueOnce(res(200, jevOk([0.9, 0.1])));
    vi.stubGlobal('fetch', fetchMock);

    const out = await rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d0', 'd1', 'd2'] });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(out).toEqual([{ index: 0, relevance_score: 0.5 }, { index: 1, relevance_score: 0.9 }, { index: 2, relevance_score: 0.1 }]);
  });

  it('gives up as provider when a single document still exceeds the context budget', async () => {
    installFetch(async () => res(422, { detail: { error_type: 'max_tokens_exceeded', message: 'too big' } }));
    await expect(rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['only'] })).rejects.toMatchObject({ kind: 'provider', status: 422 });
  });
});

describe('rerankDocuments: jev timeout and cancellation', () => {
  it('waits ~30s (not the 10s cohere budget) before timing out', async () => {
    vi.useFakeTimers();
    installFetch((_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    }));

    let settled = false;
    const captured = rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d'] })
      .catch((e: unknown) => e)
      .then((v) => { settled = true; return v; });

    await vi.advanceTimersByTimeAsync(RERANK_TIMEOUT_MS + 1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(RERANK_JEV_TIMEOUT_MS - RERANK_TIMEOUT_MS);
    const err = await captured;
    expect(err).toBeInstanceOf(RerankError);
    expect((err as RerankError).kind).toBe('network');
    expect((err as RerankError).message).toMatch(/timed out/);
  });

  it('honors a caller signal abort as network on the jev path', async () => {
    installFetch(async (_url, init) => {
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      return res(200, jevOk([0.5]));
    });
    const controller = new AbortController();
    controller.abort();

    await expect(rerankDocuments(JEV_CONFIG, { query: 'q', documents: ['d'] }, { signal: controller.signal })).rejects.toMatchObject({ kind: 'network' });
  });
});

describe('testRerank: jev protocol', () => {
  it('sends the mini 2-document listwise request over the SystemOne body', async () => {
    const fetchMock = installFetch(async () => res(200, jevOk([0.5, 0.2])));

    const out = await testRerank(JEV_CONFIG);

    expect(out).toHaveLength(2);
    const body = lastJevBody(fetchMock);
    expect(Object.keys(body.state.documents)).toEqual(['doc_0', 'doc_1']);
    expect(body.model).toBe(JEV_DEFAULT_MODEL);
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(JEV_CONFIG.endpoint);
  });
});
