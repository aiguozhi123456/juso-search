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

  it('appends a sanitized provider detail to status errors', () => {
    const err = mapStatus(400, 'Exa', 'Invalid outputSchema');
    expect(err?.message).toBe('Exa：HTTP 400: Invalid outputSchema');
  });

  it('extracts nested provider error details from non-2xx JSON bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { detail: { error: 'Invalid request field' } })));

    const out = await postJson<unknown>('https://example.test/search', { body: '{}' });

    expect(out.status).toBe(400);
    expect(out.errorDetail).toBe('Invalid request field');
  });

  it('extracts validation messages from detail arrays', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => res(400, { detail: [{ loc: ['body', 'query'], msg: 'Field required' }] })));

    const out = await postJson<unknown>('https://example.test/search', { body: '{}' });

    expect(out.errorDetail).toBe('Field required');
  });

  it('passes an optional cancellation signal to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>(async () => res(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await postJson<unknown>('https://example.test/search', { body: '{}', signal: controller.signal });

    expect(fetchMock.mock.calls[0][1]).toMatchObject({ signal: controller.signal });
  });
});
