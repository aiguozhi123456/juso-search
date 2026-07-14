import { defineConfig } from 'wxt';
import { SERP_HOST_MATCH_PATTERNS } from './lib/engines/scopes';

// 匹配计划 docs/plans/2026-07-01-001-juso-search-plan.md
// U1 脚手架：MV3、独立扩展页（无 default_popup，由 background.action.onClicked 开页）
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    default_locale: 'zh_CN',
    name: '__MSG_ext_name__',
    description: '__MSG_ext_description__',
    version: '0.1.0',
    action: {
      default_title: '__MSG_ext_name__',
    },
    permissions: ['storage', 'downloads'],
    host_permissions: [
      'https://api.tavily.com/*',
      'https://api.exa.ai/*',
      'https://api.stepfun.com/*',
    ],
    // 静态 content script 不需要额外 host permission；engine favicon 在 SERP shadow root 内加载，需声明 web_accessible_resources。
    web_accessible_resources: [
      {
        resources: ['icons/google.svg', 'icons/bing.svg', 'icons/baidu.svg'],
        matches: SERP_HOST_MATCH_PATTERNS,
      },
    ],
  },
});
