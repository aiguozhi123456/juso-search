import { defineExtensionMessaging } from '@webext-core/messaging';
import type { NormalizedSearchResponse, ProviderId } from './providers/types';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';

export type SearchRequest = {
  query: string;
  forceRefresh?: boolean;
  /** UI 选定/缓存归属的 provider 快照；worker 优先采用，使搜索绑定到 UI 视图而非可能漂移的 worker active 态。 */
  providerId?: ProviderId;
};

// 跨消息用 ok/error 判别联合返回，不抛异常（错误对象跨 message 序列化会丢类信息）。
export type SearchReply =
  | {
      ok: true;
      response: NormalizedSearchResponse;
      cache: { hit: boolean; entryId?: string; createdAt?: number };
    }
  | {
      ok: false;
      error: {
        kind: 'keyMissing' | 'providerError' | 'unknown';
        message: string;
        providerErrorKind?: string;
      };
    };

export type TestKeyReply =
  | { ok: true }
  | { ok: false; error: { kind: 'keyMissing' | 'providerError'; message: string } };

export type ProviderConfigReply = {
  configuredProviderIds: ProviderId[];
  activeProviderId: ProviderId | null;
};

export type ProtocolMap = {
  search(request: SearchRequest): Promise<SearchReply>;
  testKey(providerId: ProviderId): Promise<TestKeyReply>;
  getProviderConfig(): Promise<ProviderConfigReply>;
  setActiveProvider(providerId: ProviderId): Promise<void>;
  saveProviderKey(data: { providerId: ProviderId; key: string }): Promise<void>;
  getSearchCacheSummaries(): Promise<SearchCacheSummary[]>;
  getCachedSearchEntry(id: string): Promise<SearchCacheEntry | null>;
  deleteCachedSearch(id: string): Promise<void>;
  clearSearchCache(): Promise<void>;
};

const messaging = defineExtensionMessaging<ProtocolMap>();
export const { sendMessage, onMessage } = messaging;
