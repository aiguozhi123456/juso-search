import type { NormalizedSearchResponse, ProviderId, SearchOptions } from './providers/types';
import { ProviderError } from './providers/types';
import type { AggregateSearchReply, AggregateSearchRequest, ProviderConfigReply, SearchReply, SearchRequest, SetRerankConfigReply, TestKeyReply } from './messaging';
import { isEngineId, isProviderId, type SourceId } from './sources';
import type { GroupConfig } from './source-groups';
import { buildSiteInstanceUrl, isSiteInstanceId, type SiteInstanceDefinition, type SiteInstanceEngineId, type SiteInstanceId, type SiteInstanceOptions } from './site-instances';
import { isCustomEngineId, type CustomEngineDefinition, type CustomEngineId } from './custom-engines';
import { isProviderInstanceId, PROVIDERS_WITH_INSTANCE_OPTIONS, type ProviderInstance, type ProviderInstanceId } from './provider-instances';
import { isAggregateInstanceId, type AggregateInstance } from './aggregate-instances';
import type { AggregateInstanceId, AggregateMemberId, AggregateMergedResult, AggregateSearchResponse } from './aggregate/types';
import { buildRerankDocument, mergeAggregateMembers } from './aggregate/merge';
import { resolveAggregateEligibility, extractorCapableEngineIds } from './aggregate/eligibility';
import type { RerankResultItem } from './aggregate/rerank-client';
import { isRerankConfigured, MSG_RERANK_ENDPOINT_INVALID, rerankDocuments, RerankError, testRerank, validateRerankEndpoint } from './aggregate/rerank-client';
import { getAdapter } from './providers/registry';
import { allProviders } from './providers/registry';
import { allEngines, matchEngineByUrl } from './engines/registry';
import { runEngineSearch } from './engine-search';
import type { EngineId } from './engines/types';
import { isRegisteredAiEngineId } from './ai-engines/registry';
import type { AgentInstance, AgentListAggregatesReply, AgentListEnginesReply, AgentListProvidersReply, AgentListSitesReply, AgentSearchAggregateRequest, AgentSearchInstanceRequest, AgentSearchSiteRequest, AgentSiteSearchReply } from './agent-bridge';
import {
  clearKey,
  clearProviderMaxResults,
  clearSearchCache,
  createAggregateInstance,
  deleteAggregateCacheEntries,
  deleteAggregateInstance,
  deleteCachedSearch,
  getActiveProviderId,
  getAggregateInstances,
  getCachedSearch,
  getCachedSearchEntry,
  getConfiguredProviderIds,
  getKey,
  getProviderMaxResults,
  getProviderInstances,
  getRerankConfig,
  getSearchCacheSummaries,
  getProviderConfigSnapshot,
  getSiteInstanceDefinitions,
  getEngineSearchEnabled,
  getSourceHidden,
  saveCachedAggregateSearch,
  saveCachedSearch,
  setActiveProviderAndSourceId,
  selectActiveSourceId,
  setKey,
  setProviderMaxResults,
  setRerankConfig,
  setSourceHidden,
  setSourceOrder,
  setGroupConfig,
  setAiAutoEnter,
  setFlatLayoutFewSources,
  setSelectionSearchEnabled,
  setSelectionSearchSource,
  updateAggregateInstance,
  createSiteInstanceDefinition,
  updateSiteInstanceDefinition,
  deleteSiteInstanceDefinition,
  createCustomEngineDefinition,
  updateCustomEngineDefinition,
  deleteCustomEngineDefinition,
  createProviderInstance,
  updateProviderInstance,
  deleteProviderInstance,
  ensureDefaultInstance,
} from './storage';
import { t, MSG } from './i18n';
import type { SearchCacheEntry, SearchCacheSummary } from './search-cache';
import { isAggregateCacheEntry } from './search-cache';
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

// i18n 占位键名（Lane D 落 lib/i18n.ts + _locales/{zh_CN,en}/messages.json 双语条目；现阶段 t() 回退键名本身）。
const MSG_AGGREGATE_RERANK_FAILED = 'error_aggregate_rerank_failed';
const MSG_AGGREGATE_ALL_MEMBERS_FAILED = 'error_aggregate_all_members_failed';
const MSG_AGGREGATE_RERANK_NOT_CONFIGURED = 'error_rerank_not_configured';
const MSG_AGGREGATE_INSTANCE_UNKNOWN = 'error_aggregate_instance_unknown';

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
  const snapshot = await getProviderConfigSnapshot();
  // 懒补齐（backfill）：实例功能上线前就已配置 key 的老用户（exa/doubao）可能没有任何实例，
  // 破坏「支持实例选项的 provider 永远 ≥1 个实例」。所有 UI 面（搜索页/options/SERP bar）
  // 都经本消息拉配置——在这里 worker 侧补齐一次即可自愈全部 UI；configuredProviderIds 来自
  // key 存在性判断，仅发生在 worker 上下文，符合 BYOK 边界（页面代码绝不读 key）。
  // ensureDefaultInstance 在 source+实例双队列内原子读-判-建（已有实例即 no-op），因此本逻辑幂等，
  // 重复触发零副作用；稳态下 missing 为空，零额外存储读，热路径无成本。
  // best-effort：补齐失败不影响配置返回。
  const missing = [...PROVIDERS_WITH_INSTANCE_OPTIONS]
    .filter((providerId) => snapshot.configuredProviderIds.includes(providerId))
    .filter((providerId) => !snapshot.providerInstances.some((instance) => instance.baseProviderId === providerId));
  if (missing.length === 0) return snapshot;
  for (const providerId of missing) {
    try {
      await ensureDefaultInstance(providerId, t(getAdapter(providerId).label));
    } catch {
      // 忽略——配置读取是主操作，补齐是附带动作
    }
  }
  // 补齐后重取快照，本次响应直接反映新实例（UI 无需等下一次消息）
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

/** Agent bridge 的 engine 清单（脱敏）：只公开 id，供 agent 在调用 engine-search 前发现可用 engine。 */
export async function handleListAgentEngines(): Promise<AgentListEnginesReply> {
  await getSchemaReady();
  return { engines: allEngines().map((engine) => ({ id: engine.id })) };
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

// === Agent bridge v2：站点实例 / 聚合实例（additive，不动既有 6 action 契约）===

// i18n 占位键名（同上方聚合占位键先例；词条落 lib/i18n.ts + _locales/{zh_CN,en}/messages.json）。
const MSG_AGENT_SITE_INSTANCE_UNKNOWN = 'error_site_instance_unknown';
const MSG_AGENT_ENGINE_SEARCH_DISABLED = 'error_agent_engine_search_disabled';

/** Agent bridge 的站点实例清单（脱敏）：id/名称/backing engine/目标站，无任何密钥。 */
export async function handleListAgentSites(): Promise<AgentListSitesReply> {
  await getSchemaReady();
  const definitions = await getSiteInstanceDefinitions();
  return {
    sites: definitions.map((definition) => ({
      id: definition.id,
      label: definition.name,
      engineId: definition.engineId,
      target: definition.target,
      description: '',
    })),
  };
}

/** Agent bridge 的聚合实例清单：members/topN 为非敏感定义数据；eligible 与 handleAggregateSearch 同源判定。 */
export async function handleListAgentAggregates(): Promise<AgentListAggregatesReply> {
  await getSchemaReady();
  const [instances, configured, providerInstances, rerankConfig] = await Promise.all([
    getAggregateInstances(),
    getConfiguredProviderIds(),
    getProviderInstances(),
    getRerankConfig(),
  ]);
  const eligibilityContext = { configuredProviderIds: configured, providerInstances, rerankConfig };
  return {
    aggregates: instances.map((instance) => ({
      id: instance.id,
      label: instance.name,
      eligible: resolveAggregateEligibility(instance, eligibilityContext).eligible,
      topN: instance.topN,
      members: instance.members,
    })),
  };
}

/** Agent bridge v2：站点实例搜索（构造站内 SERP URL → 临时 tab → backing engine 抽取）。
 *  reply 为 SearchReply 式 envelope：未知/已删 id、URL 构造失败统一 ok:false（search-instance 先例）；
 *  子开关 off 的折入在 background.ts 包装层（engine-search 先例）。 */
export async function handleSearchSiteInstance(request: AgentSearchSiteRequest, signal?: AbortSignal, innerBudgetMs?: number): Promise<AgentSiteSearchReply> {
  await getSchemaReady();
  try {
    const query = request.query.trim();
    const definition = (await getSiteInstanceDefinitions()).find((candidate) => candidate.id === request.siteId);
    if (!definition) {
      return { ok: false, error: { kind: 'unknown', message: t(MSG_AGENT_SITE_INSTANCE_UNKNOWN) } };
    }
    const serpUrl = buildSiteInstanceUrl(definition, query);
    if (!serpUrl) {
      return { ok: false, error: { kind: 'unknown', message: t(MSG_AGENT_SITE_INSTANCE_UNKNOWN) } };
    }
    // URL↔请求匹配文本直接取自构造出的 URL 本身（matchEngineByUrl 覆盖 zhannei surface）：
    // 与内容脚本的识别单一来源，构造模式变化时无需双处维护。
    const matchQuery = matchEngineByUrl(serpUrl)?.extractQuery(serpUrl) ?? query;
    const result = await runEngineSearch(
      { query, engineId: definition.engineId, serpUrl, matchQuery, ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }) },
      signal,
      { tabs: browser.tabs, ...(innerBudgetMs === undefined ? {} : { completeTimeoutMs: innerBudgetMs }) },
    );
    if (!('results' in result)) {
      // 抽取错误分型原样透传为 message（challenge/timeout/…），kind 归 'providerError'（引擎页侧失败，非 id/配置问题）。
      return { ok: false, error: { kind: 'providerError', message: result.error } };
    }
    return { ok: true, response: { query, engine: definition.engineId, results: result.results }, cache: { hit: false } };
  } catch (e) {
    return { ok: false, error: { kind: 'unknown', message: errorMessage(e) } };
  }
}

/** Agent bridge v2：聚合搜索。门控（additive 决策，与 runEngineAggregateMember 的用户 UI 豁免互补）：
 *  聚合含 extractor-capable 引擎成员时代 agent 打开第三方页 → 需 engine-search 子开关；纯 provider/
 *  实例成员聚合不受该子开关约束。判定与决策记录：docs/solutions/architecture-patterns/
 *  agent-aggregate-engine-member-gating.md。 */
export async function handleSearchAggregate(request: AgentSearchAggregateRequest, signal?: AbortSignal): Promise<AggregateSearchReply> {
  await getSchemaReady();
  const instance = (await getAggregateInstances()).find((candidate) => candidate.id === request.aggregateId);
  if (instance && extractorCapableEngineIds().some((engineId) => instance.members.includes(engineId)) && !(await getEngineSearchEnabled())) {
    return { ok: false, error: { kind: 'unknown', message: t(MSG_AGENT_ENGINE_SEARCH_DISABLED) } };
  }
  return handleAggregateSearch(
    { instanceId: request.aggregateId, query: request.query, ...(request.forceRefresh === undefined ? {} : { forceRefresh: request.forceRefresh }) },
    signal,
  );
}

// === 聚合搜索（aggregate-search-rerank plan KTD3/KTD8/KTD12/KTD9）===

// Lane F（Phase 3，KTD3/R9）engine 成员扇出参数：
// - AGGREGATE_ENGINE_MEMBER_CONCURRENCY：并发信号量上限。仅约束 engine 成员（同时打开的后台
//   SERP tab 数 ≤ 上限），provider 成员并发不受限。作用域 = 单次 handleAggregateSearch 调用
//   （跨本次聚合搜索窗口，不跨请求共享）。调参直接改常量；上限同时是反爬压力预算（AE4）。
// - AGGREGATE_ENGINE_MEMBER_TIMEOUT_MS：runEngineSearch 的 completeTimeoutMs（tab 加载等待 +
//   extractor 握手重试的总预算；见 lib/engine-search.ts deps 契约）。聚合路径用固定 20s；
//   agent-bridge 路径沿用 deadline 收窄（background.ts engineInnerBudgetMs 先例），互不影响。
export const AGGREGATE_ENGINE_MEMBER_CONCURRENCY = 3;
export const AGGREGATE_ENGINE_MEMBER_TIMEOUT_MS = 20_000;

/** 最小异步信号量：任务排队等待空位，完成即放行下一个（FIFO）。
 *  run() 永不吞任务结果/异常，仅约束同时在途数量。 */
function createAggregateEngineLimiter(limit: number = AGGREGATE_ENGINE_MEMBER_CONCURRENCY): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= limit) await new Promise<void>((resolve) => waiters.push(resolve));
    active += 1;
    try {
      return await task();
    } finally {
      active -= 1;
      waiters.shift()?.();
    }
  };
}

/** 单成员扇出上下文：signal 取消传播 + engine 成员专用信号量（provider 成员忽略之）。 */
interface AggregateMemberContext {
  signal?: AbortSignal;
  engineSlots: <T>(task: () => Promise<T>) => Promise<T>;
}

/** 单成员扇出结果（R6：状态透明、错误分型保留不折叠；engine 成员恒为实时抽取）。 */
type AggregateMemberOutcome =
  | { sourceId: AggregateMemberId; ok: true; cached?: boolean; response: NormalizedSearchResponse }
  | { sourceId: AggregateMemberId; ok: false; errorKind: string; errorMessage: string };

/**
 * 聚合搜索（KTD3 全流程）：解析实例（未知 id → error）→ rerank 配置校验（未配置 → keyMissing）→
 * （非 forceRefresh）按 **agg 实例 id** 查聚合缓存（命中即返回，0 扇出，AE7）→ eligibility 复核 →
 * `Promise.allSettled` 扇出 provider/实例成员（经 resolveSearchSource 语义执行，复用 runProviderSearch
 * 内部路径：各自子缓存优先、forceRefresh 传播、各自写缓存、cache.hit 记入 member.cached）→
 * merge（候选池 40）→ rerankDocuments → relevance_score 降序写 score → saveCachedAggregateSearch
 * （best-effort）→ ok reply。≥1 成功即继续；全员失败 → providerError 汇总文案；rerank 失败 →
 * providerError 专用文案，不降级（AE3）。聚合级缓存读写从同一边界贯穿同一实例 id（parallel-IU 接缝）。
 */
export async function handleAggregateSearch(request: AggregateSearchRequest, signal?: AbortSignal): Promise<AggregateSearchReply> {
  await getSchemaReady();
  try {
    const query = request.query.trim();
    if (!isAggregateInstanceId(request.instanceId)) {
      return { ok: false, error: { kind: 'unknown', message: t(MSG_AGGREGATE_INSTANCE_UNKNOWN) } };
    }
    const instances = await getAggregateInstances();
    const instance = instances.find((candidate) => candidate.id === request.instanceId);
    if (!instance) {
      return { ok: false, error: { kind: 'unknown', message: t(MSG_AGGREGATE_INSTANCE_UNKNOWN) } };
    }
    const rerankConfig = await getRerankConfig();
    if (!isRerankConfigured(rerankConfig)) {
      return { ok: false, error: { kind: 'keyMissing', message: t(MSG_AGGREGATE_RERANK_NOT_CONFIGURED) } };
    }
    if (!request.forceRefresh) {
      // 聚合级缓存读：键 = agg 实例 id，与下方 saveCachedAggregateSearch 同源（KTD7）。
      const cached = await getCachedSearch(request.instanceId, query);
      if (cached && isAggregateCacheEntry(cached)) {
        return { ok: true, response: cached.response, cache: { hit: true, entryId: cached.id, createdAt: cached.createdAt } };
      }
    }
    // eligibility 复核（KTD5）：rerank 已配置前提下，0 有效成员 → 扇出必然全员失败，直接按汇总分型返回。
    const [configured, providerInstances] = await Promise.all([getConfiguredProviderIds(), getProviderInstances()]);
    const eligibility = resolveAggregateEligibility(instance, { configuredProviderIds: configured, providerInstances, rerankConfig });
    if (eligibility.validMembers.length === 0) {
      return { ok: false, error: { kind: 'providerError', message: t(MSG_AGGREGATE_ALL_MEMBERS_FAILED) } };
    }
    // Lane F：engine 成员并发信号量作用域 = 本次聚合搜索窗口（KTD3：≤3，仅约束 engine 成员）。
    const engineSlots = createAggregateEngineLimiter();
    const settled = await Promise.allSettled(instance.members.map((member) => runAggregateMember(member, query, request.forceRefresh, { signal, engineSlots })));
    const outcomes: AggregateMemberOutcome[] = settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      // runAggregateMember 自吞错误；此处兜底意外 rejection → 失败成员（分型保留，不折叠，R6）。
      return { sourceId: instance.members[index], ok: false, errorKind: 'unknown', errorMessage: errorMessage(result.reason) };
    });
    const contributions = outcomes
      .filter((outcome): outcome is Extract<AggregateMemberOutcome, { ok: true }> => outcome.ok)
      .map((outcome) => ({ sourceId: outcome.sourceId, response: outcome.response }));
    if (contributions.length === 0) {
      return { ok: false, error: { kind: 'providerError', message: t(MSG_AGGREGATE_ALL_MEMBERS_FAILED) } };
    }
    const merged = mergeAggregateMembers(contributions);
    let ranked: AggregateMergedResult[] = merged.results;
    if (merged.results.length > 0) {
      const rerankResults = await rerankDocuments(
        rerankConfig,
        { query, documents: merged.results.map(buildRerankDocument), top_n: instance.topN },
        { signal, fetch: (...args) => fetch(...args) },
      );
      ranked = applyRerankOrdering(merged.results, rerankResults, instance.topN);
    }
    const response: AggregateSearchResponse = {
      instanceId: instance.id,
      query,
      kind: 'aggregate',
      answers: merged.answers,
      results: ranked,
      members: outcomes.map((outcome) => (outcome.ok
        ? { sourceId: outcome.sourceId, ok: true, ...(outcome.cached ? { cached: true } : {}), resultCount: outcome.response.results.length }
        : { sourceId: outcome.sourceId, ok: false, errorKind: outcome.errorKind, errorMessage: outcome.errorMessage })),
      dedupedCount: merged.dedupedCount,
      rerank: { ...(rerankConfig.model ? { model: rerankConfig.model } : {}), rerankedAt: Date.now() },
    };
    const saved = await saveCachedAggregateSearch(response).catch(() => null);
    return { ok: true, response, cache: { hit: false, entryId: saved?.id, createdAt: saved?.createdAt } };
  } catch (e) {
    return toAggregateSearchError(e);
  }
}

/** 单成员执行（KTD3 扇出单元）：永不 reject（错误折入 member 状态，分型保留）。
 *  provider/实例成员经 resolveSearchSource 语义解析并复用 runProviderSearch 内部路径
 *  （各自缓存优先 / forceRefresh 传播 / 各自写缓存 / cache.hit → member.cached）；
 *  engine 成员经 runEngineSearch（信号量限流、恒实时抽取、错误分型原样透传）。 */
async function runAggregateMember(member: AggregateMemberId, query: string, forceRefresh: boolean | undefined, ctx: AggregateMemberContext): Promise<AggregateMemberOutcome> {
  try {
    // LANE-F-ENGINE-MEMBER（KTD3/R9 已实装）：engine 成员（extractor-capable EngineId）扇出经
    // runEngineAggregateMember——runEngineSearch({ tabs, completeTimeoutMs: 20_000 })、信号量 ≤3、
    // cached 恒缺省、错误分型原样透传；判型从 extractor registry 派生（KTD15），不做字符串散比。
    if (isEngineId(member)) {
      return await runEngineAggregateMember(member, query, ctx);
    }
    const resolution = await resolveAggregateMemberSource(member);
    if (!resolution) {
      return { sourceId: member, ok: false, errorKind: 'keyMissing', errorMessage: t(MSG.error_no_provider_key) };
    }
    const reply = await runProviderSearch(query, resolution, forceRefresh, ctx.signal);
    if (reply.ok) {
      return { sourceId: member, ok: true, ...(reply.cache.hit ? { cached: true } : {}), response: reply.response };
    }
    return { sourceId: member, ok: false, errorKind: reply.error.providerErrorKind ?? reply.error.kind, errorMessage: reply.error.message };
  } catch (e) {
    // runProviderSearch 会把 adapter 的 ProviderError 直接抛出（handleSearch 内由 try/catch 收口）——
    // 成员路径在此收口并保留分型（R6：不折叠到 'unknown'）。
    if (e instanceof ProviderError) {
      return { sourceId: member, ok: false, errorKind: e.kind, errorMessage: e.message };
    }
    return { sourceId: member, ok: false, errorKind: 'unknown', errorMessage: errorMessage(e) };
  }
}

// KTD15②（决策注释）：聚合的 engine 成员**不走** engineSearchEnabled 门控。该门控的语义是
// 「外部进程代理加载第三方页」的 agent 门（CONCEPTS.md:126；default-off-capability-gating-for-cws-
// compliance.md 的默认关闭要求只针对程序化路径），其 :83 豁免条款明确不覆盖用户经可见 UI 主动
// 触发的能力——用户在 Options 聚合编辑器勾选 engine 成员即显式 opt-in（警示文案 = KTD15③）。
// 判据全文与三条件索引：docs/solutions/architecture-patterns/engine-extraction-for-user-initiated-aggregate.md。
async function runEngineAggregateMember(member: EngineId, query: string, ctx: AggregateMemberContext): Promise<AggregateMemberOutcome> {
  // 扇出侧资格判定共用 eligibility 的单一派生源（R9，勿另写清单）：registry 漂移（engine 被移除/
  // 降级为 UNSUPPORTED_EXTRACTOR 后成员残留）→ 该成员失败标注，不 throw 整体。
  if (!extractorCapableEngineIds().includes(member)) {
    return { sourceId: member, ok: false, errorKind: 'unsupported-engine', errorMessage: 'unsupported-engine' };
  }
  // 信号量仅约束 engine 成员（provider 成员并发不受限，KTD3）；deps 注入沿 background.ts 先例
  //（{ tabs: browser.tabs, completeTimeoutMs }），总预算 20s（AGGREGATE_ENGINE_MEMBER_TIMEOUT_MS）。
  const result = await ctx.engineSlots(() =>
    runEngineSearch({ query, engineId: member }, ctx.signal, { tabs: browser.tabs, completeTimeoutMs: AGGREGATE_ENGINE_MEMBER_TIMEOUT_MS }),
  );
  if ('results' in result) {
    // engine 成员恒实时抽取（R6/R7：无子缓存，cached 恒缺省）；无综合答案 → 空答案贡献（R4）。
    // EngineId ≠ ProviderId（两个不相交 id 域）：engine 的临时归一响应借位 provider 字段——该响应
    // 只进聚合 merge（merge 只读 answer/results），绝不触 getAdapter/getKey，绝不单独入子缓存。
    const response: NormalizedSearchResponse = { query, provider: member as unknown as ProviderId, results: result.results };
    return { sourceId: member, ok: true, response };
  }
  // 错误种类原样透传（R6：page-state（challenge/consent/unsupported-layout/no-results）与
  // orchestration（tab-closed/timeout/aborted/extract-failed）分型不折叠——engine-search-orchestration 教训）。
  return { sourceId: member, ok: false, errorKind: result.error, errorMessage: result.error };
}

/** 成员解析（resolveSearchSource 语义的成员版）：显式成员且已配置才执行；
 *  裸 provider 有实例时路由第一个实例并注入 options（默认实例；cacheKeyId 与 solo/agent 搜索同源），
 *  实例 id 直接走 resolveInstance——成员子缓存键因此与 IU6 实例键一致。 */
async function resolveAggregateMemberSource(member: ProviderId | ProviderInstanceId): Promise<{
  providerId: ProviderId;
  providerSettings?: Record<string, unknown>;
  cacheKeyId: string;
} | null> {
  if (isProviderInstanceId(member)) return resolveInstance(member);
  const configured = await getConfiguredProviderIds();
  if (!configured.includes(member)) return null;
  return resolveBareProvider(member);
}

/** rerank 结果应用（R5/KTD3）：按 relevance_score 降序写 NormalizedResult.score（同分稳定保持候选序），
 *  截取实例 topN。畸形服务端响应的重复 index 用 seen 集合跳过（首现有效），同一候选绝不重复投影
 *  （Oracle #6 防御；去重放在唯一消费点，validateRerankResults 保持纯形状校验——形状与语义分层）。
 *  服务端返回空/越界下标时防御性保留候选序（不因畸形服务响应丢结果）。 */
function applyRerankOrdering(candidates: AggregateMergedResult[], rerankResults: RerankResultItem[], topN: number): AggregateMergedResult[] {
  if (rerankResults.length === 0) return candidates.slice(0, topN);
  const seen = new Set<number>();
  return rerankResults
    .filter((item) => {
      if (!(Number.isInteger(item.index) && item.index >= 0 && item.index < candidates.length)) return false;
      if (seen.has(item.index)) return false;
      seen.add(item.index);
      return true;
    })
    .map((item, position) => ({ item, position }))
    .sort((a, b) => b.item.relevance_score - a.item.relevance_score || a.position - b.position)
    .slice(0, topN)
    .map(({ item }) => ({ ...candidates[item.index], score: item.relevance_score }));
}

/** 聚合回复错误映射：RerankError → providerError + rerank 专用文案（AE3：失败不降级，绝不返回未重排结果）；
 *  其余同 toSearchError。 */
function toAggregateSearchError(e: unknown): AggregateSearchReply {
  if (e instanceof RerankError) {
    return { ok: false, error: { kind: 'providerError', message: t(MSG_AGGREGATE_RERANK_FAILED, e.message), providerErrorKind: e.kind } };
  }
  return toSearchError(e);
}

/** 保存全局 rerank 配置（KTD12/KTD9）：endpoint loopback 校验 + localhost/[::1] 自动改写为 127.0.0.1
 *  （保留端口/路径，reply 带改写标志供 UI 提示）；最终必须 http + 127.0.0.1 否则拒绝。
 *  成功持久化后删除全部聚合缓存条目——设置不在缓存键内 ⇒ 写时失效（AE5 第二行）。 */
export async function handleSetRerankConfig(config: { endpoint: string; model?: string; apiKey?: string }): Promise<SetRerankConfigReply> {
  await getSchemaReady();
  const validation = validateRerankEndpoint(config.endpoint);
  if (!validation.ok) {
    return { ok: false, error: { kind: 'invalid', message: t(MSG_RERANK_ENDPOINT_INVALID) } };
  }
  await setRerankConfig({
    endpoint: validation.endpoint,
    ...(config.model !== undefined ? { model: config.model } : {}),
    ...(config.apiKey !== undefined ? { apiKey: config.apiKey } : {}),
  });
  await deleteAggregateCacheEntries('all');
  return { ok: true, endpoint: validation.endpoint, rewritten: validation.rewritten };
}

/** 设置页「测试连接」（KTD6/R12）：复用 rerank-client testRerank（1 query + 2 小文档），TestKeyReply 同款形状。 */
export async function handleTestRerank(): Promise<TestKeyReply> {
  await getSchemaReady();
  try {
    const config = await getRerankConfig();
    await testRerank(config, { fetch: (...args) => fetch(...args) });
    return { ok: true };
  } catch (e) {
    if (e instanceof RerankError) {
      return {
        ok: false,
        error: {
          kind: e.kind === 'keyMissing' ? 'keyMissing' : 'providerError',
          message: e.kind === 'keyMissing' ? t(MSG_AGGREGATE_RERANK_NOT_CONFIGURED) : e.message,
        },
      };
    }
    const reply = toSearchError(e);
    return { ok: false, error: { kind: 'providerError', message: reply.error.message } };
  }
}

// === 聚合实例 CRUD（KTD18 实体、KTD9 精确失效）===

export async function handleCreateAggregateInstance(data: { name: string; members: AggregateMemberId[]; topN?: number }): Promise<AggregateInstance> {
  await getSchemaReady();
  // 归一/容量/字节预算校验在 store（normalizeAggregateInstance + 双队列锁序）。
  return createAggregateInstance(data);
}

export async function handleUpdateAggregateInstance(data: { id: AggregateInstanceId; patch: { name?: string; members?: AggregateMemberId[]; topN?: number } }): Promise<AggregateInstance | null> {
  await getSchemaReady();
  if (!isAggregateInstanceId(data.id)) throw new Error('invalid_aggregate_instance');
  // KTD9 精确失效（AE5 第一行）：members/topN **实际变更** → 仅该实例条目；改名不失效；
  // 其他实例条目与 provider 历史条目一律存活。
  const before = (await getAggregateInstances()).find((candidate) => candidate.id === data.id);
  const updated = await updateAggregateInstance(data.id, data.patch);
  if (updated && before && (JSON.stringify(before.members) !== JSON.stringify(updated.members) || before.topN !== updated.topN)) {
    await deleteAggregateCacheEntries(data.id);
  }
  return updated;
}

export async function handleDeleteAggregateInstance(id: AggregateInstanceId): Promise<void> {
  await getSchemaReady();
  if (!isAggregateInstanceId(id)) throw new Error('invalid_aggregate_instance');
  await deleteAggregateInstance(id);
  // KTD9：删除实例 → 仅该实例条目失效（order/hidden 剥落与 activeSource 派生回退在 store）。
  await deleteAggregateCacheEntries(id);
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

// options 经 store 侧 normalizeSiteInstanceDefinition 白名单兜底（KTD5）；
// UI 建侧总是写显式 mode（KTD4），worker 不再补默认。
export async function handleCreateSiteInstance(data: { name: string; target: string; engineId: SiteInstanceEngineId; options?: SiteInstanceOptions }): Promise<SiteInstanceDefinition> {
  await getSchemaReady();
  return createSiteInstanceDefinition({ ...data, id: `site:${crypto.randomUUID()}` });
}

export async function handleUpdateSiteInstance(data: { id: SiteInstanceId; name: string; target: string; engineId: SiteInstanceEngineId; options?: SiteInstanceOptions }): Promise<SiteInstanceDefinition> {
  await getSchemaReady();
  return updateSiteInstanceDefinition(data.id, data);
}

export async function handleDeleteSiteInstance(siteId: SiteInstanceId): Promise<void> {
  await getSchemaReady();
  if (!isSiteInstanceId(siteId)) throw new Error('invalid_site_instance');
  await deleteSiteInstanceDefinition(siteId);
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

/** 设置「少量来源自动平铺」开关（默认 true）。 */
export async function handleSetFlatLayoutFewSources(value: boolean): Promise<void> {
  await getSchemaReady();
  await setFlatLayoutFewSources(value);
}

/** 设置划词搜索开关（默认 true）。 */
export async function handleSetSelectionSearchEnabled(value: boolean): Promise<void> {
  await getSchemaReady();
  await setSelectionSearchEnabled(value);
}

/** 设置划词搜索固定源（null = 跟随激活源）。 */
export async function handleSetSelectionSearchSource(sourceId: string | null): Promise<void> {
  await getSchemaReady();
  await setSelectionSearchSource(sourceId);
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

// Chrome 对 data: URL 下载不可靠地应用 filename（回退默认名，中文 locale 为「下载」）；
// 且当任意扩展注册 onDeterminingFilename 监听器时 filename 参数被完全忽略
//（Chromium 579563，官方 downloads.idl 明文）。注册本扩展自己的监听器，对由本扩展
// 发起的下载强制 suggest 正确文件名，其他下载放行。Firefox 无此 API 也无此问题。
const pendingFilenames: string[] = [];

/** 在 worker 启动时调用一次：注册 onDeterminingFilename 监听器，强制本扩展发起的
 *  下载使用指定文件名（绕过 data: URL 与冲突扩展导致的 filename 被忽略问题）。 */
export function installDownloadFilenameGuard(): void {
  const events = browser.downloads?.onDeterminingFilename;
  if (!events) return; // Firefox / 不支持：filename 参数本身可靠，无需修复
  events.addListener((item, suggest) => {
    if (item.byExtensionId === browser.runtime.id && pendingFilenames.length > 0) {
      suggest({ filename: pendingFilenames.shift()! });
    } else {
      suggest(); // 放行：非本扩展发起，或队列空（兜底用 Chrome 默认名）
    }
  });
}

async function triggerDownload(url: string, filename: string): Promise<void> {
  // Firefox 拒绝 data: URL 下载（bug 1318564，仍 open）；event page 有 URL.createObjectURL，
  // 转 blob: URL 绕过。Chrome service worker 无 URL.createObjectURL，保留 data: URL + 下方守卫。
  let downloadUrl = url;
  if (url.startsWith('data:') && typeof URL.createObjectURL === 'function') {
    const blob = await (await fetch(url)).blob();
    downloadUrl = URL.createObjectURL(blob);
  }
  pendingFilenames.push(filename);
  await browser.downloads.download({ url: downloadUrl, filename, saveAs: true });
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
    // 哨兵判别（键空间不相交：agg: 前缀永不等于 provider/inst: 键）——防御性收窄到 solo 形状。
    if (cached && !isAggregateCacheEntry(cached)) {
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
