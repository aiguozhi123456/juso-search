import type { ProviderId } from './providers/types';
import { ProviderError } from './providers/types';
import type { ProviderConfigReply, SearchReply, SearchRequest, TestKeyReply } from './messaging';
import type { SourceId } from './sources';
import { isProviderId } from './sources';
import { getAdapter } from './providers/registry';
import {
  clearKey,
  clearSearchCache,
  deleteCachedSearch,
  getActiveProviderId,
  getActiveSourceId,
  getCachedSearch,
  getCachedSearchEntry,
  getConfiguredProviderIds,
  getKey,
  getSearchCacheSummaries,
  saveCachedSearch,
  setActiveProviderId,
  setActiveSourceId,
  setKey,
} from './storage';
import { t, MSG } from './i18n';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';
import { ensureSchema } from './schema';
import { ensureCacheSchema } from './search-cache';
import { buildExportPayload, parseImportPayload, previewImport, mergeImport, type ConfigExport, type ImportReport } from './config-io';

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
 *  providerId 绑定 UI 视图（避免跨标签 active 漂移导致搜/缓存到错误 provider）。 */
export async function handleSearch(request: SearchRequest): Promise<SearchReply> {
  await getSchemaReady();
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
  const [configuredProviderIds, activeProviderId, activeSourceId] = await Promise.all([
    getConfiguredProviderIds(),
    getActiveProviderId(),
    getActiveSourceId(),
  ]);
  return { configuredProviderIds, activeProviderId, activeSourceId };
}

export async function handleSaveProviderKey(providerId: ProviderId, key: string): Promise<void> {
  await getSchemaReady();
  await setKey(providerId, key);
}

export async function handleDeleteProviderKey(providerId: ProviderId): Promise<void> {
  await getSchemaReady();
  await clearKey(providerId);
}

export async function handleSetActiveProvider(providerId: ProviderId): Promise<void> {
  await getSchemaReady();
  await Promise.all([setActiveProviderId(providerId), setActiveSourceId(providerId)]);
}

export async function handleSetActiveSource(sourceId: SourceId): Promise<void> {
  await getSchemaReady();
  if (isProviderId(sourceId)) {
    await Promise.all([setActiveSourceId(sourceId), setActiveProviderId(sourceId)]);
    return;
  }
  await setActiveSourceId(sourceId);
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
