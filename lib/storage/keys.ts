// BYOK key 仅存 chrome.storage.local（R7 信任底线）。
// ⚠️ getKey 只应由 background service worker 调用；
//   搜索页/设置页不应直接读 key，仅由 worker 代理调 provider API。
// ⚠️ 优先用精确键（string | string[]）调用 browser.storage.local.get，
//   不要 get(null)——后者每次读全库（含 50 个 searchCacheEntry，~1MB），
//   在 MV3 worker 频繁唤醒下是显著开销，也违背 key 卫生（把敏感键读入单一 record）。

export const KEYS_KEY = 'providerKeys'; // Record<ProviderId, string>
export const ACTIVE_KEY = 'activeProvider'; // ProviderId | null
export const ACTIVE_SOURCE_KEY = 'activeSource'; // SourceId | null
export const THEME_KEY = 'themePref'; // ThemePref
export const LOCALE_KEY = 'localePref'; // LocalePref
export const STYLE_KEY = 'stylePref'; // StylePref (UI 风格维度：经典 / 彩色)
export const SOURCE_ORDER_KEY = 'sourceOrder'; // SourceId[]
export const SOURCE_HIDDEN_KEY = 'sourceHidden'; // SourceId[]
export const SITE_ENGINES_KEY = 'siteEngines'; // SiteEngineDefinition[]
export const CUSTOM_ENGINES_KEY = 'customEngines'; // CustomEngineDefinition[]
export const PROVIDER_INSTANCES_KEY = 'providerInstances'; // ProviderInstance[]
export const GROUP_CONFIG_KEY = 'groupConfig'; // GroupConfig（分组定义 + 顶层混合 layout + 赋值）
export const MAX_RESULTS_KEY = 'providerMaxResults'; // Record<ProviderId, number>
// Agent Bridge 门控（默认 false）：上架合规——engine-search 抓 Google/Bing/Baidu 属 scraping 风险，
// 必须用户显式开启。仅读各自键，不 get(null)（与 theme/locale 同样的 key 卫生）。
export const AGENT_BRIDGE_ENABLED_KEY = 'agentBridgeEnabled'; // boolean（stored === true 才 true）
export const ENGINE_SEARCH_ENABLED_KEY = 'engineSearchEnabled'; // boolean
export const BAR_POSITION_KEY = 'serpBarPosition'; // BarPositionPref (快切栏栏位：auto / top / inline / bottom)
export const AI_AUTO_ENTER_KEY = 'aiAutoEnter'; // AI engine 自动回车开关（默认 true，stored !== false 才 true）
export const FLAT_LAYOUT_FEW_SOURCES_KEY = 'flatLayoutFewSources'; // 少量来源自动平铺开关（默认 true，stored !== false 才 true）
export const SELECTION_SEARCH_ENABLED_KEY = 'selectionSearchEnabled'; // 划词搜索开关（默认 true，stored !== false 才 true）
export const SELECTION_SEARCH_SOURCE_KEY = 'selectionSearchSource'; // 划词搜索固定源（SourceId | null，null = 跟随激活源）

export type ThemePref = 'auto' | 'light' | 'dark';
export type LocalePref = 'auto' | 'zh_CN' | 'en';
export type StylePref = 'classic' | 'colorful';
export type BarPositionPref = 'auto' | 'top' | 'inline' | 'bottom';
