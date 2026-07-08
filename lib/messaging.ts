import { defineExtensionMessaging } from '@webext-core/messaging';
import type { NormalizedSearchResponse, ProviderId } from './providers/types';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';
import type { ConfigExport, ImportPreview, ImportReport } from './config-io';

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

export type ConfigIoError = { kind: 'invalid' | 'download_failed'; message: string };

export type ExportConfigReply =
  | { ok: true; filename: string }
  | { ok: false; error: ConfigIoError };

export type ImportConfigReply =
  | { ok: true; report: ImportReport }
  | { ok: false; error: ConfigIoError };

export type PreviewImportReply =
  | { ok: true; preview: ImportPreview }
  | { ok: false; error: ConfigIoError };

export type ProtocolMap = {
  search(request: SearchRequest): Promise<SearchReply>;
  testKey(providerId: ProviderId): Promise<TestKeyReply>;
  getProviderConfig(): Promise<ProviderConfigReply>;
  setActiveProvider(providerId: ProviderId): Promise<void>;
  saveProviderKey(data: { providerId: ProviderId; key: string }): Promise<void>;
  // 由 background 在特权上下文用 tabs.update 把当前 tab 导航到扩展页深链。
  // SERP 注入栏不能自己 location.assign 到 chrome-extension://（被客户端拦截）。
  openSearchPage(deepLink: string): Promise<void>;
  getSearchCacheSummaries(): Promise<SearchCacheSummary[]>;
  getCachedSearchEntry(id: string): Promise<SearchCacheEntry | null>;
  deleteCachedSearch(id: string): Promise<void>;
  clearSearchCache(): Promise<void>;
  exportConfig(): Promise<ExportConfigReply>;
  previewImport(payload: ConfigExport): Promise<PreviewImportReply>;
  importConfig(data: { payload: ConfigExport; applyPrefs: boolean }): Promise<ImportConfigReply>;
};

const messaging = defineExtensionMessaging<ProtocolMap>();
export const { sendMessage, onMessage } = messaging;
