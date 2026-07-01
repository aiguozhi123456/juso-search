import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getKey,
  setKey,
  getAllKeys,
  clearKey,
  getActiveProviderId,
  setActiveProviderId,
} from '@/lib/storage';

// 内存版 chrome.storage.local，仅实现 storage.ts 用到的 get(null)/set。
function installStorage(): void {
  const store = new Map<string, unknown>();
  vi.stubGlobal('browser', {
    storage: {
      local: {
        async get(keys: unknown) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          return {};
        },
        async set(items: Record<string, unknown>) {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
      },
    },
  });
}

beforeEach(() => {
  installStorage();
});

describe('storage: BYOK keys', () => {
  it('round-trips a key', async () => {
    await setKey('tavily', 'tvly-abc');
    expect(await getKey('tavily')).toBe('tvly-abc');
  });

  it('returns null for missing key', async () => {
    expect(await getKey('exa')).toBeNull();
  });

  it('getAllKeys returns configured map', async () => {
    await setKey('tavily', 'tvly-1');
    await setKey('stepfun', 'sf-2');
    expect(await getAllKeys()).toEqual({ tavily: 'tvly-1', stepfun: 'sf-2' });
  });

  it('clearKey removes only that provider', async () => {
    await setKey('tavily', 'tvly-1');
    await setKey('exa', 'exa-2');
    await clearKey('tavily');
    expect(await getKey('tavily')).toBeNull();
    expect(await getKey('exa')).toBe('exa-2');
  });
});

describe('storage: active provider', () => {
  it('defaults to null when nothing configured', async () => {
    expect(await getActiveProviderId()).toBeNull();
  });

  it('falls back to first configured provider (registry order)', async () => {
    // registry order: tavily, exa, stepfun, stepfun-plan
    await setKey('exa', 'exa-x');
    await setKey('stepfun', 'sf-x');
    expect(await getActiveProviderId()).toBe('exa');
  });

  it('explicit choice wins over fallback', async () => {
    await setKey('tavily', 'tvly-x');
    await setKey('exa', 'exa-x');
    await setActiveProviderId('exa');
    expect(await getActiveProviderId()).toBe('exa');
  });

  it('honors explicit choice even when that provider has no key (keyMissing path)', async () => {
    await setKey('tavily', 'tvly-x');
    await setActiveProviderId('stepfun');
    expect(await getActiveProviderId()).toBe('stepfun');
  });
});
