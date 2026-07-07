import type { ProviderId } from './providers/types';
import { ProviderError } from './providers/types';
import type { ProviderConfigReply, SearchReply, SearchRequest, TestKeyReply } from './messaging';
import { getAdapter } from './providers/registry';
import {
  clearSearchCache,
  deleteCachedSearch,
  getActiveProviderId,
  getCachedSearch,
  getCachedSearchEntry,
  getConfiguredProviderIds,
  getKey,
  getSearchCacheSummaries,
  saveCachedSearch,
  setActiveProviderId,
  setKey,
} from './storage';
import { t, MSG } from './i18n';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';

type SearchErrorReply = Extract<SearchReply, { ok: false }>;

/** 搜索：优先复用本地缓存；forceRefresh 时 worker 读 key → 调激活 provider → 写缓存。
 *  providerId 绑定 UI 视图（避免跨标签 active 漂移导致搜/缓存到错误 provider）。 */
export async function handleSearch(request: SearchRequest): Promise<SearchReply> {
  try {
    const query = request.query.trim();
    const providerId = await resolveSearchProvider(request.providerId);
    if (!providerId) {
      if (request.providerId) {
        const adapter = getAdapter(request.providerId);
        return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_key_missing_provider, t(adapter.label)) } };
      }
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_no_provider_key) } };
    }
    if (!request.forceRefresh) {
      const cached = await getCachedSearch(providerId, query);
      if (cached) {
        return {
          ok: true,
          response: cached.response,
          cache: { hit: true, entryId: cached.id, createdAt: cached.createdAt },
        };
      }
    }
    const adapter = getAdapter(providerId);
    const key = await getKey(providerId);
    if (!key) {
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_key_missing_provider, t(adapter.label)) } };
    }
    const response = await adapter.search(query, {}, key);
    const cached = await saveCachedSearch(response).catch(() => null);
    return { ok: true, response, cache: { hit: false, entryId: cached?.id, createdAt: cached?.createdAt } };
  } catch (e) {
    return toSearchError(e);
  }
}

/** 设置页"测试 key"：最小查询验证连通性与鉴权。 */
export async function handleTestKey(providerId: ProviderId): Promise<TestKeyReply> {
  try {
    const adapter = getAdapter(providerId);
    const key = await getKey(providerId);
    if (!key) {
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_key_missing_provider, t(adapter.label)) } };
    }
    await adapter.search('test', { maxResults: 1 }, key);
    return { ok: true };
  } catch (e) {
    const reply = toSearchError(e);
    return {
      ok: false,
      error: {
        kind: 'providerError',
        message: reply.error.message,
      },
    };
  }
}

export async function handleGetProviderConfig(): Promise<ProviderConfigReply> {
  const [configuredProviderIds, activeProviderId] = await Promise.all([
    getConfiguredProviderIds(),
    getActiveProviderId(),
  ]);
  return { configuredProviderIds, activeProviderId };
}

export async function handleSaveProviderKey(providerId: ProviderId, key: string): Promise<void> {
  await setKey(providerId, key);
}

export async function handleSetActiveProvider(providerId: ProviderId): Promise<void> {
  await setActiveProviderId(providerId);
}

export async function handleGetSearchCacheSummaries(): Promise<SearchCacheSummary[]> {
  return getSearchCacheSummaries();
}

export async function handleGetCachedSearchEntry(id: string): Promise<SearchCacheEntry | null> {
  return getCachedSearchEntry(id);
}

export async function handleDeleteCachedSearch(id: string): Promise<void> {
  await deleteCachedSearch(id);
}

export async function handleClearSearchCache(): Promise<void> {
  await clearSearchCache();
}

/** 解析搜索所用 provider：UI 显式传入且已配置则采用，否则回退到 worker active 态。 */
async function resolveSearchProvider(requested: ProviderId | undefined): Promise<ProviderId | null> {
  if (requested) {
    const configured = await getConfiguredProviderIds();
    if (configured.includes(requested)) return requested;
    return null;
  }
  return getActiveProviderId();
}

function toSearchError(e: unknown): SearchErrorReply {
  if (e instanceof ProviderError) {
    return {
      ok: false,
      error: { kind: 'providerError', message: e.message, providerErrorKind: e.kind },
    };
  }
  // 不把原始异常信息透传到页面（避免未来 provider 错误体回显敏感数据）。
  return { ok: false, error: { kind: 'unknown', message: t(MSG.error_service_unavailable) } };
}
