// Schema 版本与迁移：config 域（providerKeys / activeProvider / activeSource / themePref / localePref / sourceOrder / sourceHidden / siteEngines / agentBridgeEnabled / engineSearchEnabled / providerMaxResults / groupConfig）。
//
// 双版本体系：config 域用 `schemaVersion`（本文件），缓存池用 `cacheSchemaVersion`
// （见 search-cache.ts 的 ensureCacheSchema + cacheMigrations）。两域独立演进——
// 纯 config 改动不触发缓存全量 IO，反之亦然。
// ⚠️ 修改本文件的迁移链 version 比较逻辑时，同步检查 search-cache.ts 的 migrateCachePool，
//    两处共享同构的 version-skip 语义。
//
// `ensureSchema()` 可重复调用且幂等：
//   - 稳态（已当前版本）：读 `schemaVersion` 单键 → 立即 return，~0.1ms，不读 config、不写。
//   - 首装（缺戳）：读 config 域 → 盖章当前版本，一次性。
//   - 升级（落后）：读 config 域 → 跑迁移链 → 只写 diff 键，一次性。
// handler 顶部 `await ensureSchema()` 实现迁移窗口阻塞；worker 启动 `void ensureSchema()` 预热。

import { DEFAULT_HIDDEN_AI_ENGINE_IDS } from './ai-engines/registry';

export const SCHEMA_VERSION_KEY = 'schemaVersion';
export const CURRENT_SCHEMA_VERSION = 8;

// config 域白名单：迁移只读写这些键（外加 schemaVersion 本身）。
// ⚠️ 新增 config 键时，必须同步加进此数组，否则 ensureSchema 不会读/写它。
// agentBridgeEnabled / engineSearchEnabled / providerMaxResults / groupConfig / customEngines 默认值由 getter 兜底，不 bump 版本（无需迁移）。
// serpBarPosition 例外：v7→v8 因 'top' 语义重定义（固定覆盖顶栏，原内联行为改名 'inline'）需值重写迁移，故 bump 版本。此前的版本无需迁移。
export const CONFIG_KEYS = ['providerKeys', 'activeProvider', 'activeSource', 'themePref', 'localePref', 'sourceOrder', 'sourceHidden', 'siteEngines', 'customEngines', 'providerInstances', 'agentBridgeEnabled', 'engineSearchEnabled', 'providerMaxResults', 'groupConfig', 'serpBarPosition'] as const;

// 迁移函数签名：从 `version` 迁移到 `version + 1`。必须是纯函数 + 幂等。
export type Migration = {
  version: number;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
};

// 把给定默认隐藏 engine id 并入既有 sourceHidden（去重、保留首现顺序）。
// 幂等：已含其中任一 id 时不重复追加；用户在设置页点「显示」即从 sourceHidden 移除该 id，
// 此后迁移不再回填（因版本已戳，迁移链不会重跑）。
function mergeHiddenFactory(ids: readonly string[]) {
  return function mergeDefaultHidden(config: Record<string, unknown>): Record<string, unknown> {
    const current = Array.isArray(config.sourceHidden) ? config.sourceHidden as unknown[] : [];
    const seen = new Set(current.filter((id): id is string => typeof id === 'string'));
    const merged = [...current.filter((id): id is string => typeof id === 'string')];
    for (const id of ids) {
      if (!seen.has(id)) merged.push(id);
    }
    return { ...config, sourceHidden: merged };
  };
}

// v1→v2：抖音 / 小红书引擎加入快切栏——两者默认隐藏。
const DEFAULT_HIDDEN_ENGINE_IDS_V2: readonly string[] = ['douyin', 'xiaohongshu'];
// v2→v3：哔哩哔哩引擎加入快切栏——默认隐藏（同抖音 / 小红书，登录态 SPA、二线定位）。
const DEFAULT_HIDDEN_ENGINE_IDS_V3: readonly string[] = ['bilibili'];
// v5→v6：Yandex / DuckDuckGo 引擎加入快切栏——默认隐藏（国际二线引擎，开箱不膨胀快切栏）。
const DEFAULT_HIDDEN_ENGINE_IDS_V4: readonly string[] = ['yandex', 'duckduckgo'];

// 迁移注册表：按 version 升序。未来加版本两步：(1) 向此数组 append 一条 Migration；(2) bump CURRENT_SCHEMA_VERSION。
export const migrations: Migration[] = [
  { version: 1, migrate: mergeHiddenFactory(DEFAULT_HIDDEN_ENGINE_IDS_V2) },
  { version: 2, migrate: mergeHiddenFactory(DEFAULT_HIDDEN_ENGINE_IDS_V3) },
  // v3→v4: persisted Site Engines are opt-in; old installs get an explicit empty collection.
  { version: 3, migrate: (config) => ({ ...config, siteEngines: Array.isArray(config.siteEngines) ? config.siteEngines : [] }) },
  // v4→v5: 引入来源分组布局（groupConfig）。开箱即分组：缺失键由 getter 回退默认配置，
  // 故迁移无需填充数据——仅 bump 版本戳以纳入 CONFIG_KEYS 白名单（ensureSchema 会读它）。
  { version: 4, migrate: (config) => config },
  // v5→v6: Yandex / DuckDuckGo 引擎加入——两者默认隐藏（出现在管理 UI 但不进快切栏，用户手动显示）。
  { version: 5, migrate: mergeHiddenFactory(DEFAULT_HIDDEN_ENGINE_IDS_V4) },
  // v6→v7: AI 对话引擎加入（DeepSeek / ChatGPT / Gemini / 豆包 / Grok）——全部默认隐藏（需登录）。
  { version: 6, migrate: mergeHiddenFactory(DEFAULT_HIDDEN_AI_ENGINE_IDS) },
  // v7→v8: serpBarPosition 'top' 重定义为固定覆盖顶栏；原内联引擎锚点插入重命名为 'inline'。
  // 旧 'top' 用户迁移到 'inline'，保持内联体验不变（无感）。'top' 现为固定覆盖顶栏。
  { version: 7, migrate: (config) => config.serpBarPosition === 'top' ? { ...config, serpBarPosition: 'inline' } : config },
];

/**
 * 纯函数：对 config 应用从 fromVersion 到 toVersion 的迁移链。
 * 迁移按 version 升序执行；fromVersion 之前的迁移跳过，toVersion 及之后的迁移跳过。
 * 幂等：对已是 toVersion 的 config 再跑一次结果一致（迁移本身须幂等）。
 */
export function migrateConfig(
  config: Record<string, unknown>,
  fromVersion: number,
  toVersion: number,
  chain: Migration[] = migrations,
): Record<string, unknown> {
  let acc = { ...config };
  for (const m of chain) {
    if (m.version < fromVersion || m.version >= toVersion) continue;
    acc = m.migrate(acc);
  }
  return acc;
}

/**
 * 读 schemaVersion 单键；缺则 0（首装）。供测试与诊断用。
 */
export async function readSchemaVersion(): Promise<number> {
  const got = await browser.storage.local.get(SCHEMA_VERSION_KEY);
  const v = got[SCHEMA_VERSION_KEY];
  return typeof v === 'number' ? v : 0;
}

/**
 * 确保 storage 处于 CURRENT_SCHEMA_VERSION。幂等，可重复调用。
 *
 * - 已当前 → return（不写）。
 * - 缺戳或落后 → 读 config 域 → 跑迁移链 → 写 diff（仅变更键 + schemaVersion）。
 * - 超前（stored > CURRENT，降级场景）→ 无视，return（向前兼容）。
 *
 * 抛异常时，已读的数据不写回；下次调用重跑（版本戳未更新）。迁移须幂等以保安全。
 */
export async function ensureSchema(): Promise<void> {
  const stored = await readSchemaVersion();
  if (stored === CURRENT_SCHEMA_VERSION) return;
  if (stored > CURRENT_SCHEMA_VERSION) return; // 降级：向前兼容，不破坏
  const configGot = await browser.storage.local.get([...CONFIG_KEYS]);
  const migrated = migrateConfig(configGot, stored, CURRENT_SCHEMA_VERSION);
  const { set: setDiff, remove: removeKeys } = diffKeys(configGot, migrated);
  // Schema version is the commit point: all migrated values and removals must
  // succeed before stamping. A failure leaves an older version so retrying is safe.
  if (Object.keys(setDiff).length > 0) {
    await browser.storage.local.set(setDiff);
  }
  if (removeKeys.length > 0) {
    await browser.storage.local.remove(removeKeys);
  }
  await browser.storage.local.set({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION });
}

/**
 * 计算两份 snapshot 的 diff：值变化的键进 `set`，迁移删除的键进 `remove`。
 * 对称：支持重命名/删除迁移（before 里有、after 里没有的键会被移除）。
 * 仅限 config 域白名单 + 版本键——调用方构造 snapshot 时已限定范围。
 */
function diffKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { set: Record<string, unknown>; remove: string[] } {
  const set: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (!Object.is(before[key], after[key])) {
      set[key] = after[key];
    }
  }
  const remove: string[] = [];
  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      remove.push(key);
    }
  }
  return { set, remove };
}
