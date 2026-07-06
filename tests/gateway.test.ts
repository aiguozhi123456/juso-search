import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ProviderAdapter } from '@/lib/providers/types';
import { ProviderError } from '@/lib/providers/types';

vi.mock('@/lib/storage', () => ({
  getActiveProviderId: vi.fn(),
  getConfiguredProviderIds: vi.fn(),
  getKey: vi.fn(),
  setActiveProviderId: vi.fn(),
  setKey: vi.fn(),
}));

vi.mock('@/lib/providers/registry', () => ({
  getAdapter: vi.fn(),
}));

import { handleGetProviderConfig, handleSaveProviderKey, handleSearch, handleSetActiveProvider, handleTestKey } from '@/lib/gateway';
import { getActiveProviderId, getConfiguredProviderIds, getKey, setActiveProviderId, setKey } from '@/lib/storage';
import { getAdapter } from '@/lib/providers/registry';

const mockedGetActive = vi.mocked(getActiveProviderId);
const mockedGetConfigured = vi.mocked(getConfiguredProviderIds);
const mockedGetKey = vi.mocked(getKey);
const mockedSetActive = vi.mocked(setActiveProviderId);
const mockedSetKey = vi.mocked(setKey);
const mockedGetAdapter = vi.mocked(getAdapter);

function fakeAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id: 'tavily',
    label: 'provider_tavily', // i18n 消息名（不再是显示串）
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
    mockedGetAdapter.mockReturnValue(fakeAdapter({ id: 'stepfun', label: 'provider_stepfun' }));
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
      expect(reply.error.message).toBe('服务暂时不可用，请稍后重试'); // i18n 真实查表（默认 zh_CN）
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

describe('handleGetProviderConfig', () => {
  it('returns configured provider ids and active provider without keys', async () => {
    mockedGetConfigured.mockResolvedValue(['tavily', 'exa']);
    mockedGetActive.mockResolvedValue('exa');

    await expect(handleGetProviderConfig()).resolves.toEqual({
      configuredProviderIds: ['tavily', 'exa'],
      activeProviderId: 'exa',
    });
  });
});

describe('handleSaveProviderKey', () => {
  it('writes provider keys from the worker context', async () => {
    mockedSetKey.mockResolvedValue(undefined);

    await handleSaveProviderKey('tavily', 'tvly-abc');

    expect(mockedSetKey).toHaveBeenCalledWith('tavily', 'tvly-abc');
  });
});

describe('handleSetActiveProvider', () => {
  it('writes the active provider from the worker context', async () => {
    mockedSetActive.mockResolvedValue(undefined);

    await handleSetActiveProvider('exa');

    expect(mockedSetActive).toHaveBeenCalledWith('exa');
  });
});
