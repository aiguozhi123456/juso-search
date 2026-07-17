// Schema 版本与迁移：config 域（providerKeys / activeProvider / activeSource / themePref / localePref / sourceOrder / sourceHidden）。
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

export const SCHEMA_VERSION_KEY = 'schemaVersion';
export const CURRENT_SCHEMA_VERSION = 1;

// config 域白名单：迁移只读写这些键（外加 schemaVersion 本身）。
// ⚠️ 新增 config 键时，必须同步加进此数组，否则 ensureSchema 不会读/写它。
export const CONFIG_KEYS = ['providerKeys', 'activeProvider', 'activeSource', 'themePref', 'localePref', 'sourceOrder', 'sourceHidden'] as const;

// 迁移函数签名：从 `version` 迁移到 `version + 1`。必须是纯函数 + 幂等。
export type Migration = {
  version: number;
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
};

// 迁移注册表：按 version 升序。首版为空（CURRENT_SCHEMA_VERSION === 1，无历史版本）。
// 未来加版本两步：(1) 向此数组 append 一条 Migration；(2) bump CURRENT_SCHEMA_VERSION。
export const migrations: Migration[] = [];

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
  const { set: setDiff, remove: removeKeys } = diffKeys(
    { ...configGot, [SCHEMA_VERSION_KEY]: stored || undefined },
    { ...migrated, [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION },
  );
  if (removeKeys.length > 0) {
    await browser.storage.local.remove(removeKeys);
  }
  if (Object.keys(setDiff).length > 0) {
    await browser.storage.local.set(setDiff);
  }
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
