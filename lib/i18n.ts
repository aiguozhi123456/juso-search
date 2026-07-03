// i18n 访问层：封装 browser.i18n.getMessage，集中消息名常量防止拼写漂移。
// manifest 字符串（name/description/title）走 Chrome 原生 __MSG_*__ 替换；
// 运行时 UI 字符串（含后台 worker 生成的错误）统一经 t()。
// 插值用 Chrome 占位符 $1/$2（messages.json 中亦可写 $provider$ 形式，此处用序参最简）。

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
  // 设置入口 / 主题
  open_settings: 'open_settings',
  theme_group: 'theme_group',
  theme_auto: 'theme_auto',
  theme_light: 'theme_light',
  theme_dark: 'theme_dark',
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

// browser.i18n.getMessage 的 webext 类型把 messageName 收窄成预定义字面量联合，
// 此处按 (string)=>string 放宽，使动态键（含 provider label）可用。
type GetMessage = (messageName: string, substitutions?: string | string[]) => string;

/**
 * 取本地化消息。substitutions 为字符串或字符串数组，对应 messages.json 的 $1/$2。
 * 找不到时回退到 messageName 本身（便于发现漏配）。
 * 无 browser.i18n 环境（部分测试）也安全回退。
 */
export function t(messageName: string, substitutions?: string | string[]): string {
  // typeof 检查避免 browser 未定义（部分测试环境）时抛 ReferenceError。
  if (typeof browser === 'undefined' || !browser?.i18n?.getMessage) return messageName;
  const getMessage = browser.i18n.getMessage as GetMessage;
  const msg = getMessage(messageName, substitutions);
  return msg || messageName;
}

/** 当前浏览器 UI 语言（如 'zh_CN'/'en'），用于设置 <html lang>。 */
export function getUILanguage(): string {
  if (typeof browser === 'undefined' || !browser?.i18n?.getUILanguage) return 'zh_CN';
  return browser.i18n.getUILanguage();
}
