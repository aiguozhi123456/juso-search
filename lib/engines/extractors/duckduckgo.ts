import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, snippetText, titleText } from './shared';

// DuckDuckGo 自然结果抽取器（主站 React 版）。真机复核（2026-07-31）：SSR shell
// #react-results / ol.react-results--main 在真实 duckduckgo.com 上不存在
// （docs/solutions/ui-bugs/duckduckgo-react-serp-anchors-and-real-device-probing.md），
// 直接对 article[data-testid="result"] 全文档查询；data-testid 属性是生产测试钩子、最稳定。
// 广告与自然结果结构相似，须排除 [data-testid="ad"]。
const DUCKDUCKGO_AD_SELECTOR = '[data-testid="ad"]';

/**
 * 解包 DuckDuckGo 跳转壳：/l/?uddg=<urlencoded>&rut=… 承载真实落地 URL，agent 需要目标站地址
 * （bing 的 /ck/a、google 的 /url?q=、baidu 的 mu 同理）。仅解 duckduckgo.com 自身的 /l/ 壳，
 * 站外伪造的 /l/ 路径不展开（与 google/bing 的宿主校验一致）。
 */
function duckduckgoUrl(value: string | null, pageUrl: string): string | null {
  const href = absoluteHttpUrl(value, pageUrl);
  if (!href) return null;
  const url = new URL(href);
  if (url.pathname !== '/l/' || !/(^|\.)duckduckgo\.com$/i.test(url.hostname)) return href;
  const target = url.searchParams.get('uddg');
  return target ? absoluteHttpUrl(target, pageUrl) : null;
}

export const duckduckgoExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    // /consent 重定向页可经 scopes.isEngineChallengeOrConsentUrl 的 consent token 进入消息流，须归类。
    // /cookie、/anomaly 不在该白名单（消息层直接丢弃、waitAndExtract 4s 超时），此处页内分支不可达，
    // 不徒劳枚举——要支持须先扩 scopes 的 alternation（见 docs/solutions/architecture-patterns/adding-search-engine.md BUG-1）。
    if (/\/consent(?:\/|$)/i.test(new URL(pageUrl, 'https://invalid.local').pathname)) return 'consent';
    if (document.querySelector('#cookie-banner, [data-testid="cookie-banner"]')) return 'consent';
    if (document.querySelector('[id*="captcha" i], iframe[src*="recaptcha" i]')) return 'challenge';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector('article[data-testid="result"]') !== null,
  extract(document, pageUrl): EngineResult[] {
    const items = [...document.querySelectorAll('article[data-testid="result"]')];
    return items.flatMap((item) => {
      // 排除广告（既匹配广告自身 article，也匹配嵌套在广告容器内的项）。
      if (item.matches(DUCKDUCKGO_AD_SELECTOR) || item.closest(DUCKDUCKGO_AD_SELECTOR)) return [];
      const anchor = item.querySelector<HTMLAnchorElement>('a[data-testid="result-title-a"], a.result__a');
      const title = titleText(anchor);
      const url = anchor ? duckduckgoUrl(anchor.getAttribute('href'), pageUrl) : null;
      if (!title || !url) return [];
      const snippet = snippetText(item.querySelector('[data-result="snippet"], [data-testid="result-snippet"], .result__snippet')) || snippetText(item);
      return [{ title, url, snippet }];
    });
  },
};
