import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getKey,
  setKey,
  clearKey,
  hasKey,
  getActiveProviderId,
  setActiveProviderId,
  getThemePref,
  setThemePref,
} from '@/lib/storage';

// 内存版 chrome.storage.local，实现 storage.ts 用到的 get(null)/get(key)/set。
function installStorage(): void {
  const store = new Map<string, unknown>();
  vi.stubGlobal('browser', {
    storage: {
      local: {
        async get(keys: unknown) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          if (typeof keys === 'string') {
            return store.has(keys) ? { [keys]: store.get(keys) } : {};
          }
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

  it('hasKey reports whether a provider has a key', async () => {
    await setKey('tavily', 'tvly-1');
    await setKey('stepfun', 'sf-2');
    expect(await hasKey('tavily')).toBe(true);
    expect(await hasKey('exa')).toBe(false);
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

  it('falls back to first configured when stored active id is invalid', async () => {
    // 直接向 mock 存储写一个不存在的 provider id
    await browser.storage.local.set({ activeProvider: 'nonexistent' });
    await setKey('exa', 'exa-x');
    expect(await getActiveProviderId()).toBe('exa');
  });

  it('setActiveProviderId(null) falls back to first configured', async () => {
    await setKey('exa', 'exa-x');
    await setActiveProviderId('exa');
    expect(await getActiveProviderId()).toBe('exa');
    await setActiveProviderId(null);
    expect(await getActiveProviderId()).toBe('exa');
  });
});

describe('storage: theme pref', () => {
  it('defaults to auto', async () => {
    expect(await getThemePref()).toBe('auto');
  });

  it('round-trips explicit prefs', async () => {
    await setThemePref('dark');
    expect(await getThemePref()).toBe('dark');
    await setThemePref('light');
    expect(await getThemePref()).toBe('light');
    await setThemePref('auto');
    expect(await getThemePref()).toBe('auto');
  });

  it('rejects unknown stored values, falling back to auto', async () => {
    await browser.storage.local.set({ themePref: 'neon' });
    expect(await getThemePref()).toBe('auto');
  });
});
