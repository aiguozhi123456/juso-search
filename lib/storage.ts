import type { ProviderId } from './providers/types';
import { allProviders } from './providers/registry';

// BYOK key 仅存 chrome.storage.local（R7 信任底线）。
// ⚠️ getKey/getAllKeys 只应由 background service worker 调用；
//   搜索页/设置页不应直接读 key，仅由 worker 代理调 provider API。

const KEYS_KEY = 'providerKeys'; // Record<ProviderId, string>
const ACTIVE_KEY = 'activeProvider'; // ProviderId | null

async function readAll(): Promise<Record<string, unknown>> {
  return browser.storage.local.get(null) as Promise<Record<string, unknown>>;
}

async function readKeys(): Promise<Record<string, string>> {
  const all = await readAll();
  return (all[KEYS_KEY] ?? {}) as Record<string, string>;
}

/** 返回某 provider 的 key，未配置则 null。仅 worker 调用。 */
export async function getKey(id: ProviderId): Promise<string | null> {
  const keys = await readKeys();
  return keys[id] ?? null;
}

export async function getAllKeys(): Promise<Partial<Record<ProviderId, string>>> {
  return readKeys() as Partial<Record<ProviderId, string>>;
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
 * 有效激活 provider：显式选择优先；否则回退到首个已配 key 的 provider；都没有则 null。
 * 切换只影响后续查询（R3）。
 */
export async function getActiveProviderId(): Promise<ProviderId | null> {
  const all = await readAll();
  const stored = all[ACTIVE_KEY] as ProviderId | null | undefined;
  if (stored) return stored;
  const keys = await readKeys();
  return allProviders().find((p) => keys[p.id])?.id ?? null;
}

export async function setActiveProviderId(id: ProviderId | null): Promise<void> {
  await browser.storage.local.set({ [ACTIVE_KEY]: id });
}
