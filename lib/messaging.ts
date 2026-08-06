import { defineExtensionMessaging } from '@webext-core/messaging';
import type { NormalizedSearchResponse, ProviderId } from './providers/types';
import type { SourceId } from './sources';
import type { GroupConfig } from './source-groups';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';
import type { ConfigExport, ImportPreview, ImportReport } from './config-io';
import type { SiteEngineDefinition, SiteEngineEngineId, SiteEngineId } from './site-engines';
import type { CustomEngineDefinition, CustomEngineId } from './custom-engines';
import type { ProviderInstance, ProviderInstanceId } from './provider-instances';

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
  activeSourceId: SourceId;
  sourceOrder: SourceId[];
  sourceHidden: SourceId[];
  siteEngines: SiteEngineDefinition[];
  customEngines: CustomEngineDefinition[];
  /** 每个 provider 的搜索结果条数设置（已显式配置过的 id 才出现；缺省由适配器默认）。 */
  providerMaxResults: Partial<Record<ProviderId, number>>;
  /** 来源分组与顶层布局（开箱默认按类型分组，缺失时由 worker 回退默认配置）。 */
  groupConfig: GroupConfig;
  /**
   * 用户定义的 provider 实例；UI/SERP-bar 宿主据此把实例投影进快切栏。
   * 当前为可选：IU2 的 `getProviderConfigSnapshot` 落地填充前，worker 快照暂不携带该字段。
   * IU2/IU4 落地后应收紧为必填（`ProviderInstance[]`）。
   */
  providerInstances?: ProviderInstance[];
  /** AI engine 自动回车开关（默认 true）。注入型 AI engine 的 URL 是否追加 enter=1。 */
  aiAutoEnter?: boolean;
  /** 少量来源自动平铺开关（默认 true）。开启后源 ≤4 或单组且 ≤6 时平铺到顶层。 */
  flatLayoutFewSources?: boolean;
};

export type ConfigIoError = { kind: 'invalid' | 'download_failed'; message: string };

export type ExportConfigReply =
  | { ok: true; filename: string }
  | { ok: false; error: ConfigIoError };

export type PackageAgentSkillReply =
  | { ok: true }
  | { ok: false; error: string };

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
  setActiveSource(sourceId: SourceId): Promise<void>;
  setSourceOrder(sourceOrder: SourceId[]): Promise<void>;
  setSourceHidden(sourceHidden: SourceId[]): Promise<void>;
  setGroupConfig(config: GroupConfig): Promise<void>;
  /** AI 注入可见性门控：该 AI engine 是否对用户可见（未被 sourceHidden 收录）。content script 在 fillAndSubmit 前查询，fail-closed。 */
  aiInjectAllowed(engineId: SourceId): Promise<boolean>;
  /** 设置 AI engine 自动回车开关（默认 true）。 */
  setAiAutoEnter(value: boolean): Promise<void>;
  /** 设置少量来源自动平铺开关（默认 true）。 */
  setFlatLayoutFewSources(value: boolean): Promise<void>;
  createSiteEngine(data: { name: string; target: string; engineId: SiteEngineEngineId }): Promise<SiteEngineDefinition>;
  updateSiteEngine(data: { id: SiteEngineId; name: string; target: string; engineId: SiteEngineEngineId }): Promise<SiteEngineDefinition>;
  deleteSiteEngine(siteId: SiteEngineId): Promise<void>;
  createCustomEngine(data: { name: string; urlTemplate: string }): Promise<CustomEngineDefinition>;
  updateCustomEngine(data: { id: CustomEngineId; name: string; urlTemplate: string }): Promise<CustomEngineDefinition>;
  deleteCustomEngine(id: CustomEngineId): Promise<void>;
  // Provider 实例 CRUD（worker 持久化；实例 id 属 SourceId 边界，绝不用作 ProviderId）。
  createProviderInstance(input: { baseProviderId: ProviderId; name: string; options: Record<string, unknown> }): Promise<ProviderInstance>;
  updateProviderInstance(input: { id: ProviderInstanceId; patch: { name?: string; options?: Record<string, unknown> } }): Promise<ProviderInstance | null>;
  deleteProviderInstance(id: ProviderInstanceId): Promise<void>;
  openNewTab(url: string): Promise<void>;
  saveProviderKey(data: { providerId: ProviderId; key: string }): Promise<void>;
  deleteProviderKey(providerId: ProviderId): Promise<void>;
  setProviderMaxResults(data: { providerId: ProviderId; maxResults: number }): Promise<void>;
  clearProviderMaxResults(providerId: ProviderId): Promise<void>;
  // 由 background 在特权上下文用 tabs.update 把当前 tab 导航到扩展页深链。
  // SERP 注入栏不能自己 location.assign 到 chrome-extension://（被客户端拦截）。
  openSearchPage(deepLink: string): Promise<void>;
  getSearchCacheSummaries(): Promise<SearchCacheSummary[]>;
  getCachedSearchEntry(id: string): Promise<SearchCacheEntry | null>;
  deleteCachedSearch(id: string): Promise<void>;
  clearSearchCache(): Promise<void>;
  exportConfig(): Promise<ExportConfigReply>;
  /** 打包 Agent Skill：worker 抓模板 → stamp runtime id → zip → 直接下载（R7 同理），页面只收 ok/err。 */
  packageAgentSkill(): Promise<PackageAgentSkillReply>;
  previewImport(payload: ConfigExport): Promise<PreviewImportReply>;
  importConfig(data: { payload: ConfigExport; applyPrefs: boolean }): Promise<ImportConfigReply>;
  /** bridge.html 仅把 fragment 中已解析的本地 Agent 凭据交给 worker。 */
  agentBridgeClaim(data: { port: number; token: string }): Promise<{ ok: boolean }>;
};

const messaging = defineExtensionMessaging<ProtocolMap>();
export const { sendMessage, onMessage } = messaging;
