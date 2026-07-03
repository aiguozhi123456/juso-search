import { defineConfig } from 'wxt';

// 匹配计划 docs/plans/2026-07-01-001-product-ai-search-for-humans-plan.md
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
    permissions: ['storage'],
    host_permissions: [
      'https://api.tavily.com/*',
      'https://api.exa.ai/*',
      'https://api.stepfun.com/*',
    ],
  },
});
