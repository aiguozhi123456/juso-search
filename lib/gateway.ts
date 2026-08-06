import type { ProviderId, SearchOptions } from './providers/types';
import { ProviderError } from './providers/types';
import type { ProviderConfigReply, SearchReply, SearchRequest, TestKeyReply } from './messaging';
import { isProviderId, type SourceId } from './sources';
import type { GroupConfig } from './source-groups';
import { isSiteEngineId, type SiteEngineDefinition, type SiteEngineEngineId, type SiteEngineId } from './site-engines';
import { isCustomEngineId, type CustomEngineDefinition, type CustomEngineId } from './custom-engines';
import { isProviderInstanceId, PROVIDERS_WITH_INSTANCE_OPTIONS, type ProviderInstance, type ProviderInstanceId } from './provider-instances';
import { getAdapter } from './providers/registry';
import { allProviders } from './providers/registry';
import { isRegisteredAiEngineId } from './ai-engines/registry';
import type { AgentInstance, AgentListProvidersReply, AgentSearchInstanceRequest } from './agent-bridge';
import {
  clearKey,
  clearProviderMaxResults,
  clearSearchCache,
  deleteCachedSearch,
  getActiveProviderId,
  getCachedSearch,
  getCachedSearchEntry,
  getConfiguredProviderIds,
  getKey,
  getProviderMaxResults,
  getSearchCacheSummaries,
  getProviderConfigSnapshot,
  getSourceHidden,
  saveCachedSearch,
  setActiveProviderAndSourceId,
  selectActiveSourceId,
  setKey,
  setProviderMaxResults,
  setSourceHidden,
  setSourceOrder,
  setGroupConfig,
  setAiAutoEnter,
  createSiteEngineDefinition,
  updateSiteEngineDefinition,
  deleteSiteEngineDefinition,
  createCustomEngineDefinition,
  updateCustomEngineDefinition,
  deleteCustomEngineDefinition,
  getProviderInstances,
  createProviderInstance,
  updateProviderInstance,
  deleteProviderInstance,
  ensureDefaultInstance,
} from './storage';
import { t, MSG } from './i18n';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';
import { ensureSchema } from './schema';
import { ensureCacheSchema } from './search-cache';
import { buildExportPayload, parseImportPayload, previewImport, mergeImport, type ConfigExport, type ImportReport } from './config-io';
import { packageAgentSkill } from './agent-skill-packager';
import { SKILL_VARIANT } from './skill-variant';

// 双版本 schema 启动护栏：handler 顶部 await getSchemaReady() 后才可读/写 storage。
// 稳态两 ensure 各读单键 === 当前 → 立即 return，整个 promise 在首个微任务内 resolve（近零开销）。
// 首装/升级窗口（一次性）：阻塞保证读到的数据是迁移后的最终态。
// handler 无需感知 config 域 vs 缓存域区别——两者都完成才算 ready。
// 失败兜底：.catch(() => {}) 吞掉 ensure 抛错——即使迁移函数异常，ready 仍 resolve，
// 不让单次迁移失败永久 brick 整个 worker 路由。迁移失败的影响由 ensure* 内部兜底处理
// （ensureCacheSchema 会清池重生；ensureSchema 的 diff 写失败则下次重试）。
// 懒加载 memoized：首次调用才触发 ensure（而非模块 import 即触发），避免测试 import gateway
// 时副作用运行。多次调用返回同一 promise。
let schemaReadyPromise: Promise<void> | null = null;
export function getSchemaReady(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = Promise.all([ensureSchema(), ensureCacheSchema()])
      .then(() => undefined)
      .catch(() => undefined);
  }
  return schemaReadyPromise;
}

type SearchErrorReply = Extract<SearchReply, { ok: false }>;

/** 搜索：优先复用本地缓存；forceRefresh 时 worker 读 key → 调激活 provider → 写缓存。
 *  providerId 绑定 UI 视图（避免跨标签 active 漂移导致搜/缓存到错误 provider）。
 *  providerId 可能承载实例 id（SourceId 边界）：在网关边界解析为 base provider + options，
 *  此后只有 ProviderId 流入 getAdapter/getKey（KTD2/R8）。 */
export async function handleSearch(request: SearchRequest, signal?: AbortSignal): Promise<SearchReply> {
  await getSchemaReady();
  try {
    const query = request.query.trim();
    const resolution = await resolveSearchSource(request.providerId);
    if (!resolution) {
      if (request.providerId && !isProviderInstanceId(request.providerId)) {
        const adapter = getAdapter(request.providerId);
        return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_key_missing_provider, t(adapter.label)) } };
      }
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_no_provider_key) } };
    }
    // 必须 await 再返回：直接 `return runProviderSearch(...)` 会让 adapter 的 rejection
    // 绕过本函数 try/catch（return 不吞 promise rejection），导致错误逃逸到消息层。
    const reply = await runProviderSearch(query, resolution, request.forceRefresh, signal);
    return reply;
  } catch (e) {
    return toSearchError(e);
  }
}

/** 设置页"测试 key"：最小查询验证连通性与鉴权。 */
export async function handleTestKey(providerId: ProviderId): Promise<TestKeyReply> {
  await getSchemaReady();
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
  await getSchemaReady();
  return getProviderConfigSnapshot();
}

/** Agent bridge 的脱敏 provider 清单：只公开能力、是否已配置与是否有实例，绝不返回 key。 */
export async function handleListAgentProviders(): Promise<AgentListProvidersReply> {
  await getSchemaReady();
  const [instances, configured] = await Promise.all([getProviderInstances(), getConfiguredProviderIds()]);
  const providersWithInstances = new Set(instances.map((i) => i.baseProviderId));
  return {
    providers: allProviders().map((provider) => ({
      id: provider.id,
      supportsAnswer: provider.supportsAnswer,
      configured: configured.includes(provider.id),
      ...(providersWithInstances.has(provider.id) ? { hasInstances: true } : {}),
    })),
  };
}

/** Agent bridge v2：实例清单（脱敏，绝不返回 key）。实例无描述字段，Phase 1 label = name、description = ''。 */
export async function handleListAgentInstances(): Promise<{ instances: AgentInstance[] }> {
  await getSchemaReady();
  const [instances, configured] = await Promise.all([getProviderInstances(), getConfiguredProviderIds()]);
  const configuredSet = new Set(configured);
  return {
    instances: instances.map((instance) => ({
      id: instance.id,
      providerId: instance.baseProviderId,
      label: instance.name,
      description: '',
      configured: configuredSet.has(instance.baseProviderId),
    })),
  };
}

/** Agent bridge v2：按实例 id 解析并搜索（注入该实例的 per-instance options）。 */
export async function handleSearchInstance(request: AgentSearchInstanceRequest, signal?: AbortSignal): Promise<SearchReply> {
  await getSchemaReady();
  try {
    const query = request.query.trim();
    const resolution = await resolveInstance(request.instanceId);
    if (!resolution) {
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG.error_no_provider_key) } };
    }
    const reply = await runProviderSearch(query, resolution, request.forceRefresh, signal);
    return reply;
  } catch (e) {
    return toSearchError(e);
  }
}

export async function handleSaveProviderKey(providerId: ProviderId, key: string): Promise<void> {
  await getSchemaReady();
  await setKey(providerId, key);
  // 统一实例模型（KTD5）：带 per-instance options 的 provider 配置 key 时自动创建默认实例，
  // 保证「有实例的 provider 永远 ≥1 个实例」（不出现裸 pill）。ensureDefaultInstance 在实例变更
  // 队列内完成读-判-建，天然串行——并发 save key 不会双双读到空列表而重复创建（BUG-3）；
  // 用户清 key 后重配时已有实例则 no-op。best-effort：失败不影响 key 保存（主操作）。
  if (PROVIDERS_WITH_INSTANCE_OPTIONS.has(providerId)) {
    try {
      await ensureDefaultInstance(providerId, t(getAdapter(providerId).label));
    } catch {
      // ignore — key save is the primary operation
    }
  }
}

export async function handleDeleteProviderKey(providerId: ProviderId): Promise<void> {
  await getSchemaReady();
  await clearKey(providerId);
}

export async function handleSetProviderMaxResults(providerId: ProviderId, maxResults: number): Promise<void> {
  await getSchemaReady();
  await setProviderMaxResults(providerId, maxResults);
  // maxResults 变更后，旧缓存条目的结果条数已过时（cache key 不含 maxResults），
  // 清空缓存避免命中返回错误条数的旧响应。
  await clearSearchCache();
}

export async function handleClearProviderMaxResults(providerId: ProviderId): Promise<void> {
  await getSchemaReady();
  await clearProviderMaxResults(providerId);
  await clearSearchCache();
}

export async function handleSetActiveProvider(providerId: ProviderId): Promise<void> {
  await getSchemaReady();
  await setActiveProviderAndSourceId(providerId);
}

export async function handleSetActiveSource(sourceId: SourceId): Promise<void> {
  await getSchemaReady();
  await selectActiveSourceId(sourceId);
}

export async function handleCreateSiteEngine(data: { name: string; target: string; engineId: SiteEngineEngineId }): Promise<SiteEngineDefinition> {
  await getSchemaReady();
  return createSiteEngineDefinition({ ...data, id: `site:${crypto.randomUUID()}` });
}

export async function handleUpdateSiteEngine(data: { id: SiteEngineId; name: string; target: string; engineId: SiteEngineEngineId }): Promise<SiteEngineDefinition> {
  await getSchemaReady();
  return updateSiteEngineDefinition(data.id, data);
}

export async function handleDeleteSiteEngine(siteId: SiteEngineId): Promise<void> {
  await getSchemaReady();
  if (!isSiteEngineId(siteId)) throw new Error('invalid_site_engine');
  await deleteSiteEngineDefinition(siteId);
}

export async function handleCreateCustomEngine(data: { name: string; urlTemplate: string }): Promise<CustomEngineDefinition> {
  await getSchemaReady();
  return createCustomEngineDefinition({ ...data, id: `custom:${crypto.randomUUID()}` });
}

export async function handleUpdateCustomEngine(data: { id: CustomEngineId; name: string; urlTemplate: string }): Promise<CustomEngineDefinition> {
  await getSchemaReady();
  if (!isCustomEngineId(data.id)) throw new Error('invalid_custom_engine');
  return updateCustomEngineDefinition(data.id, data);
}

export async function handleDeleteCustomEngine(id: CustomEngineId): Promise<void> {
  await getSchemaReady();
  if (!isCustomEngineId(id)) throw new Error('invalid_custom_engine');
  await deleteCustomEngineDefinition(id);
}

export async function handleCreateProviderInstance(data: { baseProviderId: ProviderId; name: string; options: Record<string, unknown> }): Promise<ProviderInstance> {
  await getSchemaReady();
  return createProviderInstance(data.baseProviderId, data.name, data.options);
}

export async function handleUpdateProviderInstance(data: { id: ProviderInstanceId; patch: { name?: string; options?: Record<string, unknown> } }): Promise<ProviderInstance | null> {
  await getSchemaReady();
  const updated = await updateProviderInstance(data.id, data.patch);
  // 实例 options 变更后，旧缓存条目的结果已过时（cache key 不含 options），
  // 清空缓存避免命中返回旧 options 的响应（per-provider-config-worker-injection 先例）。
  await clearSearchCache();
  return updated;
}

export async function handleDeleteProviderInstance(id: ProviderInstanceId): Promise<void> {
  await getSchemaReady();
  if (!isProviderInstanceId(id)) throw new Error('invalid_provider_instance');
  await deleteProviderInstance(id);
  // 缓存现已按 instanceId 键控（IU6），可精确清理该实例条目；但保守清空整个缓存池
  // （可重生）与 maxResults/delete 先例一致，且避免索引扫描的复杂度。
  await clearSearchCache();
}

export async function handleSetSourceOrder(sourceOrder: SourceId[]): Promise<void> {
  await getSchemaReady();
  await setSourceOrder(sourceOrder);
}

export async function handleSetSourceHidden(sourceHidden: SourceId[]): Promise<void> {
  await getSchemaReady();
  await setSourceHidden(sourceHidden);
}

/** AI 注入可见性门控：仅当该 AI engine 已注册且未被 sourceHidden 收录时允许注入。
 *  只读 source 图配置（getSourceHidden 读 4 键归一化；不碰 BYOK key）。
 *  content script 在 fillAndSubmit 前调用。 */
export async function handleAiInjectAllowed(engineId: SourceId): Promise<boolean> {
  await getSchemaReady();
  if (!isRegisteredAiEngineId(engineId)) return false;
  const hidden = await getSourceHidden();
  return !hidden.includes(engineId);
}

export async function handleSetGroupConfig(config: GroupConfig): Promise<void> {
  await getSchemaReady();
  await setGroupConfig(config);
}

/** 设置 AI engine 自动回车开关（默认 true）。 */
export async function handleSetAiAutoEnter(value: boolean): Promise<void> {
  await getSchemaReady();
  await setAiAutoEnter(value);
}

export async function handleGetSearchCacheSummaries(): Promise<SearchCacheSummary[]> {
  await getSchemaReady();
  return getSearchCacheSummaries();
}

export async function handleGetCachedSearchEntry(id: string): Promise<SearchCacheEntry | null> {
  await getSchemaReady();
  return getCachedSearchEntry(id);
}

export async function handleDeleteCachedSearch(id: string): Promise<void> {
  await getSchemaReady();
  await deleteCachedSearch(id);
}

export async function handleClearSearchCache(): Promise<void> {
  await getSchemaReady();
  await clearSearchCache();
}

/**
 * 导出配置：worker 组装 payload（含明文 key）→ 转 data URL → browser.downloads.download 触发下载。
 * key 明文从不进入页面内存（R7 保全）：worker 是 key 的唯一读者，下载由 worker 直接发起。
 */
export async function handleExportConfig(
  onDownload: (url: string, filename: string) => Promise<void> = triggerDownload,
): Promise<{ ok: true; filename: string } | { ok: false; error: { kind: 'invalid' | 'download_failed'; message: string } }> {
  await getSchemaReady();
  let payload;
  try {
    payload = await buildExportPayload();
  } catch (e) {
    // storage 读取失败 ≠ 下载失败：单独归类为 invalid，避免误导用户以为是下载被阻断。
    return { ok: false, error: { kind: 'invalid', message: errorMessage(e) } };
  }
  try {
    const json = JSON.stringify(payload, null, 2);
    const dataUrl = `data:application/json;charset=utf-8,${encodeURIComponent(json)}`;
    const filename = buildExportFilename(payload.exportedAt);
    await onDownload(dataUrl, filename);
    return { ok: true, filename };
  } catch (e) {
    return { ok: false, error: { kind: 'download_failed', message: errorMessage(e) } };
  }
}

/**
 * 打包 Agent Skill：worker 抓取随包模板 → stamp 当前扩展 runtime id → STORE zip →
 * 转 data URL → browser.downloads.download 直接发起下载。key 与打包产物均不进页面内存（R7 同理），
 * 页面只收到 ok/err 状态。
 */
export async function handlePackageAgentSkill(
  onDownload: (url: string, filename: string) => Promise<void> = triggerDownload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const { dataUrl, filename } = await packageAgentSkill(SKILL_VARIANT);
    await onDownload(dataUrl, filename);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** 预览导入效果（dry-run）：校验 payload → 返回 diff（填空 key + prefs 变更），不写 storage。 */
export async function handlePreviewImport(
  payload: ConfigExport,
): Promise<{ ok: true; preview: Awaited<ReturnType<typeof previewImport>> } | { ok: false; error: { kind: 'invalid'; message: string } }> {
  await getSchemaReady();
  const parsed = parseImportPayload(payload);
  if (!parsed.ok) {
    return { ok: false, error: { kind: 'invalid', message: parsed.error } };
  }
  try {
    const preview = await previewImport(parsed.value);
    return { ok: true, preview };
  } catch (e) {
    return { ok: false, error: { kind: 'invalid', message: errorMessage(e) } };
  }
}

/** 导入配置：校验 payload → 合并写回（仅填空 key + 可选覆盖 prefs）。 */
export async function handleImportConfig(
  data: { payload: ConfigExport; applyPrefs: boolean },
): Promise<{ ok: true; report: ImportReport } | { ok: false; error: { kind: 'invalid'; message: string } }> {
  await getSchemaReady();
  const parsed = parseImportPayload(data.payload);
  if (!parsed.ok) {
    return { ok: false, error: { kind: 'invalid', message: parsed.error } };
  }
  try {
    const report = await mergeImport(parsed.value, { applyPrefs: data.applyPrefs });
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: { kind: 'invalid', message: errorMessage(e) } };
  }
}

function buildExportFilename(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const HH = String(d.getHours()).padStart(2, '0');
  const MM = String(d.getMinutes()).padStart(2, '0');
  return `juso-config-${yyyy}${mm}${dd}-${HH}${MM}.json`;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'unknown';
}

async function triggerDownload(url: string, filename: string): Promise<void> {
  await browser.downloads.download({ url, filename, saveAs: true });
}

/** 执行一次已解析 provider 的搜索：缓存 → key → options（maxResults/providerSettings 均由
 *  worker 从 storage 读并注入 SearchOptions，消息不携带——per-provider-config-worker-injection 先例）。 */
async function runProviderSearch(
  query: string,
  resolution: { providerId: ProviderId; providerSettings?: Record<string, unknown>; cacheKeyId: string },
  forceRefresh: boolean | undefined,
  signal?: AbortSignal,
): Promise<SearchReply> {
  const { providerId, providerSettings, cacheKeyId } = resolution;
  if (!forceRefresh) {
    const cached = await getCachedSearch(cacheKeyId, query);
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
  const maxResults = await getProviderMaxResults(providerId);
  const options: SearchOptions = {
    signal,
    ...(maxResults !== null ? { maxResults } : {}),
    ...(providerSettings !== undefined ? { providerSettings } : {}),
  };
  const response = await adapter.search(query, options, key);
  if (signal?.aborted) {
    throw new DOMException('The operation was aborted.', 'AbortError');
  }
  const cached = await saveCachedSearch(response, cacheKeyId).catch(() => null);
  return { ok: true, response, cache: { hit: false, entryId: cached?.id, createdAt: cached?.createdAt } };
}

/**
 * 实例解析边界（KTD2/R8）：`ProviderInstanceId → { baseProviderId, options }`。
 * 此后只有 ProviderId 流入 getAdapter/getKey——实例 id 绝不进入 BYOK 路径。
 * - 实例 id：查实例定义，命中返回 base provider + per-instance options；未知返回 null；
 * - 裸 provider id：返回 `{ providerId }`（无 options；默认实例路由在 resolveSearchSource）；
 * - undefined / 未知来源：null。
 */
export async function resolveInstance(sourceId: SourceId | undefined): Promise<{
  providerId: ProviderId;
  providerSettings?: Record<string, unknown>;
  cacheKeyId: string;
} | null> {
  if (!sourceId) return null;
  if (isProviderInstanceId(sourceId)) {
    const instances = await getProviderInstances();
    const instance = instances.find((item) => item.id === sourceId);
    if (!instance) return null;
    return { providerId: instance.baseProviderId, providerSettings: instance.options, cacheKeyId: sourceId };
  }
  return isProviderId(sourceId) ? { providerId: sourceId, cacheKeyId: sourceId } : null;
}

/** 解析搜索所用 provider：UI 显式传入（可为实例 id，SourceId 边界）且已配置则采用，
 *  否则回退到 worker active 态。裸 provider id 有实例时路由到第一个（默认实例，KTD5）并注入其 options（R4）。 */
async function resolveSearchSource(requested: ProviderId | undefined): Promise<{
  providerId: ProviderId;
  providerSettings?: Record<string, unknown>;
  cacheKeyId: string;
} | null> {
  if (requested) {
    if (isProviderInstanceId(requested)) return resolveInstance(requested);
    const configured = await getConfiguredProviderIds();
    if (!configured.includes(requested)) return null;
    return resolveBareProvider(requested);
  }
  const active = await getActiveProviderId();
  if (!active) return null;
  return resolveBareProvider(active);
}

/** 裸 provider：若该 provider 有实例，则返回第一个实例的 options（默认实例 = 隐式第一个，KTD5）。
 *  cacheKeyId 用默认实例 id（使 v1 search 与 v2 search-instance 命中同一缓存条目）；无实例时用 provider id。 */
async function resolveBareProvider(providerId: ProviderId): Promise<{ providerId: ProviderId; providerSettings?: Record<string, unknown>; cacheKeyId: string }> {
  const instances = await getProviderInstances();
  const defaultInstance = instances.find((instance) => instance.baseProviderId === providerId);
  return defaultInstance
    ? { providerId, providerSettings: defaultInstance.options, cacheKeyId: defaultInstance.id }
    : { providerId, cacheKeyId: providerId };
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
