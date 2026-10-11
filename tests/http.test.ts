import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mapStatus, postJson } from '@/lib/providers/http';
import { res } from './helpers';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('mapStatus', () => {
  it('returns null for 2xx', () => {
    expect(mapStatus(200, 'X')).toBeNull();
  });

  it('maps 401 to unauthorized', () => {
    expect(mapStatus(401, 'X')?.kind).toBe('unauthorized');
  });

  it('maps 403 to unauthorized', () => {
    expect(mapStatus(403, 'X')?.kind).toBe('unauthorized');
  });

  it('maps 429 to rateLimit', () => {
    expect(mapStatus(429, 'X')?.kind).toBe('rateLimit');
  });

  it('maps 5xx to provider', () => {
    expect(mapStatus(502, 'X')?.kind).toBe('provider');
  });

  it('maps other 4xx to provider', () => {
    expect(mapStatus(422, 'X')?.kind).toBe('provider');
  });

  it('maps non-2xx below 400 (e.g. 304 via a caching proxy) to provider', () => {
    expect(mapStatus(304, 'X')?.kind).toBe('provider');
    expect(mapStatus(100, 'X')?.kind).toBe('provider');
  });

  it('appends a sanitized provider detail to status errors', () => {
    const err = mapStatus(400, 'Exa', 'Invalid outputSchema');
    expect(err?.message).toBe('Exa：HTTP 400: Invalid outputSchema');
  });

  it('extracts nested provider error details from non-2xx JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { detail: { error: 'Invalid request field' } })));

    const out = await postJson<unknown>('https://example.test/search', { body: '{}' });

    expect(out).toEqual({ status: 400, ok: false, errorDetail: 'Invalid request field' });
  });

  it('extracts validation messages from detail arrays', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { detail: [{ loc: ['body', 'query'], msg: 'Field required' }] })));

    const out = await postJson<unknown>('https://example.test/search', { body: '{}' });

    expect(out).toEqual({ status: 400, ok: false, errorDetail: 'Field required' });
  });

  it('returns no errorDetail when the body is JSON without a known error key (no raw-body leak)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { status: 'error', internal: '/srv/secret/path' })));

    const out = await postJson<unknown>('https://example.test/search', { body: '{}' });

    expect(out).toEqual({ status: 400, ok: false, errorDetail: undefined });
  });

  it.each([
    ['Brave X-Subscription-Token header form', 'X-Subscription-Token: abc123def', 'X-Subscription-Token: [redacted]'],
    ['access_token key=value form', 'invalid access_token=secret123 for user', 'invalid access_token=[redacted] for user'],
    ['query-string key= form', 'rejected key=abc123def', 'rejected key=[redacted]'],
    ['session id form', 'session_id=xyz789 expired', 'session_id=[redacted] expired'],
  ])('redacts %s', async (_name, raw, expected) => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, raw)));

    const out = await postJson<unknown>('https://example.test/search', { body: '{}' });

    expect(out).toEqual({ status: 400, ok: false, errorDetail: expected });
  });

  it('redacts Basic-scheme credentials echoed in the detail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, 'Authorization: Basic dXNlcjpwYXNz')));

    const out = await postJson<unknown>('https://example.test/search', { body: '{}' });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.errorDetail).toContain('[redacted]');
      expect(out.errorDetail).not.toContain('dXNlcjpwYXNz');
    }
  });

  it('rethrows caller-initiated abort instead of masking it as network', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
      return res(200, {});
    }));

    await expect(postJson('https://example.test/search', { body: '{}', signal: controller.signal }))
      .rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes an optional cancellation signal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => res(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await postJson<unknown>('https://example.test/search', { body: '{}', signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});
