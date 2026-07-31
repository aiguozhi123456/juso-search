import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, isChallenge, snippetText, titleText } from './shared';

// Yandex 自然结果抽取器。Yandex 为 SSR，#search-result 内 li.serp-item 为单项。
// 类名在 CamelCase BEM（.OrganicTitle-Link）与 lowercase BEM（.organic__url）间轮换，
// 故标题/链接/摘要均用 fallback 链而非单选择器。广告与自然结果同用 serp-item 外壳，须显式排除。
const YANDEX_SPECIAL_BLOCKS = '.serp-item_type_ad, [data-type="ads"], .serp-item_card_navit, [data-cid*="ad"]';

function yandexUrl(item: Element, pageUrl: string): string | null {
  // 标题链接候选（按稳定性降序）：CamelCase BEM → lowercase BEM → 通用 h2 内链接。
  const anchor = item.querySelector<HTMLAnchorElement>('a.OrganicTitle-Link, a.organic__url, h2 a, .organic__title-wrapper a');
  return anchor ? absoluteHttpUrl(anchor.getAttribute('href'), pageUrl) : null;
}

export const yandexExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    if (isChallenge(document, pageUrl)) return 'challenge';
    if (/\/(?:showcaptcha|captcha)(?:\/|$)/i.test(new URL(pageUrl, 'https://invalid.local').pathname)) return 'challenge';
    if (document.querySelector('div[class*="captcha" i], form[action*="captcha" i]')) return 'challenge';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector('#search-result, .serp-list') !== null,
  extract(document, pageUrl): EngineResult[] {
    const root = document.querySelector('#search-result, .serp-list');
    if (!root) return [];
    return [...root.querySelectorAll('li.serp-item')].flatMap((item) => {
      if (item.matches(YANDEX_SPECIAL_BLOCKS)) return [];
      const url = yandexUrl(item, pageUrl);
      // 标题文本候选：CamelCase → lowercase → h2。
      const titleEl = item.querySelector('.OrganicTitle-LinkText, h2, .organic__title');
      const title = titleText(titleEl);
      if (!url || !title) return [];
      // 摘要候选：CamelCase 包装 → lowercase → 旧类名。
      const snippet = snippetText(item.querySelector('.Organic-ContentWrapper .OrganicTextContentSpan, .organic__content, .serp-item__text')) || snippetText(item);
      return [{ title, url, snippet }];
    });
  },
};
