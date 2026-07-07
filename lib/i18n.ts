// i18n 访问层（自建查表，支持运行时手动切换）。
//
// 为什么不直接用 browser.i18n.getMessage：
//   browser.i18n 返回哪种语言由 Chrome 按浏览器 UI 语言决定，JS 无法在运行时指定。
//   为了支持"手动切换 UI 语言"，本层用 import.meta.glob 在构建期把 _locales 下两份
//   messages.json 打进 bundle，运行时按用户选的 locale 查表。
//
// 限制：manifest 的 name/description/title 仍走 __MSG_*__，由 Chrome 按浏览器语言渲染，
//      这部分任何 JS 方案都无法在运行时覆盖（Chrome 限制）。
//
// 插值用 Chrome 风格占位符 $1/$2（与 messages.json 一致）。

// 构建期加载所有 locale 的 messages.json（同步可用）。
// eager: true 直接拿到模块；key 是相对路径如 '../../public/_locales/zh_CN/messages.json'
const localeModules = import.meta.glob<{ default: Record<string, { message: string }> }>(
  '../public/_locales/*/messages.json',
  { eager: true },
);

// locale → 消息表。从 glob 路径里提取 locale 名（zh_CN / en）。
const MESSAGES: Record<string, Record<string, { message: string }>> = {};
for (const [path, mod] of Object.entries(localeModules)) {
  const match = path.match(/_locales\/([^/]+)\/messages\.json$/);
  if (match) MESSAGES[match[1]] = mod.default;
}

export type Locale = 'zh_CN' | 'en';
export type LocalePref = 'auto' | Locale;

/** 模块级当前 locale（订阅者读取此值）。auto 在解析后落到具体 Locale。 */
let currentLocale: Locale = resolveAuto();
let currentPref: LocalePref = 'auto';
const listeners = new Set<() => void>();

/** 把浏览器 UI 语言映射到本项目支持的 locale；无匹配则 en。 */
function mapUiLanguage(ui: string): Locale {
  return ui.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
}

/** auto → 按 browser.i18n.getUILanguage() 解析；显式 pref 直接返回。 */
function resolveAuto(): Locale {
  if (typeof browser !== 'undefined' && browser?.i18n?.getUILanguage) {
    return mapUiLanguage(browser.i18n.getUILanguage());
  }
  return 'zh_CN';
}

function resolvePref(pref: LocalePref): Locale {
  return pref === 'auto' ? resolveAuto() : pref;
}

/** 切换 locale（由 storage 读取或用户操作触发）。通知所有订阅者重渲染。
 *  auto 模式总是重解析（依赖的 browser UI 语言可能在测试中变化；生产中无副作用）。 */
export function setLocale(pref: LocalePref): void {
  const next = resolvePref(pref);
  const prevPref = currentPref;
  currentPref = pref;
  if (next === currentLocale && pref === prevPref && pref !== 'auto') return; // 非.auto 且无变化才跳过
  currentLocale = next;
  for (const l of listeners) l();
}

/** 当前已解析 locale（zh_CN / en）。供 main.tsx 设置 <html lang> 用。 */
export function getCurrentLocale(): Locale {
  return currentLocale;
}

/** 当前偏好（含 auto）。供切换器 UI 高亮用。 */
export function getCurrentLocalePref(): LocalePref {
  return currentPref;
}

/** 订阅 locale 变化；返回取消订阅函数。供 React hook 用。 */
export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 模块加载后由 useLocale/storage 初始化时调用一次，把存储里的 pref 应用进来。 */
export function applyLocalePref(pref: LocalePref): void {
  setLocale(pref);
}

// browser.i18n.getMessage 的 webext 类型把 messageName 收窄成预定义字面量联合，
// 此处按 (string)=>string 放宽，使动态键可用。
type Lookup = (locale: Locale, name: string) => string;

/**
 * 取本地化消息。substitutions 为字符串或字符串数组，对应 messages.json 的 $1/$2。
 * 找不到时回退到 messageName 本身（便于发现漏配）。
 */
export function t(messageName: string, substitutions?: string | string[]): string {
  const subs = substitutions == null ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
  const lookup: Lookup = (locale, name) => {
    const entry = MESSAGES[locale]?.[name]?.message;
    if (!entry) return '';
    return entry.replace(/\$(\d+)/g, (_, i) => subs[Number(i) - 1] ?? '');
  };
  // 当前 locale 找不到 → 回退 en → 再回退 messageName
  return lookup(currentLocale, messageName) || lookup('en', messageName) || messageName;
}

/** 当前浏览器 UI 语言原始串（如 'zh_CN'/'en-US'），仅用于诊断。 */
export function getUILanguage(): string {
  if (typeof browser !== 'undefined' && browser?.i18n?.getUILanguage) {
    return browser.i18n.getUILanguage();
  }
  return 'zh_CN';
}

/** 消息名常量。与 _locales/{zh_CN,en}/messages.json 的键一一对应。 */
export const MSG = {
  // 扩展元信息（manifest __MSG_ 引用）
  ext_name: 'ext_name',
  ext_description: 'ext_description',
  // 搜索页
  search_page_title: 'search_page_title',
  search_placeholder: 'search_placeholder',
  search_aria: 'search_aria',
  btn_search: 'btn_search',
  btn_searching: 'btn_searching',
  btn_interrupt: 'btn_interrupt',
  history_button: 'history_button',
  history_title: 'history_title',
  history_empty: 'history_empty',
  history_clear_all: 'history_clear_all',
  history_delete: 'history_delete',
  history_delete_item: 'history_delete_item',
  history_close: 'history_close',
  cache_hit_notice: 'cache_hit_notice',
  cache_refresh: 'cache_refresh',
  answer_heading: 'answer_heading',
  no_results: 'no_results',
  state_loading: 'state_loading',
  state_empty: 'state_empty',
  open_settings_cta: 'open_settings_cta',
  search_failed_retry: 'search_failed_retry',
  // provider 切换器
  tooltip_supports_answer: 'tooltip_supports_answer',
  tooltip_no_answer: 'tooltip_no_answer',
  provider_no_answer_badge: 'provider_no_answer_badge',
  // 结果卡片
  collapse: 'collapse',
  expand: 'expand',
  // 设置页
  options_page_title: 'options_page_title',
  opts_title: 'opts_title',
  opts_active_engine: 'opts_active_engine',
  opts_choose_placeholder: 'opts_choose_placeholder',
  opts_no_ai_answer: 'opts_no_ai_answer',
  opts_apikey_heading: 'opts_apikey_heading',
  opts_apikey_hint: 'opts_apikey_hint',
  status_saved: 'status_saved',
  status_save_failed: 'status_save_failed',
  status_validated: 'status_validated',
  status_test_failed: 'status_test_failed',
  status_saving: 'status_saving',
  status_testing: 'status_testing',
  configured_badge: 'configured_badge',
  placeholder_new_key: 'placeholder_new_key',
  placeholder_paste_key: 'placeholder_paste_key',
  btn_save: 'btn_save',
  btn_test: 'btn_test',
  // 设置入口 / 主题 / 语言
  open_settings: 'open_settings',
  theme_group: 'theme_group',
  theme_auto: 'theme_auto',
  theme_light: 'theme_light',
  theme_dark: 'theme_dark',
  locale_group: 'locale_group',
  locale_auto: 'locale_auto',
  locale_zh: 'locale_zh',
  locale_en: 'locale_en',
  // provider 显示标签
  provider_tavily: 'provider_tavily',
  provider_exa: 'provider_exa',
  provider_stepfun: 'provider_stepfun',
  provider_stepfun_plan: 'provider_stepfun_plan',
  // 后台 / provider 错误（部分带插值 $1=provider/$2=status）
  error_no_provider_key: 'error_no_provider_key',
  error_key_missing_provider: 'error_key_missing_provider',
  error_service_unavailable: 'error_service_unavailable',
  error_http_network: 'error_http_network',
  error_http_parse: 'error_http_parse',
  error_http_unauthorized: 'error_http_unauthorized',
  error_http_rate_limit: 'error_http_rate_limit',
  error_http_server: 'error_http_server',
  error_http_generic: 'error_http_generic',
  error_mcp_network: 'error_mcp_network',
  error_mcp_unauthorized: 'error_mcp_unauthorized',
  error_mcp_rate_limit: 'error_mcp_rate_limit',
  error_mcp_http: 'error_mcp_http',
  error_mcp_parse: 'error_mcp_parse',
  error_mcp_upstream: 'error_mcp_upstream',
  error_mcp_no_result: 'error_mcp_no_result',
  error_mcp_no_text: 'error_mcp_no_text',
} as const;

export type MessageName = (typeof MSG)[keyof typeof MSG];
