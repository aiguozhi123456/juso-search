// 配置导入/导出（仅 config 域，不含缓存池）。
//
// 设计：
// - 导出由 worker 组装 payload（worker 本就是 key 的唯一读者），精确读 config 键，
//   不读 searchCacheEntry 池；payload 含明文 key（BYOK 数据归用户，文件归用户所有）。
// - 导入走校验 + 合并语义：providerKeys 仅填空（不覆盖已有 key），prefs 显式包含才覆盖。
// - 所有 storage IO 走精确键，绝不 get(null)。
//
// 安全（R7）：本模块只在 worker 上下文调用（由 gateway handler 触发），不进入页面代码。

import type { BarPositionPref, LocalePref, ThemePref } from './storage';
import { PROVIDER_INSTANCES_KEY } from './storage';
import {
  ACTIVE_KEY,
  ACTIVE_SOURCE_KEY,
  AGGREGATE_INSTANCES_KEY,
  KEYS_KEY,
  LOCALE_KEY,
  MAX_RESULTS_KEY,
  RERANK_CONFIG_KEY,
  SOURCE_HIDDEN_KEY,
  SOURCE_ORDER_KEY,
  SITE_INSTANCES_KEY,
  CUSTOM_ENGINES_KEY,
  THEME_KEY,
  GROUP_CONFIG_KEY,
  BAR_POSITION_KEY,
  AI_AUTO_ENTER_KEY,
  FLAT_LAYOUT_FEW_SOURCES_KEY,
  clampMaxResults,
  deleteAggregateCacheEntries,
  withSharedKeyWrite,
} from './storage';
import { allProviders } from './providers/registry';
import type { ProviderId } from './providers/types';
import type { EngineId } from './engines/types';
import { allKnownSourceIds, isEngineId, isKnownSiteInstanceId, isKnownCustomEngineId, isProviderId, normalizeSourceHidden, normalizeSourceOrder, resolveEffectiveActiveSource, visibleUsableSource, type AggregateSourceDefinition, type SourceId } from './sources';
import type { GroupConfig } from './source-groups';
import { normalizeGroupConfig } from './source-groups';
import { CURRENT_SCHEMA_VERSION } from './schema';
import type { SiteInstanceDefinition } from './site-instances';
import { constructionFor, isBoundedSiteInstanceCollection, isSiteInstanceId, normalizeSiteInstanceDefinitions, zhanneiFingerprintFor } from './site-instances';
import type { ProviderInstance } from './provider-instances';
import { isBoundedProviderInstanceCollection, isProviderInstanceId, normalizeProviderInstances } from './provider-instances';
import type { CustomEngineDefinition } from './custom-engines';
import { isBoundedCustomEngineCollection, isCustomEngineId, normalizeCustomEngineDefinitions } from './custom-engines';
import type { AggregateInstance } from './aggregate-instances';
import { isAggregateInstanceId, isBoundedAggregateInstanceCollection, normalizeAggregateInstances } from './aggregate-instances';
import type { RerankConfig } from './aggregate/types';
import { normalizeRerankConfig, validateRerankEndpoint } from './aggregate/rerank-client';
import { buildAggregateProjection } from './storage';
import { isRegisteredAiEngineId } from './ai-engines/registry';
import { serializedSize } from './serialized-size';

const KNOWN_PROVIDER_IDS = new Set<ProviderId>(allProviders().map((p) => p.id));
const THEME_VALUES = new Set<ThemePref>(['auto', 'light', 'dark']);
const LOCALE_VALUES = new Set<LocalePref>(['auto', 'zh_CN', 'en']);
const BAR_POSITION_VALUES = new Set<BarPositionPref>(['auto', 'top', 'inline', 'bottom']);
const DEFAULT_ENGINE_ID: EngineId = 'google';
const MAX_IMPORT_BYTES = 256 * 1024;
/** 导入可接受的最旧 schema 版本（v3 遗留，无 siteInstances/groupConfig）。与 CURRENT_SCHEMA_VERSION 构成连续支持区间。 */
const MIN_SUPPORTED_SCHEMA_VERSION = 3;

/** config 域精确读取键集：buildExportPayload / previewImport / mergeImport 三处共用同一份，
 *  增删 config 键只改这里——三处读取集漂移会让 preview diff 出 merge 已不读（或漏读）的键。 */
const CONFIG_IO_KEYS = [KEYS_KEY, ACTIVE_KEY, ACTIVE_SOURCE_KEY, THEME_KEY, LOCALE_KEY, BAR_POSITION_KEY, AI_AUTO_ENTER_KEY, FLAT_LAYOUT_FEW_SOURCES_KEY, SOURCE_ORDER_KEY, SOURCE_HIDDEN_KEY, SITE_INSTANCES_KEY, CUSTOM_ENGINES_KEY, PROVIDER_INSTANCES_KEY, AGGREGATE_INSTANCES_KEY, RERANK_CONFIG_KEY, MAX_RESULTS_KEY, GROUP_CONFIG_KEY] as const;

/** 导出文件结构。schemaVersion 用 number（非字面量），避免版本升级后类型过度约束。 */
export interface ConfigExport {
  schemaVersion: number;
  exportedAt: number;
  appVersion: string;
  providerKeys: Record<string, string>;
  activeProvider: ProviderId | null;
  activeSource: SourceId | null;
  themePref: ThemePref;
  localePref: LocalePref;
  serpBarPosition?: BarPositionPref;
  /** AI engine 自动回车开关（默认 true）。 */
  aiAutoEnter?: boolean;
  /** 少量来源自动平铺开关（默认 true）。 */
  flatLayoutFewSources?: boolean;
  sourceOrder?: SourceId[];
  sourceHidden?: SourceId[];
  /** Absent in legacy v3 exports; absence preserves local Site Engines. */
  siteInstances?: SiteInstanceDefinition[];
  /** Absent in legacy exports; absence preserves local Custom Engines. */
  customEngines?: CustomEngineDefinition[];
  /** Absent in legacy exports; absence preserves local Provider Instances. */
  providerInstances?: ProviderInstance[];
  /** Absent in legacy exports; absence preserves local Aggregate Instances（KTD13/Oracle F3 preserve）。 */
  aggregateInstances?: AggregateInstance[];
  /** 全局 rerank 配置（KTD10/KTD13）：apiKey 明文随导出（与 providerKeys 同设计）；缺失保留本地。 */
  rerankConfig?: RerankConfig;
  /** 每个 provider 的搜索结果条数（仅含已显式设置的 id）。 */
  providerMaxResults?: Partial<Record<ProviderId, number>>;
  /** 来源分组与顶层布局（导入文件可选；缺失则保留本地配置）。 */
  groupConfig?: GroupConfig;
}

/** worker 端组装导出 payload。精确读 config 键，不读缓存池。 */
export async function buildExportPayload(): Promise<ConfigExport> {
  const got = await browser.storage.local.get([...CONFIG_IO_KEYS]);
  const siteInstances = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
  const customEngines = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
  const providerInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  const aggregateInstances = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
  const keys = (got[KEYS_KEY] ?? {}) as Record<string, unknown>;
  const providerKeys = normalizeProviderKeys(keys);
  const activeRaw = got[ACTIVE_KEY];
  const active = KNOWN_PROVIDER_IDS.has(activeRaw as ProviderId) ? (activeRaw as ProviderId) : null;
  // KTD5：导出侧 activeSource 解析受理聚合（定义集 = 本地全量实例，eligibility 输入 = 本地 keys/
  // 实例/rerank）——与 snapshot 的 getActiveSourceId 共用同一 resolve（fallback 自动一致）。
  const aggregateProjection = buildAggregateProjection(got[AGGREGATE_INSTANCES_KEY], got[RERANK_CONFIG_KEY], providerKeys, providerInstances);
  const activeSource = resolveEffectiveActiveSource(
    (typeof got[ACTIVE_SOURCE_KEY] === 'string' ? got[ACTIVE_SOURCE_KEY] as SourceId : null) ?? active,
    providerKeys,
    siteInstances,
    customEngines,
    providerInstances,
    aggregateProjection.sources,
  ) ?? DEFAULT_ENGINE_ID;
  const theme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
  const locale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
  const barPosition = BAR_POSITION_VALUES.has(got[BAR_POSITION_KEY] as BarPositionPref) ? (got[BAR_POSITION_KEY] as BarPositionPref) : 'auto';
  const knownSourceIds = allKnownSourceIds(siteInstances, customEngines, providerInstances, aggregateInstances);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion: getAppVersion(),
    providerKeys,
    activeProvider: active,
    activeSource,
    themePref: theme,
    localePref: locale,
    serpBarPosition: barPosition,
    aiAutoEnter: got[AI_AUTO_ENTER_KEY] !== false,
    flatLayoutFewSources: got[FLAT_LAYOUT_FEW_SOURCES_KEY] !== false,
    // KTD4/F2：定义集 = 本地全量聚合实例（与 eligibility 无关）——本地 order/hidden 中的 agg id
    // 由 normalize 直接收敛保留（Lane C 折叠，手术式回注已删除）。
    sourceOrder: normalizeSourceOrder(got[SOURCE_ORDER_KEY], siteInstances, customEngines, providerInstances, aggregateInstances),
    sourceHidden: normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], siteInstances, customEngines, providerInstances, aggregateInstances),
    siteInstances,
    customEngines,
    providerInstances,
    aggregateInstances,
    rerankConfig: normalizeRerankConfig(got[RERANK_CONFIG_KEY]),
    providerMaxResults: normalizeMaxResultsMap(got[MAX_RESULTS_KEY]),
    groupConfig: got[GROUP_CONFIG_KEY] && typeof got[GROUP_CONFIG_KEY] === 'object'
      ? normalizeGroupConfig(got[GROUP_CONFIG_KEY], knownSourceIds)
      : undefined,
  };
}

function getAppVersion(): string {
  const manifest = browser.runtime.getManifest();
  return manifest?.version ?? '0.0.0';
}

// === 导入校验 ===

export type ParseResult =
  | { ok: true; value: ConfigExport }
  | { ok: false; error: string };

/**
 * 校验导入文件原始内容。严格：schemaVersion 必须落在 [MIN_SUPPORTED_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION] 区间，providerKeys 的 id 必须全已知、
 * 值必须是 string，activeProvider 必须是已知 id 或 null，prefs 必须是合法枚举值。
 * 任何不合规都返回 ok:false（不抛异常），调用方负责把 error 转为面向用户的消息。
 */
export function parseImportPayload(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_format' };
  }
  const obj = raw as Record<string, unknown>;
  if (serializedSize(raw) > MAX_IMPORT_BYTES) return { ok: false, error: 'import_too_large' };
  // 接受连续支持区间 [MIN_SUPPORTED_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION]：下限 3 是最旧的遗留版本
  // （无 siteInstances/groupConfig），上限随 CURRENT_SCHEMA_VERSION 演进。用区间而非硬编码版本列表，
  // 避免下次 bump 后静默拒绝当前版本的备份（如 v6→v7 时拒绝仍有效的 v6 备份）。
  const schemaVersion = obj.schemaVersion;
  if (typeof schemaVersion !== 'number' || schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION || schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: 'schema_version_mismatch' };
  }
  // 旧备份(v<8)的 'top' 语义为内联引擎锚点插入；v8 起 'top' 重定义为固定覆盖顶栏。
  // 导入旧备份时 remap 'top'→'inline'，保持旧备份语义不变（与新 'top' 覆盖语义区分）。
  if (schemaVersion < 8 && obj.serpBarPosition === 'top') obj.serpBarPosition = 'inline';
  const pk = obj.providerKeys;
  if (!pk || typeof pk !== 'object' || Array.isArray(pk)) {
    return { ok: false, error: 'invalid_provider_keys' };
  }
  const providerKeys: Record<string, string> = {};
  for (const [id, k] of Object.entries(pk as Record<string, unknown>)) {
    if (!KNOWN_PROVIDER_IDS.has(id as ProviderId)) return { ok: false, error: 'unknown_provider' };
    if (typeof k !== 'string' || k.length === 0) return { ok: false, error: 'invalid_key_value' };
    providerKeys[id] = k;
  }
  const active = obj.activeProvider;
  if (active !== null && !KNOWN_PROVIDER_IDS.has(active as ProviderId)) {
    return { ok: false, error: 'invalid_active_provider' };
  }
  const isLegacyV3 = obj.schemaVersion === 3;
  // 导出字段 v10 起为 siteInstances；旧备份（v10 前导出）用 siteEngines——永久双认，
  // 存量备份文件不做迁移。两字段同时出现时新字段优先。
  const siteRaw = obj.siteInstances !== undefined ? obj.siteInstances : obj.siteEngines;
  if (!isLegacyV3 && !isBoundedSiteInstanceCollection(siteRaw)) return { ok: false, error: 'invalid_site_instances' };
  const siteInstances = isLegacyV3 ? undefined : normalizeSiteInstanceDefinitions(siteRaw);
  if (!isLegacyV3 && (!siteInstances || !Array.isArray(siteRaw) || siteInstances.length !== siteRaw.length)) return { ok: false, error: 'invalid_site_instances' };
  const hasCustomEngines = Object.prototype.hasOwnProperty.call(obj, 'customEngines');
  let customEngines: CustomEngineDefinition[] | undefined;
  if (hasCustomEngines) {
    if (!isBoundedCustomEngineCollection(obj.customEngines)) return { ok: false, error: 'invalid_custom_engines' };
    customEngines = normalizeCustomEngineDefinitions(obj.customEngines);
    if (!Array.isArray(obj.customEngines) || customEngines.length !== obj.customEngines.length) return { ok: false, error: 'invalid_custom_engines' };
  }
  // Provider Instances 是新增字段：缺失（legacy/部分导出）保留本地实例；存在时必须整体合法且受预算约束。
  const hasProviderInstances = Object.prototype.hasOwnProperty.call(obj, 'providerInstances');
  let providerInstances: ProviderInstance[] | undefined;
  if (hasProviderInstances) {
    if (!isBoundedProviderInstanceCollection(obj.providerInstances)) return { ok: false, error: 'invalid_provider_instances' };
    providerInstances = normalizeProviderInstances(obj.providerInstances);
    if (!Array.isArray(obj.providerInstances) || providerInstances.length !== obj.providerInstances.length) return { ok: false, error: 'invalid_provider_instances' };
  }
  // Aggregate Instances（KTD13）：同 providerInstances 语义——缺失保留本地；存在时 isBounded +
  // normalize 长度等值（逐条校验 + 首现去重），非法拒收 invalid_aggregate_instances。
  const hasAggregateInstances = Object.prototype.hasOwnProperty.call(obj, 'aggregateInstances');
  let aggregateInstances: AggregateInstance[] | undefined;
  if (hasAggregateInstances) {
    if (!isBoundedAggregateInstanceCollection(obj.aggregateInstances)) return { ok: false, error: 'invalid_aggregate_instances' };
    aggregateInstances = normalizeAggregateInstances(obj.aggregateInstances);
    if (!Array.isArray(obj.aggregateInstances) || aggregateInstances.length !== obj.aggregateInstances.length) return { ok: false, error: 'invalid_aggregate_instances' };
  }
  // rerankConfig（KTD12/KTD13）：endpoint 复用 KTD12 loopback 校验（localhost/[::1] 同步改写为
  // 127.0.0.1），非法拒收 invalid_rerank_config；endpoint 为空 = 未配置态，合法放行。缺失保留本地。
  const hasRerankConfig = Object.prototype.hasOwnProperty.call(obj, 'rerankConfig');
  let rerankConfig: RerankConfig | undefined;
  if (hasRerankConfig) {
    const normalizedRerank = normalizeRerankConfig(obj.rerankConfig);
    if (normalizedRerank.endpoint !== '') {
      const endpointCheck = validateRerankEndpoint(normalizedRerank.endpoint);
      if (!endpointCheck.ok) return { ok: false, error: 'invalid_rerank_config' };
      rerankConfig = {
        endpoint: endpointCheck.endpoint,
        ...(normalizedRerank.model ? { model: normalizedRerank.model } : {}),
        ...(normalizedRerank.apiKey ? { apiKey: normalizedRerank.apiKey } : {}),
        ...(normalizedRerank.protocol ? { protocol: normalizedRerank.protocol } : {}),
      };
    } else {
      rerankConfig = normalizedRerank;
    }
  }
  const activeSource = obj.activeSource;
  if (activeSource !== undefined && activeSource !== null && !isKnownSource(activeSource, siteInstances, customEngines, providerInstances, isLegacyV3, aggregateInstances)) return { ok: false, error: 'invalid_active_source' };
  const theme = obj.themePref;
  if (!THEME_VALUES.has(theme as ThemePref)) return { ok: false, error: 'invalid_theme' };
  const locale = obj.localePref;
  if (!LOCALE_VALUES.has(locale as LocalePref)) return { ok: false, error: 'invalid_locale' };
  const hasBarPosition = Object.prototype.hasOwnProperty.call(obj, 'serpBarPosition');
  const barPosition = obj.serpBarPosition;
  if (hasBarPosition && !BAR_POSITION_VALUES.has(barPosition as BarPositionPref)) return { ok: false, error: 'invalid_bar_position' };
  const hasAiAutoEnter = Object.prototype.hasOwnProperty.call(obj, 'aiAutoEnter');
  const aiAutoEnter = obj.aiAutoEnter;
  if (hasAiAutoEnter && typeof aiAutoEnter !== 'boolean') return { ok: false, error: 'invalid_ai_auto_enter' };
  const hasFlatLayoutFewSources = Object.prototype.hasOwnProperty.call(obj, 'flatLayoutFewSources');
  const flatLayoutFewSources = obj.flatLayoutFewSources;
  if (hasFlatLayoutFewSources && typeof flatLayoutFewSources !== 'boolean') return { ok: false, error: 'invalid_flat_layout_few_sources' };
  const hasSourceOrder = Object.prototype.hasOwnProperty.call(obj, 'sourceOrder');
  const sourceOrder = obj.sourceOrder;
  if (hasSourceOrder) {
    if (!Array.isArray(sourceOrder)) return { ok: false, error: 'invalid_source_order' };
    const seen = new Set<SourceId>();
    for (const sourceId of sourceOrder) {
      if (!isKnownSource(sourceId, siteInstances, customEngines, providerInstances, isLegacyV3, aggregateInstances) || seen.has(sourceId)) return { ok: false, error: 'invalid_source_order' };
      seen.add(sourceId);
    }
  }
  const hasSourceHidden = Object.prototype.hasOwnProperty.call(obj, 'sourceHidden');
  const sourceHidden = obj.sourceHidden;
  if (hasSourceHidden) {
    if (!Array.isArray(sourceHidden)) return { ok: false, error: 'invalid_source_hidden' };
    const seenHidden = new Set<SourceId>();
    for (const sourceId of sourceHidden) {
      if (!isKnownSource(sourceId, siteInstances, customEngines, providerInstances, isLegacyV3, aggregateInstances) || seenHidden.has(sourceId)) return { ok: false, error: 'invalid_source_hidden' };
      seenHidden.add(sourceId);
    }
  }
  const hasMaxResults = Object.prototype.hasOwnProperty.call(obj, 'providerMaxResults');
  const providerMaxResults = hasMaxResults ? normalizeMaxResultsMap(obj.providerMaxResults) : undefined;
  const hasGroupConfig = Object.prototype.hasOwnProperty.call(obj, 'groupConfig');
  let groupConfig: GroupConfig | undefined;
  if (hasGroupConfig) {
    // normalizeGroupConfig 容错：非法结构会被规整为默认配置，不阻断导入。
    // 已知集含 payload 聚合定义集（缺失 = []，此时含 agg id 的赋值会被剔除——与 order/hidden 校验同判据）。
    groupConfig = normalizeGroupConfig(obj.groupConfig, allKnownSourceIds(siteInstances ?? [], customEngines ?? [], providerInstances ?? [], aggregateInstances ?? []));
  }
  return {
    ok: true,
    value: {
      schemaVersion,
      exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
      appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
      providerKeys,
      activeProvider: active as ProviderId | null,
      activeSource: activeSource === undefined ? active as ProviderId | null : activeSource as SourceId | null,
      themePref: theme as ThemePref,
      localePref: locale as LocalePref,
      serpBarPosition: hasBarPosition ? barPosition as BarPositionPref : undefined,
      aiAutoEnter: hasAiAutoEnter ? aiAutoEnter as boolean : undefined,
      flatLayoutFewSources: hasFlatLayoutFewSources ? flatLayoutFewSources as boolean : undefined,
      // KTD4/F2：定义集 = payload 聚合实例集（校验层已保证仅其成员可出现 agg id）——
      // normalize 直调保留（Lane C 折叠，withAggregateIdsPreserved 包裹已删除）。
      // 定义集显式必传（?? []，与 aggregateInstances 同风格）：缺省参数会让 undefined
      // 静默剥掉 site:/custom:/inst: 动态 id，造成「校验接受、归一化丢弃」的分裂。
      sourceOrder: hasSourceOrder ? normalizeSourceOrder(sourceOrder, siteInstances ?? [], customEngines ?? [], providerInstances ?? [], aggregateInstances ?? []) : undefined,
      sourceHidden: hasSourceHidden ? normalizeSourceHidden(sourceHidden, siteInstances ?? [], customEngines ?? [], providerInstances ?? [], aggregateInstances ?? []) : undefined,
      siteInstances,
      customEngines,
      providerInstances,
      aggregateInstances,
      rerankConfig,
      providerMaxResults,
      groupConfig,
    },
  };
}

// === 导入合并 ===

export interface ImportReport {
  /** 写入的 provider id（当前空槽被导入 key 填上的）。 */
  written: ProviderId[];
  /** 跳过的 provider id（当前已有 key，导入 key 未覆盖）。 */
  skipped: ProviderId[];
  /** 是否覆盖了 activeProvider（仅当 applyPrefs 且当前值不同）。 */
  activeProviderOverridden: boolean;
  /** 是否覆盖了 activeSource。 */
  activeSourceOverridden: boolean;
  /** 是否覆盖了 themePref。 */
  themePrefOverridden: boolean;
  /** 是否覆盖了 localePref。 */
  localePrefOverridden: boolean;
  /** 是否覆盖了 serpBarPosition。 */
  serpBarPositionOverridden: boolean;
  /** 是否覆盖了 aiAutoEnter。 */
  aiAutoEnterOverridden: boolean;
  /** 是否覆盖了 flatLayoutFewSources。 */
  flatLayoutFewSourcesOverridden: boolean;
  /** 是否覆盖了 sourceOrder。 */
  sourceOrderOverridden: boolean;
  /** 是否覆盖了 sourceHidden。 */
  sourceHiddenOverridden: boolean;
  /** 是否覆盖了 Site Engine definitions。 */
  siteInstancesOverridden: boolean;
  /** 是否覆盖了 Custom Engine definitions。 */
  customEnginesOverridden: boolean;
  /** 是否覆盖了 Provider Instance definitions。 */
  providerInstancesOverridden: boolean;
  /** 是否覆盖了 Aggregate Instance definitions（KTD13：整数组替换）。 */
  aggregateInstancesOverridden: boolean;
  /** 是否覆盖了 rerank 的 endpoint/model（KTD13；apiKey 仅填空不计入）。实际变更时聚合缓存已全量失效（KTD9/F5）。 */
  rerankConfigOverridden: boolean;
  /** 是否覆盖了 providerMaxResults。 */
  providerMaxResultsOverridden: boolean;
  /** 是否覆盖了 groupConfig（来源分组与顶层布局）。 */
  groupConfigOverridden: boolean;
}

/** 单个 pref 的预览 diff：from 当前值 -> to 导入值（仅当两者不同时为 diff）。 */
export interface PrefDiff {
  key: 'activeProvider' | 'activeSource' | 'themePref' | 'localePref' | 'serpBarPosition' | 'aiAutoEnter' | 'flatLayoutFewSources' | 'sourceOrder' | 'sourceHidden' | 'siteInstances' | 'customEngines' | 'providerInstances' | 'aggregateInstances' | 'rerankConfig' | 'providerMaxResults' | 'groupConfig';
  from: string | null;
  to: string | null;
}

/** previewImport 的返回：dry-run，不写 storage。供 UI 展示 diff + 确认。 */
export interface ImportPreview {
  /** 将被填空的 provider id（当前无 key，导入会写入）。 */
  written: ProviderId[];
  /** 跳过的 provider id（当前已有 key，导入不覆盖）。 */
  skipped: ProviderId[];
  /** prefs 的实际 diff（仅包含 from !== to 的项）。空 = 无 pref 变更。 */
  prefDiffs: PrefDiff[];
}

/**
 * 预览导入效果（dry-run）。不写 storage。
 * 调用方先 parseImportPayload 校验通过，再调用此函数展示 diff。
 * 当 prefDiffs 非空时，UI 应弹出确认对话框；用户确认后调 mergeImport(payload, { applyPrefs: true })。
 */
export async function previewImport(payload: ConfigExport): Promise<ImportPreview> {
  const got = await browser.storage.local.get([...CONFIG_IO_KEYS]);
  const current = (got[KEYS_KEY] ?? {}) as Record<string, unknown>;

  const written: ProviderId[] = [];
  const skipped: ProviderId[] = [];
  for (const id of Object.keys(payload.providerKeys)) {
    const has = !!current[id] && typeof current[id] === 'string';
    if (!has) written.push(id as ProviderId);
    else skipped.push(id as ProviderId);
  }

  const prefDiffs: PrefDiff[] = [];
  const curActive = KNOWN_PROVIDER_IDS.has(got[ACTIVE_KEY] as ProviderId) ? (got[ACTIVE_KEY] as ProviderId) : null;
  const newActive = payload.activeProvider;
  if (curActive !== newActive) {
    prefDiffs.push({ key: 'activeProvider', from: curActive, to: newActive });
  }
  const currentSites = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
  const currentCustoms = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
  const currentInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  if (payload.siteInstances !== undefined && !sameSiteInstances(currentSites, payload.siteInstances)) {
    prefDiffs.push({ key: 'siteInstances', from: siteInstancesSummary(currentSites), to: siteInstancesSummary(payload.siteInstances) });
  }
  if (payload.customEngines !== undefined && !sameCustomEngines(currentCustoms, payload.customEngines)) {
    prefDiffs.push({ key: 'customEngines', from: customEnginesSummary(currentCustoms), to: customEnginesSummary(payload.customEngines) });
  }
  if (payload.providerInstances !== undefined) {
    if (!sameProviderInstances(currentInstances, payload.providerInstances)) {
      prefDiffs.push({ key: 'providerInstances', from: providerInstancesSummary(currentInstances), to: providerInstancesSummary(payload.providerInstances) });
    }
  }
  // 聚合实例（KTD13）：整数组替换语义，summary 行 = id:name:成员数:topN。
  const currentAggregates = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
  if (payload.aggregateInstances !== undefined && !sameAggregateInstances(currentAggregates, payload.aggregateInstances)) {
    prefDiffs.push({ key: 'aggregateInstances', from: aggregateInstancesSummary(currentAggregates), to: aggregateInstancesSummary(payload.aggregateInstances) });
  }
  // rerankConfig（AE6/KTD13）：diff 只含 endpoint/model/protocol——**apiKey 绝不进预览**。
  if (payload.rerankConfig !== undefined) {
    const currentRerank = normalizeRerankConfig(got[RERANK_CONFIG_KEY]);
    if (currentRerank.endpoint !== payload.rerankConfig.endpoint || (currentRerank.model ?? undefined) !== (payload.rerankConfig.model ?? undefined) || (currentRerank.protocol ?? undefined) !== (payload.rerankConfig.protocol ?? undefined)) {
      prefDiffs.push({ key: 'rerankConfig', from: rerankConfigSummary(currentRerank), to: rerankConfigSummary(payload.rerankConfig) });
    }
  }
  const currentKeys = normalizeProviderKeys(current);
  const mergedKeys = mergeProviderKeys(currentKeys, payload.providerKeys);
  // dry-run（previewImport）保持纯读：用存储中的 rerank 配置解析 eligibility——落盘语义由 mergeImport 负责。
  const sourcePreferences = resolveImportedSourcePreferences(payload, got, currentSites, currentCustoms, currentKeys, mergedKeys, curActive, normalizeRerankConfig(got[RERANK_CONFIG_KEY]));
  if (sourcePreferences.curActiveSource !== sourcePreferences.newActiveSource) {
    prefDiffs.push({ key: 'activeSource', from: sourcePreferences.curActiveSource, to: sourcePreferences.newActiveSource });
  }
  const curTheme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
  if (curTheme !== payload.themePref) {
    prefDiffs.push({ key: 'themePref', from: curTheme, to: payload.themePref });
  }
  const curLocale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
  if (curLocale !== payload.localePref) {
    prefDiffs.push({ key: 'localePref', from: curLocale, to: payload.localePref });
  }
  const curBarPosition = BAR_POSITION_VALUES.has(got[BAR_POSITION_KEY] as BarPositionPref) ? (got[BAR_POSITION_KEY] as BarPositionPref) : 'auto';
  const newBarPosition = payload.serpBarPosition ?? 'auto';
  if (curBarPosition !== newBarPosition) {
    prefDiffs.push({ key: 'serpBarPosition', from: curBarPosition, to: newBarPosition });
  }
  const curAiAutoEnter = got[AI_AUTO_ENTER_KEY] !== false;
  const newAiAutoEnter = payload.aiAutoEnter ?? true;
  if (curAiAutoEnter !== newAiAutoEnter) {
    prefDiffs.push({ key: 'aiAutoEnter', from: String(curAiAutoEnter), to: String(newAiAutoEnter) });
  }
  const curFlatLayoutFewSources = got[FLAT_LAYOUT_FEW_SOURCES_KEY] !== false;
  const newFlatLayoutFewSources = payload.flatLayoutFewSources ?? true;
  if (curFlatLayoutFewSources !== newFlatLayoutFewSources) {
    prefDiffs.push({ key: 'flatLayoutFewSources', from: String(curFlatLayoutFewSources), to: String(newFlatLayoutFewSources) });
  }
  if (!sameSourceOrder(sourcePreferences.curSourceOrder, sourcePreferences.newSourceOrder)) {
    prefDiffs.push({ key: 'sourceOrder', from: sourcePreferences.curSourceOrder.join(' > '), to: sourcePreferences.newSourceOrder.join(' > ') });
  }
  if (!sameSourceOrder(sourcePreferences.curSourceHidden, sourcePreferences.newSourceHidden)) {
    prefDiffs.push({ key: 'sourceHidden', from: sourcePreferences.curSourceHidden.join(' > '), to: sourcePreferences.newSourceHidden.join(' > ') });
  }
  if (payload.providerMaxResults !== undefined) {
    const curMax = normalizeMaxResultsMap(got[MAX_RESULTS_KEY]);
    if (!sameMaxResultsMap(curMax, payload.providerMaxResults)) {
      prefDiffs.push({ key: 'providerMaxResults', from: maxResultsSummary(curMax), to: maxResultsSummary(payload.providerMaxResults) });
    }
  }
  if (payload.groupConfig !== undefined) {
    const curGroupRaw = got[GROUP_CONFIG_KEY];
    const curGroup = curGroupRaw && typeof curGroupRaw === 'object'
      ? normalizeGroupConfig(curGroupRaw, allKnownSourceIds(currentSites, currentCustoms, currentInstances, currentAggregates))
      : undefined;
    if (!sameGroupConfig(curGroup, payload.groupConfig)) {
      prefDiffs.push({ key: 'groupConfig', from: groupConfigSummary(curGroup), to: groupConfigSummary(payload.groupConfig) });
    }
  }
  return { written, skipped, prefDiffs };
}

/** groupConfig 的可读摘要（分组数 / 顶层项数 / 赋值数），用于 diff 展示。 */
function groupConfigSummary(config: GroupConfig | undefined): string {
  if (!config) return '()';
  return `(${config.groups.length}组/${config.layout.length}项/${Object.keys(config.assignments).length}赋值)`;
}

/** 比较 groupConfig 是否等价（结构化比较）。 */
function sameGroupConfig(a: GroupConfig | undefined, b: GroupConfig): boolean {
  if (!a) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 合并导入 payload 到 storage。合并语义：
 * - providerKeys：仅填空。导入 key 只写入当前没有 key 的 provider 槽位；既有 key 不覆盖、不删除。
 * - prefs：仅当 applyPrefs=true 时覆盖（用户在 preview 确认后传入）；默认 false = 不动 prefs。
 *
 * 推荐流程：previewImport → UI 展示 diff → 用户确认 → mergeImport(payload, { applyPrefs: true })。
 * 精确键 IO：先 get(KEYS_KEY) 判空，再单次 set 写回合并后的 keys（+ 可选 prefs）。
 * 调用方负责先 parseImportPayload 校验通过，再传入。
 */
export async function mergeImport(
  payload: ConfigExport,
  opts: { applyPrefs?: boolean } = {},
): Promise<ImportReport> {
  const applyPrefs = opts.applyPrefs === true;
  // 共享键写者统一走 withSharedKeyWrite 原语（锁序 source → keys → maxResults）：
  // 本函数整写 MAX_RESULTS_KEY，而 set/clearProviderMaxResults 只持专用队列，
  // 不串行化则并发保存的读改写会被这里的整体写回覆盖。
  return withSharedKeyWrite(async () => {
    const got = await browser.storage.local.get([...CONFIG_IO_KEYS]);
    const current = (got[KEYS_KEY] ?? {}) as Record<string, unknown>;

    const written: ProviderId[] = [];
    const skipped: ProviderId[] = [];
    const mergedKeys: Record<string, string> = {};
    // 保留当前所有合法 key
    for (const [id, k] of Object.entries(current)) {
      if (KNOWN_PROVIDER_IDS.has(id as ProviderId) && typeof k === 'string') {
        mergedKeys[id] = k;
      }
    }
    // 填空：导入的 key 只写入当前没有的槽位
    for (const [id, k] of Object.entries(payload.providerKeys)) {
      if (!mergedKeys[id]) {
        mergedKeys[id] = k;
        written.push(id as ProviderId);
      } else {
        skipped.push(id as ProviderId);
      }
    }

    const setObj: Record<string, unknown> = { [KEYS_KEY]: mergedKeys };

    // prefs 覆盖：仅当 applyPrefs=true 时写入。默认 false 保护用户显式 prefs 不被默认值覆盖。
    let activeOverridden = false;
    let activeSourceOverridden = false;
    let themeOverridden = false;
    let localeOverridden = false;
    let barPositionOverridden = false;
    let aiAutoEnterOverridden = false;
    let flatLayoutFewSourcesOverridden = false;
    let sourceOrderOverridden = false;
    let sourceHiddenOverridden = false;
    let siteInstancesOverridden = false;
    let customEnginesOverridden = false;
    let providerInstancesOverridden = false;
    let aggregateInstancesOverridden = false;
    let rerankConfigOverridden = false;
    let aggregateCacheInvalidated = false;
    let providerMaxResultsOverridden = false;
    let groupConfigOverridden = false;
    // rerankConfig（KTD13/F5）：apiKey 仅填空（providerKeys 同款，不依赖 applyPrefs）；
    // endpoint/model 随 pref——applyPrefs 且实际变更才写，并触发全部聚合缓存失效（KTD9 导入失效行）。
    // effectiveRerank = 合并后的 rerank 配置（无论是否落盘）：applyPrefs 改 endpoint/model 时，
    // 导入后聚合 eligibility 投影必须按它解析，否则新端点下才可用的聚合实例会被误判为不可用。
    let effectiveRerank = normalizeRerankConfig(got[RERANK_CONFIG_KEY]);
    if (payload.rerankConfig !== undefined) {
      const currentRerank = effectiveRerank;
      const importedRerank = payload.rerankConfig;
      let nextEndpoint = currentRerank.endpoint;
      let nextModel = currentRerank.model;
      if (applyPrefs && (importedRerank.endpoint !== currentRerank.endpoint || (importedRerank.model ?? undefined) !== (currentRerank.model ?? undefined))) {
        nextEndpoint = importedRerank.endpoint;
        nextModel = importedRerank.model;
        rerankConfigOverridden = true;
      }
      const nextApiKey = currentRerank.apiKey ?? importedRerank.apiKey;
      effectiveRerank = normalizeRerankConfig({
        endpoint: nextEndpoint,
        ...(nextModel ? { model: nextModel } : {}),
        ...(nextApiKey ? { apiKey: nextApiKey } : {}),
      });
      if (nextEndpoint !== currentRerank.endpoint || (nextModel ?? undefined) !== (currentRerank.model ?? undefined) || (nextApiKey ?? undefined) !== (currentRerank.apiKey ?? undefined)) {
        setObj[RERANK_CONFIG_KEY] = effectiveRerank;
      }
      // F5 用户裁决：仅 endpoint/model 实际变更触发失效；apiKey 仅填空不触发（不改 reranker 身份）。
      if (rerankConfigOverridden) aggregateCacheInvalidated = true;
    }
    if (applyPrefs) {
      const currentSites = normalizeSiteInstanceDefinitions(got[SITE_INSTANCES_KEY]);
      const currentCustoms = normalizeCustomEngineDefinitions(got[CUSTOM_ENGINES_KEY]);
      const currentInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
      const importedInstances = payload.providerInstances ?? currentInstances;
      const curActive = KNOWN_PROVIDER_IDS.has(got[ACTIVE_KEY] as ProviderId) ? (got[ACTIVE_KEY] as ProviderId) : null;
      const sourcePreferences = resolveImportedSourcePreferences(payload, got, currentSites, currentCustoms, normalizeProviderKeys(current), mergedKeys, curActive, effectiveRerank);
      const { importedSites, importedCustoms, curActiveSource, newActiveSource, curSourceOrder, newSourceOrder, curSourceHidden, newSourceHidden } = sourcePreferences;
      if (payload.siteInstances !== undefined && !sameSiteInstances(currentSites, importedSites)) { setObj[SITE_INSTANCES_KEY] = importedSites; siteInstancesOverridden = true; }
      if (payload.customEngines !== undefined && !sameCustomEngines(currentCustoms, importedCustoms)) { setObj[CUSTOM_ENGINES_KEY] = importedCustoms; customEnginesOverridden = true; }
      // 整数组覆盖（pref 语义，同 siteInstances）：导入文件显式包含 providerInstances 时整体替换。
      if (payload.providerInstances !== undefined && !sameProviderInstances(currentInstances, payload.providerInstances)) { setObj[PROVIDER_INSTANCES_KEY] = payload.providerInstances; providerInstancesOverridden = true; }
      // 聚合实例整数组替换（KTD13，同 providerInstances 先例）。⚠️ 缓存缝隙修复（Oracle #1）：
      // 导出文件逐字携带实例 id——导入一份 `agg:xxx` 成员已改的备份后 id 不变，「旧条目按 id
      // 天然失配」不成立，`agg:xxx:query` 会带着旧成员组合存活（同一变更经 options 编辑路径
      // 会精确失效，导入路径此前绕过了它）。实例 id 即缓存键 ⇒ 集合实际替换 = 内容可能已变
      // ⇒ 全部聚合缓存条目失效（缓存可重生，无需 per-id diff）。
      // Accepted deviation #4（Oracle 裁决可接受，显式记录）：provider key 配置/清除**不**失效
      // 内嵌成员状态的聚合条目——KTD9 未列此触发；有缓存命中提示 + 强制全新搜索兜底。
      if (payload.aggregateInstances !== undefined && !sameAggregateInstances(normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]), payload.aggregateInstances)) {
        setObj[AGGREGATE_INSTANCES_KEY] = payload.aggregateInstances;
        aggregateInstancesOverridden = true;
        aggregateCacheInvalidated = true;
      }
      if (curActive !== payload.activeProvider) {
        setObj[ACTIVE_KEY] = payload.activeProvider;
        activeOverridden = true;
      }
      if (curActiveSource !== newActiveSource) {
        setObj[ACTIVE_SOURCE_KEY] = newActiveSource;
        activeSourceOverridden = true;
      }
      const curTheme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
      if (curTheme !== payload.themePref) {
        setObj[THEME_KEY] = payload.themePref;
        themeOverridden = true;
      }
      const curLocale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
      if (curLocale !== payload.localePref) {
        setObj[LOCALE_KEY] = payload.localePref;
        localeOverridden = true;
      }
      const curBarPosition = BAR_POSITION_VALUES.has(got[BAR_POSITION_KEY] as BarPositionPref) ? (got[BAR_POSITION_KEY] as BarPositionPref) : 'auto';
      const newBarPosition = payload.serpBarPosition ?? 'auto';
      if (curBarPosition !== newBarPosition) {
        setObj[BAR_POSITION_KEY] = newBarPosition;
        barPositionOverridden = true;
      }
      const curAiAutoEnter = got[AI_AUTO_ENTER_KEY] !== false;
      const newAiAutoEnter = payload.aiAutoEnter ?? true;
      if (curAiAutoEnter !== newAiAutoEnter) {
        setObj[AI_AUTO_ENTER_KEY] = newAiAutoEnter;
        aiAutoEnterOverridden = true;
      }
      const curFlatLayoutFewSources = got[FLAT_LAYOUT_FEW_SOURCES_KEY] !== false;
      const newFlatLayoutFewSources = payload.flatLayoutFewSources ?? true;
      if (curFlatLayoutFewSources !== newFlatLayoutFewSources) {
        setObj[FLAT_LAYOUT_FEW_SOURCES_KEY] = newFlatLayoutFewSources;
        flatLayoutFewSourcesOverridden = true;
      }
      if (!sameSourceOrder(curSourceOrder, newSourceOrder)) {
        setObj[SOURCE_ORDER_KEY] = newSourceOrder;
        sourceOrderOverridden = true;
      }
      if (!sameSourceOrder(curSourceHidden, newSourceHidden)) {
        setObj[SOURCE_HIDDEN_KEY] = newSourceHidden;
        sourceHiddenOverridden = true;
      }
      if (payload.providerMaxResults !== undefined) {
        const curMax = normalizeMaxResultsMap(got[MAX_RESULTS_KEY]);
        if (!sameMaxResultsMap(curMax, payload.providerMaxResults)) {
          setObj[MAX_RESULTS_KEY] = payload.providerMaxResults;
          providerMaxResultsOverridden = true;
        }
      }
      if (payload.groupConfig !== undefined) {
        const curGroupRaw = got[GROUP_CONFIG_KEY];
        const currentAggregatesForGroups = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
        const curGroup = curGroupRaw && typeof curGroupRaw === 'object'
          ? normalizeGroupConfig(curGroupRaw, allKnownSourceIds(currentSites, currentCustoms, currentInstances, currentAggregatesForGroups))
          : undefined;
        // 用导入的 site/custom engines 视角重新规范化导入的 groupConfig，确保赋值合法。
        // 已知集并入导入聚合定义集（缺失 = 本地保留集，F3②）——agg 赋值不因导入剥落。
        const importedAggregatesForGroups = payload.aggregateInstances ?? currentAggregatesForGroups;
        const newGroup = normalizeGroupConfig(payload.groupConfig, allKnownSourceIds(importedSites, importedCustoms, importedInstances, importedAggregatesForGroups));
        if (!sameGroupConfig(curGroup, newGroup)) {
          setObj[GROUP_CONFIG_KEY] = newGroup;
          groupConfigOverridden = true;
        }
      }
    }
    await browser.storage.local.set(setObj);

    // KTD9 导入失效行（F5 + Oracle #1）：rerank endpoint/model 实际变更，或聚合实例集合被导入
    // 替换（同 id 换成员缝隙）→ 全部聚合缓存条目失效。缓存队列与 source/providerKeys 队列无交集，无锁序问题。
    if (aggregateCacheInvalidated) {
      await deleteAggregateCacheEntries('all');
    }

    return {
      written,
      skipped,
      activeProviderOverridden: activeOverridden,
      activeSourceOverridden,
      themePrefOverridden: themeOverridden,
      localePrefOverridden: localeOverridden,
      serpBarPositionOverridden: barPositionOverridden,
      aiAutoEnterOverridden,
      flatLayoutFewSourcesOverridden,
      sourceOrderOverridden,
      sourceHiddenOverridden,
      siteInstancesOverridden,
      customEnginesOverridden,
      providerInstancesOverridden,
      aggregateInstancesOverridden,
      rerankConfigOverridden,
      providerMaxResultsOverridden,
      groupConfigOverridden,
    };
  });
}

function normalizeProviderKeys(keys: Record<string, unknown>): Record<string, string> {
  const providerKeys: Record<string, string> = {};
  for (const [id, k] of Object.entries(keys)) {
    if (KNOWN_PROVIDER_IDS.has(id as ProviderId) && typeof k === 'string') {
      providerKeys[id] = k;
    }
  }
  return providerKeys;
}

/** 把 storage 原始值规范化为 maxResults 映射：仅保留已知 provider、clamp 到 1–20。 */
function normalizeMaxResultsMap(raw: unknown): Partial<Record<ProviderId, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map = raw as Record<string, unknown>;
  const out: Partial<Record<ProviderId, number>> = {};
  for (const [id, n] of Object.entries(map)) {
    if (KNOWN_PROVIDER_IDS.has(id as ProviderId)) {
      const clamped = clampMaxResults(n);
      if (clamped !== null) out[id as ProviderId] = clamped;
    }
  }
  return out;
}

function mergeProviderKeys(current: Record<string, string>, imported: Record<string, string>): Record<string, string> {
  const merged = { ...current };
  for (const [id, key] of Object.entries(imported)) if (!merged[id]) merged[id] = key;
  return merged;
}

/** Calculates the source graph exactly as an apply-preferences import will. */
function resolveImportedSourcePreferences(
  payload: ConfigExport,
  got: Record<string, unknown>,
  currentSites: SiteInstanceDefinition[],
  currentCustoms: CustomEngineDefinition[],
  currentKeys: Record<string, string>,
  mergedKeys: Record<string, string>,
  currentActive: ProviderId | null,
  importedRerank: RerankConfig,
) {
  // A missing collection is the v3 sentinel; unlike v4's explicit [], it
  // preserves local Site Engines and all dependent preferences.
  const importedSites = payload.siteInstances ?? currentSites;
  const importedCustoms = payload.customEngines ?? currentCustoms;
  const currentInstances = normalizeProviderInstances(got[PROVIDER_INSTANCES_KEY]);
  const importedInstances = payload.providerInstances ?? currentInstances;
  // F3 聚合语义（KTD13/Oracle F3）：payload.aggregateInstances 缺失 = 本地聚合实例整体保留
  // （legacy 语义），定义集并入本地集合；带集合 = 整数组替换，定义集 = 导入集合。
  // Lane C 折叠：normalize 直调 + 定义集参数（withAggregateIdsPreserved/scopeAggIds 已删除）。
  const currentAggregates = normalizeAggregateInstances(got[AGGREGATE_INSTANCES_KEY]);
  const importedAggregates = payload.aggregateInstances ?? currentAggregates;
  const rawActiveSource = typeof got[ACTIVE_SOURCE_KEY] === 'string' ? got[ACTIVE_SOURCE_KEY] as SourceId : null;
  const { sources: currentAggregateSources } = buildAggregateProjection(currentAggregates, got[RERANK_CONFIG_KEY], currentKeys, currentInstances);
  const curActiveSource = resolveEffectiveActiveSource(
    rawActiveSource ?? currentActive,
    currentKeys,
    currentSites,
    currentCustoms,
    currentInstances,
    currentAggregateSources,
  ) ?? DEFAULT_ENGINE_ID;
  // Preserve the current active source when it is a dynamic id whose collection
  // is absent from the import (i.e. preserved from current storage). Each dynamic
  // type is checked independently so an older backup with a site collection
  // (siteInstances, or siteEngines in pre-v10 exports) but no customEngines
  // still preserves a custom-engine active source.
  const preserveSite = payload.siteInstances === undefined && isKnownSiteInstanceId(curActiveSource, currentSites);
  const preserveCustom = payload.customEngines === undefined && isKnownCustomEngineId(curActiveSource, currentCustoms);
  // F3 ①（KTD13/Oracle F3）：本地 activeSource 是 agg id 且导入未带聚合实例集 → 原样保留
  // 本地 agg id（eligibility 抖动不影响保留判定——可用性是派生视图，导入合并以保留本地状态优先）。
  const preserveAggregate = payload.aggregateInstances === undefined && !!rawActiveSource && currentAggregates.some((instance) => instance.id === rawActiveSource);
  const preferredActiveSource = (preserveSite || preserveCustom || preserveAggregate) ? curActiveSource : payload.activeSource;
  // KTD13：eligibility 输入用合并后的 rerank 配置（mergeImport 传 effectiveRerank：applyPrefs
  // 改 endpoint/model 时导入后的可用性须按新端点解析；preview 传存储值保持 dry-run 纯读；
  // apiKey 仅填空不影响 endpoint 判定，与 KTD13/F5 语义一致）。
  const { sources: importedAggregateSources } = buildAggregateProjection(importedAggregates, importedRerank, mergedKeys, importedInstances);
  const newActiveSource = preserveAggregate && rawActiveSource
    ? rawActiveSource
    : resolveEffectiveActiveSource(
        preferredActiveSource ?? payload.activeProvider,
        mergedKeys,
        importedSites,
        importedCustoms,
        importedInstances,
        importedAggregateSources,
      ) ?? DEFAULT_ENGINE_ID;
  const orderInput = payload.sourceOrder === undefined ? got[SOURCE_ORDER_KEY] : payload.sourceOrder;
  const curSourceOrder = normalizeSourceOrder(got[SOURCE_ORDER_KEY], currentSites, currentCustoms, currentInstances, currentAggregates);
  const newSourceOrder = normalizeSourceOrder(orderInput, importedSites, importedCustoms, importedInstances, importedAggregates);
  const curSourceHidden = normalizeSourceHidden(got[SOURCE_HIDDEN_KEY], currentSites, currentCustoms, currentInstances, currentAggregates);
  const importedHidden = payload.sourceHidden === undefined ? got[SOURCE_HIDDEN_KEY] : payload.sourceHidden;
  // 部分导出合并分支（per-type 对称，对照上方 preserveSite/preserveCustom/preserveAggregate）：
  // payload 缺某动态定义集 = 本地集合保留，其隐藏状态也必须并入输入——否则导入文件未列出的
  // 本地隐藏动态源会因 normalize 剥落而重新出现在快切栏（inst: 同理：旧备份无实例集，
  // 不并入会整体取消隐藏本地实例）。normalize 去重保首现，重复并入无副作用。
  const hiddenBase = [
    ...(Array.isArray(importedHidden) ? importedHidden : []),
    ...(payload.siteInstances === undefined ? curSourceHidden.filter((id) => isSiteInstanceId(id)) : []),
    ...(payload.customEngines === undefined ? curSourceHidden.filter((id) => isCustomEngineId(id)) : []),
    ...(payload.providerInstances === undefined ? curSourceHidden.filter((id) => isProviderInstanceId(id)) : []),
  ];
  // F3 ②（payload 缺聚合实例集）：本地 hidden 中的 agg id 一并并入输入——否则导入文件未列出的
  // 本地隐藏聚合实例会因 normalize 而剥落（原 withAggregateIdsPreserved 额外保留源语义，
  // 对全部导入形态生效，不限于 legacy 合并分支）。normalize 去重保首现，重复并入无副作用。
  const hiddenInput = payload.aggregateInstances === undefined
    ? [...hiddenBase, ...curSourceHidden.filter((id) => isAggregateInstanceId(id))]
    : hiddenBase;
  const newSourceHidden = ensureVisibleUsable(
    normalizeSourceHidden(hiddenInput, importedSites, importedCustoms, importedInstances, importedAggregates),
    newSourceOrder,
    mergedKeys,
    importedSites,
    importedCustoms,
    importedInstances,
    importedAggregateSources,
  );
  return { importedSites, importedCustoms, curActiveSource, newActiveSource, curSourceOrder, newSourceOrder, curSourceHidden, newSourceHidden };
}

function isKnownSource(value: unknown, siteInstances: readonly SiteInstanceDefinition[] = [], customEngines: readonly CustomEngineDefinition[] = [], providerInstances: readonly ProviderInstance[] = [], allowUnresolvedSite = false, aggregateInstances: readonly AggregateInstance[] = []): value is SourceId {
  return typeof value === 'string'
    && (isProviderId(value) || isEngineId(value) || isRegisteredAiEngineId(value) || isKnownSiteInstanceId(value, siteInstances) || isKnownCustomEngineId(value, customEngines) || (isProviderInstanceId(value) && providerInstances.some((instance) => instance.id === value)) || (allowUnresolvedSite && (isSiteInstanceId(value) || isCustomEngineId(value))) || (isAggregateInstanceId(value) && aggregateInstances.some((instance) => instance.id === value)));
}

function sameSiteInstances(left: readonly SiteInstanceDefinition[], right: readonly SiteInstanceDefinition[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameCustomEngines(left: readonly CustomEngineDefinition[], right: readonly CustomEngineDefinition[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameProviderInstances(left: readonly ProviderInstance[], right: readonly ProviderInstance[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameAggregateInstances(left: readonly AggregateInstance[], right: readonly AggregateInstance[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameSourceOrder(left: SourceId[], right: SourceId[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

/** 两份 maxResults 映射是否等价（键集与值都相同）。 */
function sameMaxResultsMap(left: Partial<Record<ProviderId, number>>, right: Partial<Record<ProviderId, number>>): boolean {
  const lk = Object.keys(left);
  const rk = Object.keys(right);
  if (lk.length !== rk.length) return false;
  return lk.every((k) => left[k as ProviderId] === right[k as ProviderId]);
}

/** maxResults 映射的紧凑摘要，供 diff 展示。 */
function maxResultsSummary(map: Partial<Record<ProviderId, number>>): string {
  return Object.entries(map).map(([id, n]) => `${id}=${n}`).join(' | ') || '—';
}

/** Deterministic compact diff value; preserves enough detail to distinguish same-sized lists
 *  （含构造模式与 zhannei 筛选指纹——仅 mode/筛选不同的导入也能显示为 diff）。 */
function siteInstancesSummary(definitions: readonly SiteInstanceDefinition[]): string {
  return definitions.map((definition) => `${definition.id}:${definition.engineId}:${constructionFor(definition)}:${zhanneiFingerprintFor(definition)}:${definition.target}:${definition.name}`).join(' | ');
}

/** Deterministic compact diff value for custom engines. */
function customEnginesSummary(definitions: readonly CustomEngineDefinition[]): string {
  return definitions.map((definition) => `${definition.id}:${definition.urlTemplate}:${definition.name}`).join(' | ');
}

/** Deterministic compact diff value for provider instances (options included to distinguish same-sized lists). */
function providerInstancesSummary(instances: readonly ProviderInstance[]): string {
  return instances.map((instance) => `${instance.id}:${instance.baseProviderId}:${instance.name}:${JSON.stringify(instance.options)}`).join(' | ');
}

/** 聚合实例 summary 行（KTD13）：`id:name:成员数:topN`。 */
function aggregateInstancesSummary(instances: readonly AggregateInstance[]): string {
  return instances.map((instance) => `${instance.id}:${instance.name}:${instance.members.length}:${instance.topN}`).join(' | ');
}

/** rerankConfig 摘要（KTD13/AE6）：只含 endpoint/model——**apiKey 绝不进 preview/diff**。 */
function rerankConfigSummary(config: RerankConfig): string {
  return `${config.endpoint || '—'}:${config.model ?? '—'}${config.protocol === 'jev' ? ':jev' : ''}`;
}

// LANE-C-FOLD（KTD13/Oracle F3 interim）已折叠：normalizeSourceOrder/normalizeSourceHidden 直接受
// 聚合定义集参数（lib/sources.ts），withAggregateIdsPreserved / aggregateIdsOf / scopeAggIds 已删除；
// eligibility 经 buildAggregateProjection（lib/storage/shared.ts）单点计算后传入
// resolveEffectiveActiveSource / ensureVisibleUsable（KTD5）。

function ensureVisibleUsable(hidden: SourceId[], order: SourceId[], providerKeys: Record<string, string>, sites: readonly SiteInstanceDefinition[], customs: readonly CustomEngineDefinition[] = [], instances: readonly ProviderInstance[] = [], aggregateSources: readonly AggregateSourceDefinition[] = []): SourceId[] {
  if (visibleUsableSource(order, hidden, providerKeys, sites, customs, instances, aggregateSources)) return hidden;
  const fallback = visibleUsableSource(order, [], providerKeys, sites, customs, instances, aggregateSources);
  return fallback ? hidden.filter((id) => id !== fallback) : hidden;
}

