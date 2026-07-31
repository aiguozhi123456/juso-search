import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, snippetText, titleText } from './shared';

// DuckDuckGo 自然结果抽取器（主站 React 版）。结果在 ol.react-results--main 内，
// 单项为 article[data-testid="result"]，data-testid 属性是生产测试钩子、最稳定。
// 广告与自然结果结构相似，须排除 [data-testid="ad"]。
const DUCKDUCKGO_AD_SELECTOR = '[data-testid="ad"]';

export const duckduckgoExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    // DuckDuckGo 重定向到 /cookie 或 anomaly 页时视作 consent/challenge。
    const path = new URL(pageUrl, 'https://invalid.local').pathname;
    if (/\/(?:cookie|consent|anomaly)(?:\/|$)/i.test(path)) return 'consent';
    if (document.querySelector('#cookie-banner, [data-testid="cookie-banner"]')) return 'consent';
    if (document.querySelector('[id*="captcha" i], iframe[src*="recaptcha" i]')) return 'challenge';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector('ol.react-results--main, article[data-testid="result"]') !== null,
  extract(document, pageUrl): EngineResult[] {
    const list = document.querySelector('ol.react-results--main');
    const items = list ? [...list.querySelectorAll('article[data-testid="result"]')] : [...document.querySelectorAll('article[data-testid="result"]')];
    return items.flatMap((item) => {
      // 排除广告（既匹配广告自身 article，也匹配嵌套在广告容器内的项）。
      if (item.matches(DUCKDUCKGO_AD_SELECTOR) || item.closest(DUCKDUCKGO_AD_SELECTOR)) return [];
      const anchor = item.querySelector<HTMLAnchorElement>('a[data-testid="result-title-a"], a.result__a');
      const title = titleText(anchor);
      const url = anchor ? absoluteHttpUrl(anchor.getAttribute('href'), pageUrl) : null;
      if (!title || !url) return [];
      const snippet = snippetText(item.querySelector('[data-result="snippet"], [data-testid="result-snippet"], .result__snippet')) || snippetText(item);
      return [{ title, url, snippet }];
    });
  },
};
