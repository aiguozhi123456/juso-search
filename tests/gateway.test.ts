import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProviderAdapter } from '@/lib/providers/types';
import { ProviderError } from '@/lib/providers/types';

vi.mock('@/lib/storage', () => ({
  getActiveProviderId: vi.fn(),
  getKey: vi.fn(),
}));

vi.mock('@/lib/providers/registry', () => ({
  getAdapter: vi.fn(),
}));

import { handleSearch, handleTestKey } from '@/lib/gateway';
import { getActiveProviderId, getKey } from '@/lib/storage';
import { getAdapter } from '@/lib/providers/registry';

const mockedGetActive = vi.mocked(getActiveProviderId);
const mockedGetKey = vi.mocked(getKey);
const mockedGetAdapter = vi.mocked(getAdapter);

function fakeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: 'tavily',
    label: 'Tavily',
    supportsAnswer: true,
    search: vi.fn().mockResolvedValue({ query: 'q', provider: 'tavily', results: [] }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('handleSearch', () => {
  it('routes to the active adapter and returns ok', async () => {
    const adapter = fakeAdapter();
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('tvly-k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch('hello');

    expect(mockedGetAdapter).toHaveBeenCalledWith('tavily');
    expect(adapter.search).toHaveBeenCalledWith('hello', {}, 'tvly-k');
    expect(reply.ok).toBe(true);
    if (reply.ok) expect(reply.response.provider).toBe('tavily');
  });

  it('returns keyMissing when no provider configured', async () => {
    mockedGetActive.mockResolvedValue(null);
    const reply = await handleSearch('q');
    expect(reply).toEqual({ ok: false, error: { kind: 'keyMissing', message: expect.any(String) } });
    expect(mockedGetKey).not.toHaveBeenCalled();
  });

  it('returns keyMissing when active provider has no key', async () => {
    mockedGetActive.mockResolvedValue('stepfun');
    mockedGetKey.mockResolvedValue(null);
    mockedGetAdapter.mockReturnValue(fakeAdapter({ id: 'stepfun', label: 'Stepfun 按量' }));
    const reply = await handleSearch('q');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('keyMissing');
  });

  it('maps a ProviderError to providerError', async () => {
    const adapter = fakeAdapter({
      search: vi.fn().mockRejectedValue(new ProviderError('unauthorized', 'bad key', 401)),
    });
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(adapter);

    const reply = await handleSearch('q');
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.kind).toBe('providerError');
      expect(reply.error.providerErrorKind).toBe('unauthorized');
    }
  });

  it('maps a generic error to unknown', async () => {
    mockedGetActive.mockResolvedValue('tavily');
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(fakeAdapter({ search: vi.fn().mockRejectedValue(new Error('boom')) }));
    const reply = await handleSearch('q');
    expect(reply.ok).toBe(false);
    if (!reply.ok) {
      expect(reply.error.kind).toBe('unknown');
      expect(reply.error.message).toBe('服务暂时不可用，请稍后重试');
    }
  });
});

describe('handleTestKey', () => {
  it('returns ok on a successful minimal query', async () => {
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(fakeAdapter());
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(true);
  });

  it('returns keyMissing when no key', async () => {
    mockedGetKey.mockResolvedValue(null);
    mockedGetAdapter.mockReturnValue(fakeAdapter());
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('keyMissing');
  });

  it('returns providerError on adapter failure', async () => {
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(
      fakeAdapter({ search: vi.fn().mockRejectedValue(new ProviderError('rateLimit', 'slow down', 429)) }),
    );
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('providerError');
  });

  it('coerces a generic error to providerError in testKey', async () => {
    mockedGetKey.mockResolvedValue('k');
    mockedGetAdapter.mockReturnValue(
      fakeAdapter({ search: vi.fn().mockRejectedValue(new Error('unexpected')) }),
    );
    const reply = await handleTestKey('tavily');
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.kind).toBe('providerError');
  });
});
