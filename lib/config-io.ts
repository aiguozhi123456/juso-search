// 配置导入/导出（仅 config 域，不含缓存池）。
//
// 设计：
// - 导出由 worker 组装 payload（worker 本就是 key 的唯一读者），精确读 4 个 config 键，
//   不读 searchCacheEntry 池；payload 含明文 key（BYOK 数据归用户，文件归用户所有）。
// - 导入走校验 + 合并语义：providerKeys 仅填空（不覆盖已有 key），prefs 显式包含才覆盖。
// - 所有 storage IO 走精确键，绝不 get(null)。
//
// 安全（R7）：本模块只在 worker 上下文调用（由 gateway handler 触发），不进入页面代码。

import type { LocalePref, ThemePref } from './storage';
import { ACTIVE_KEY, KEYS_KEY, LOCALE_KEY, THEME_KEY, withProviderKeysMutation } from './storage';
import { allProviders } from './providers/registry';
import type { ProviderId } from './providers/types';
import { CURRENT_SCHEMA_VERSION } from './schema';

const KNOWN_PROVIDER_IDS = new Set<ProviderId>(allProviders().map((p) => p.id));
const THEME_VALUES = new Set<ThemePref>(['auto', 'light', 'dark']);
const LOCALE_VALUES = new Set<LocalePref>(['auto', 'zh_CN', 'en']);

/** 导出文件结构。schemaVersion 用 number（非字面量），避免版本升级后类型过度约束。 */
export interface ConfigExport {
  schemaVersion: number;
  exportedAt: number;
  appVersion: string;
  providerKeys: Record<string, string>;
  activeProvider: ProviderId | null;
  themePref: ThemePref;
  localePref: LocalePref;
}

/** worker 端组装导出 payload。精确读 4 个 config 键，不读缓存池。 */
export async function buildExportPayload(): Promise<ConfigExport> {
  const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, THEME_KEY, LOCALE_KEY]);
  const keys = (got[KEYS_KEY] ?? {}) as Record<string, unknown>;
  const providerKeys: Record<string, string> = {};
  for (const [id, k] of Object.entries(keys)) {
    if (KNOWN_PROVIDER_IDS.has(id as ProviderId) && typeof k === 'string') {
      providerKeys[id] = k;
    }
  }
  const activeRaw = got[ACTIVE_KEY];
  const active = KNOWN_PROVIDER_IDS.has(activeRaw as ProviderId) ? (activeRaw as ProviderId) : null;
  const theme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
  const locale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    exportedAt: Date.now(),
    appVersion: getAppVersion(),
    providerKeys,
    activeProvider: active,
    themePref: theme,
    localePref: locale,
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
 * 校验导入文件原始内容。严格：schemaVersion 必须 === CURRENT，providerKeys 的 id 必须全已知、
 * 值必须是 string，activeProvider 必须是已知 id 或 null，prefs 必须是合法枚举值。
 * 任何不合规都返回 ok:false（不抛异常），调用方负责把 error 转为面向用户的消息。
 */
export function parseImportPayload(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'invalid_format' };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    return { ok: false, error: 'schema_version_mismatch' };
  }
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
  const theme = obj.themePref;
  if (!THEME_VALUES.has(theme as ThemePref)) return { ok: false, error: 'invalid_theme' };
  const locale = obj.localePref;
  if (!LOCALE_VALUES.has(locale as LocalePref)) return { ok: false, error: 'invalid_locale' };
  return {
    ok: true,
    value: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
      appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
      providerKeys,
      activeProvider: active as ProviderId | null,
      themePref: theme as ThemePref,
      localePref: locale as LocalePref,
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
  /** 是否覆盖了 themePref。 */
  themePrefOverridden: boolean;
  /** 是否覆盖了 localePref。 */
  localePrefOverridden: boolean;
}

/** 单个 pref 的预览 diff：from 当前值 -> to 导入值（仅当两者不同时为 diff）。 */
export interface PrefDiff {
  key: 'activeProvider' | 'themePref' | 'localePref';
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
  const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, THEME_KEY, LOCALE_KEY]);
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
  const curTheme = THEME_VALUES.has(got[THEME_KEY] as ThemePref) ? (got[THEME_KEY] as ThemePref) : 'auto';
  if (curTheme !== payload.themePref) {
    prefDiffs.push({ key: 'themePref', from: curTheme, to: payload.themePref });
  }
  const curLocale = LOCALE_VALUES.has(got[LOCALE_KEY] as LocalePref) ? (got[LOCALE_KEY] as LocalePref) : 'auto';
  if (curLocale !== payload.localePref) {
    prefDiffs.push({ key: 'localePref', from: curLocale, to: payload.localePref });
  }

  return { written, skipped, prefDiffs };
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
  // 串行化 providerKeys 的读改写，防止与 setKey/clearKey 并发写丢失。
  return withProviderKeysMutation(async () => {
    const got = await browser.storage.local.get([KEYS_KEY, ACTIVE_KEY, THEME_KEY, LOCALE_KEY]);
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
    let themeOverridden = false;
    let localeOverridden = false;
    if (applyPrefs) {
      const curActive = KNOWN_PROVIDER_IDS.has(got[ACTIVE_KEY] as ProviderId) ? (got[ACTIVE_KEY] as ProviderId) : null;
      if (curActive !== payload.activeProvider) {
        setObj[ACTIVE_KEY] = payload.activeProvider;
        activeOverridden = true;
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
    }
    await browser.storage.local.set(setObj);

    return {
      written,
      skipped,
      activeProviderOverridden: activeOverridden,
      themePrefOverridden: themeOverridden,
      localePrefOverridden: localeOverridden,
    };
  });
}
