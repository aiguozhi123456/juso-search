import { defineConfig } from 'wxt';
import { SERP_HOST_MATCH_PATTERNS } from './lib/engines/scopes';

// 匹配计划 docs/plans/2026-07-01-001-juso-search-plan.md
// U1 脚手架：MV3、独立扩展页（无 default_popup，由 background.action.onClicked 开页）
// 开发用公钥：development 模式注入以稳定扩展 ID；production 构建不含 key，满足 Chrome Web Store 审核要求。
const DEV_EXTENSION_KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvAxEFF0Up3XvOn0VyQAFrTZgGU+fkXo6gkV54gRSDeU9ATUcKJyhRMix2wpRS73XsZifseTLKIstNJAgYylA4lKgxnAKfE5jlFijZvJm5EZ9wxgH1ZWlpLB/d0tcg6J5yz7zdMFkzjyB29FnqLSoexP98l9XtckIyDosHaHRlSyhkWKHIxHSqHzhUFQU2+599svz4WX2C/jv+UTy+BDDYduTShjPd89QUBBqBqhKVKvsKS+Y+xE4HX9JQNTkQdCHbgwwEq05eHemhKJH4tbmJb1YT4uC4QaaW4TNmLz93DaXn9ENvQ73wPufXcC7m7BEXtG4Puks/Q8zlWie7bgecQIDAQAB';

// engine 与 provider 的 favicon 清单：下方两个 web_accessible_resources 条目
// （SERP shadow root 匹配 与 <all_urls> 划词弹窗）必须暴露同一份图标，否则
// 新增/删除图标时漏改一侧会让该表面的 favicon 静默失效。
const FAVICON_RESOURCES = [
  'icons/google.svg',
  'icons/bing.svg',
  'icons/baidu.svg',
  'icons/douyin.svg',
  'icons/xiaohongshu.svg',
  'icons/bilibili.svg',
  'icons/yandex.svg',
  'icons/duckduckgo.svg',
  'icons/weixin.svg',
  'icons/tavily.svg',
  'icons/exa.svg',
  'icons/brave.svg',
  'icons/stepfun.svg',
  'icons/doubao.svg',
  'icons/jina.svg',
  'icons/parallel.svg',
  'icons/anysearch.svg',
  'icons/site.svg',
  'icons/custom-engine.svg',
  'icons/aggregate.svg',
  'icons/ai-grok.svg',
  'icons/ai-chatgpt.svg',
  'icons/ai-deepseek.svg',
  'icons/ai-doubao-chat.svg',
  'icons/ai-gemini.svg',
];

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  // __SKILL_VARIANT__ 编译期常量：'dev'（wxt build --mode development）或 'prod'（其余构建）。
  // 后台 worker 用它在 Options 内下载技能包时选择打包进扩展的技能模板（public/agent-skill/）。
  vite: (env) => ({
    define: {
      __SKILL_VARIANT__: JSON.stringify(env.mode === 'development' ? 'dev' : 'prod'),
    },
    build: {
      // 不生成 <link rel="modulepreload">：Chrome 拒绝复用预取的 chrome-extension://
      // 模块——预取请求与后续 import 落在不同 world（"cross-world extension resource
      // mismatch"，crbug.com/540906914），每个预取 chunk 白抓一次并各报一条告警。
      // 扩展页的 chunk 是本地磁盘上的静态 import，preload 提示毫无收益。
      modulePreload: false,
    },
  }),
  manifest: ({ browser, mode }) => ({
    // Chrome dev 构建注入 key 以稳定扩展 ID；Firefox 忽略 key 且 web-ext lint 标记未知字段。
    ...(mode === 'development' && browser === 'chrome' ? { key: DEV_EXTENSION_KEY } : {}),
    // Firefox MV3 必填：稳定 gecko ID（AMO 标识，永不可变）+ data_collection_permissions（2025-11-03 起新提交强制）。
    ...(browser === 'firefox'
      ? {
          browser_specific_settings: {
            gecko: {
              id: 'juso-search@extension',
              strict_min_version: '127.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }
      : {}),
    default_locale: 'zh_CN',
    name: '__MSG_ext_name__',
    description: '__MSG_ext_description__',
    // version 由 WXT 自动从 package.json 读取（单一源），勿在此硬编码。
    action: {
      default_title: '__MSG_ext_name__',
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    permissions: ['storage', 'downloads', 'contextMenus'],
    host_permissions: [
      'http://127.0.0.1/*',
      'https://api.tavily.com/*',
      'https://api.exa.ai/*',
      'https://api.search.brave.com/*',
      'https://api.stepfun.com/*',
      'https://open.feedcoopapi.com/*',
      'https://s.jina.ai/*',
      'https://api.parallel.ai/*',
      'https://api.siliconflow.cn/*',
      'https://api.deepseek.com/*',
      'https://api.anysearch.com/*',
    ],
    // 静态 content script 不需要额外 host permission；engine 与 provider 的 favicon 在 SERP shadow root 内加载，需声明 web_accessible_resources。
    // 划词搜索弹窗在任意网页注入，favicon 需在所有页面可加载，故新增 <all_urls> 条目。
    // WAR 是资源暴露声明，不是权限——不触发额外权限提示。
    web_accessible_resources: [
      {
        resources: FAVICON_RESOURCES,
        matches: SERP_HOST_MATCH_PATTERNS,
      },
      {
        resources: FAVICON_RESOURCES,
        matches: ['<all_urls>'],
      },
    ],
  }),
});
