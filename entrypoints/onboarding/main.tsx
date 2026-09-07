import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../shared/tokens.css';
import '../shared/page-bg.css';
import '../shared/components.css';
/* 来源布局编辑器样式类（.layout-*）与 KeyDemo 用的真实 .key-row 由 options 页
   样式表定义，直接引入保证示意与设置页所见一致（body 全局文字色等也来自它，
   见本页 styles.css 说明）。 */
import '../options/styles.css';
/* 搜索页真实组件类（.search-box / .source-switcher / .switcher-track / .group-flyout /
   .loading-skeleton / .answer-card / .result-card 等）由 search 页样式表定义，
   WelcomeDemo 与 QuickbarDemo 直接建在真实类名上。两页级样式表共存的冲突消解
   见本页 styles.css（「页级样式表共存」一节）；要点：
   · @keyframes juso-fade-in 两表重名（options 版带 translateY，search 版纯淡入），
     后载的 search 版全局生效——本页 markup 不使用该动画（.options section 与
     .history-overlay 均不在引导页），无视觉影响；
   · body 仅新增 overflow-x: clip，本页无横向溢出，无害；
   · .wordmark-text 会被 search 表带上 font-size: var(--text-xl)，引导页头部已在
     styles.css 内恢复原尺寸。 */
import '../search/styles.css';
import './styles.css';
import { getCurrentLocale, subscribeLocale, t, MSG } from '@/lib/i18n';

// <html lang> 与 <title> 跟随当前 UI locale（手动切换或浏览器语言）。
function applyDocumentLocale() {
  const loc = getCurrentLocale();
  document.documentElement.lang = loc === 'zh_CN' ? 'zh-CN' : 'en';
  document.title = t(MSG.onboarding_page_title);
}
applyDocumentLocale();
subscribeLocale(applyDocumentLocale);

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
