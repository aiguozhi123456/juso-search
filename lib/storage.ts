import type { ProviderId } from './providers/types';
import { allProviders } from './providers/registry';

// BYOK key 仅存 chrome.storage.local（R7 信任底线）。
// ⚠️ getKey 只应由 background service worker 调用；
//   搜索页/设置页不应直接读 key，仅由 worker 代理调 provider API。

const KEYS_KEY = 'providerKeys'; // Record<ProviderId, string>
const ACTIVE_KEY = 'activeProvider'; // ProviderId | null
const THEME_KEY = 'themePref'; // ThemePref

export type ThemePref = 'auto' | 'light' | 'dark';

async function readAll(): Promise<Record<string, unknown>> {
  return browser.storage.local.get(null) as Promise<Record<string, unknown>>;
}

async function readKeys(): Promise<Record<string, string>> {
  const all = await readAll();
  return (all[KEYS_KEY] ?? {}) as Record<string, string>;
}

function isKnownProvider(id: unknown): id is ProviderId {
  return typeof id === 'string' && allProviders().some((p) => p.id === id);
}

/** 返回某 provider 的 key，未配置则 null。仅 worker 调用。 */
export async function getKey(id: ProviderId): Promise<string | null> {
  const keys = await readKeys();
  return keys[id] ?? null;
}

/** 是否已配置某 provider 的 key（不回显明文，供设置页指示用）。 */
export async function hasKey(id: ProviderId): Promise<boolean> {
  const keys = await readKeys();
  return Boolean(keys[id]);
}

export async function setKey(id: ProviderId, key: string): Promise<void> {
  const keys = await readKeys();
  keys[id] = key;
  await browser.storage.local.set({ [KEYS_KEY]: keys });
}

export async function clearKey(id: ProviderId): Promise<void> {
  const keys = await readKeys();
  delete keys[id];
  await browser.storage.local.set({ [KEYS_KEY]: keys });
}

/**
 * 有效激活 provider：显式选择优先（须为已知 provider）；否则回退到首个已配 key 的 provider；
 * 都没有则 null。切换只影响后续查询（R3）。
 */
export async function getActiveProviderId(): Promise<ProviderId | null> {
  const all = await readAll();
  const stored = all[ACTIVE_KEY];
  if (isKnownProvider(stored)) return stored;
  const keys = await readKeys();
  return allProviders().find((p) => keys[p.id])?.id ?? null;
}

export async function setActiveProviderId(id: ProviderId | null): Promise<void> {
  await browser.storage.local.set({ [ACTIVE_KEY]: id });
}

/** 主题偏好：auto（跟随系统，默认）/ light / dark。
 *  仅读 THEME_KEY，不 get(null)，避免把 BYOK providerKeys 读入页面内存（R7 信任底线）。 */
export async function getThemePref(): Promise<ThemePref> {
  const got = await browser.storage.local.get(THEME_KEY);
  const stored = got[THEME_KEY];
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export async function setThemePref(pref: ThemePref): Promise<void> {
  await browser.storage.local.set({ [THEME_KEY]: pref });
}
