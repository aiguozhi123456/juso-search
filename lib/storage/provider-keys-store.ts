import type { ProviderId } from '../providers/types';
import { allProviders } from '../providers/registry';
import { normalizeSourceHidden, normalizeSourceOrder } from '../sources';
import { normalizeSiteEngineDefinitions } from '../site-engines';
import { normalizeCustomEngineDefinitions } from '../custom-engines';
import { normalizeProviderInstances } from '../provider-instances';
import { KEYS_KEY, MAX_RESULTS_KEY, PROVIDER_INSTANCES_KEY, SITE_ENGINES_KEY, SOURCE_HIDDEN_KEY, SOURCE_ORDER_KEY, CUSTOM_ENGINES_KEY } from './keys';
import { ensureVisibleUsable } from './shared';
import { withSourceMutation } from './source-graph-store';

// providerKeys 的读改写串行队列：setKey/clearKey/mergeImport 共用，避免并发写丢失。
let providerKeysMutationQueue: Promise<unknown> = Promise.resolve();

/** 串行化 providerKeys 的读改写（setKey / clearKey / mergeImport），防止并发写覆盖。 */
export function withProviderKeysMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const run = providerKeysMutationQueue.then(mutation, mutation);
  providerKeysMutationQueue = run.catch(() => undefined);
  return run;
}

async function readKeys(): Promise<Record<string, string>> {
  const got = await browser.storage.local.get(KEYS_KEY);
  return (got[KEYS_KEY] ?? {}) as Record<string, string>;
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
  await withProviderKeysMutation(async () => {
    const keys = await readKeys();
    keys[id] = key;
    await browser.storage.local.set({ [KEYS_KEY]: keys });
  });
}

export async function clearKey(id: ProviderId): Promise<void> {
  // Always acquire source before provider keys when an operation touches both;
  // mergeImport follows this same order.
  await withSourceMutation(() => withProviderKeysMutation(async () => {
    const got = await browser.storage.local.get([KEYS_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_ENGINES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, MAX_RESULTS_KEY]);
    const keys = (got[KEYS_KEY] ?? {}) as Record<string, string>;
    delete keys[id];
    const definitions = normalizeSiteEngineDefinitions(got[SITE_ENGINES_KEY]);
    const customDefinitions = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
    const instances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
    const order = normalizeSourceOrder(got[SOURCE_ORDER_KEY], definitions, customDefinitions, instances);
    const hidden = ensureVisibleUsable(normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], definitions, customDefinitions, instances), order, keys, definitions, customDefinitions, instances);
    // 同步清除该 provider 的 maxResults，避免删除 key 后残留孤立设置，
    // 用户重新配置 key 时旧 maxResults 不会静默复用。
    const maxMap = (got[MAX_RESULTS_KEY] && typeof got[MAX_RESULTS_KEY] === 'object' && !Array.isArray(got[MAX_RESULTS_KEY])
      ? got[MAX_RESULTS_KEY] as Record<string, unknown>
      : {});
    const maxChanged = id in maxMap;
    if (maxChanged) delete maxMap[id];
    const setObj: Record<string, unknown> = { [KEYS_KEY]: keys, [SOURCE_HIDDEN_KEY]: hidden };
    if (maxChanged) setObj[MAX_RESULTS_KEY] = maxMap;
    await browser.storage.local.set(setObj);
  }));
}
