import { defineConfig } from 'wxt';
import { SERP_HOST_MATCH_PATTERNS } from './lib/engines/scopes';

// 匹配计划 docs/plans/2026-07-01-001-juso-search-plan.md
// U1 脚手架：MV3、独立扩展页（无 default_popup，由 background.action.onClicked 开页）
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvAxEFF0Up3XvOn0VyQAFrTZgGU+fkXo6gkV54gRSDeU9ATUcKJyhRMix2wpRS73XsZifseTLKIstNJAgYylA4lKgxnAKfE5jlFijZvJm5EZ9wxgH1ZWlpLB/d0tcg6J5yz7zdMFkzjyB29FnqLSoexP98l9XtckIyDosHaHRlSyhkWKHIxHSqHzhUFQU2+599svz4WX2C/jv+UTy+BDDYduTShjPd89QUBBqBqhKVKvsKS+Y+xE4HX9JQNTkQdCHbgwwEq05eHemhKJH4tbmJb1YT4uC4QaaW4TNmLz93DaXn9ENvQ73wPufXcC7m7BEXtG4Puks/Q8zlWie7bgecQIDAQAB',
    default_locale: 'zh_CN',
    name: '__MSG_ext_name__',
    description: '__MSG_ext_description__',
    version: '1.0.0',
    action: {
      default_title: '__MSG_ext_name__',
    },
    permissions: ['storage', 'downloads'],
    host_permissions: [
      'http://127.0.0.1/*',
      'https://api.tavily.com/*',
      'https://api.exa.ai/*',
      'https://api.stepfun.com/*',
    ],
    // 静态 content script 不需要额外 host permission；engine 与 provider 的 favicon 在 SERP shadow root 内加载，需声明 web_accessible_resources。
    web_accessible_resources: [
      {
        resources: [
          'icons/google.svg',
          'icons/bing.svg',
          'icons/baidu.svg',
          'icons/douyin.svg',
          'icons/xiaohongshu.svg',
          'icons/tavily.svg',
          'icons/exa.svg',
          'icons/stepfun.svg',
        ],
        matches: SERP_HOST_MATCH_PATTERNS,
      },
    ],
  } as any,
});
