import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../shared/tokens.css';
import '../shared/components.css';
import './styles.css';
import { getCurrentLocale, subscribeLocale, t, MSG } from '@/lib/i18n';

// <html lang> 与 <title> 跟随当前 UI locale（手动切换或浏览器语言）。
function applyDocumentLocale() {
  const loc = getCurrentLocale();
  document.documentElement.lang = loc === 'zh_CN' ? 'zh-CN' : 'en';
  document.title = t(MSG.search_page_title);
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
