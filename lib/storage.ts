import type { ProviderId } from './providers/types';
import { allProviders } from './providers/registry';

// BYOK key 仅存 chrome.storage.local（R7 信任底线）。
// ⚠️ getKey 只应由 background service worker 调用；
//   搜索页/设置页不应直接读 key，仅由 worker 代理调 provider API。

const KEYS_KEY = 'providerKeys'; // Record<ProviderId, string>
const ACTIVE_KEY = 'activeProvider'; // ProviderId | null
const THEME_KEY = 'themePref'; // ThemePref
const LOCALE_KEY = 'localePref'; // LocalePref

export type ThemePref = 'auto' | 'light' | 'dark';
export type LocalePref = 'auto' | 'zh_CN' | 'en';

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

export async function getConfiguredProviderIds(): Promise<ProviderId[]> {
  const keys = await readKeys();
  return allProviders().filter((p) => keys[p.id]).map((p) => p.id);
}

/** 返回某 provider 的 key，未配置则 null。仅 worker 调用。 */
export async function getKey(id: ProviderId): Promise<string | null> {
  const keys = await readKeys();
  return keys[id] ?? null;
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
  const keys = await readKeys();
  if (isKnownProvider(stored) && keys[stored]) return stored;
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

/** UI 语言偏好：auto（跟随浏览器 UI 语言，默认）/ zh_CN / en。
 *  仅读 LOCALE_KEY，不 get(null)（与 themePref 同样的 key 卫生原则）。 */
export async function getLocalePref(): Promise<LocalePref> {
  const got = await browser.storage.local.get(LOCALE_KEY);
  const stored = got[LOCALE_KEY];
  return stored === 'zh_CN' || stored === 'en' ? stored : 'auto';
}

export async function setLocalePref(pref: LocalePref): Promise<void> {
  await browser.storage.local.set({ [LOCALE_KEY]: pref });
}
