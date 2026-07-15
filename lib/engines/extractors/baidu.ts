import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, isChallenge, snippetText, titleText } from './shared';

function fallbackSnippet(block: Element): string {
  const clone = block.cloneNode(true) as Element;
  clone.querySelectorAll('h3, .t, cite, button, nav, script, style, svg').forEach((element) => element.remove());
  return snippetText(clone);
}

export const baiduExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    if (isChallenge(document, pageUrl)) return 'challenge';
    if (/\/passport\//i.test(new URL(pageUrl, 'https://invalid.local').pathname) || document.querySelector('#passport-login-pop, form[action*="passport.baidu" i]')) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector('#content_left') !== null,
  extract(document, pageUrl): EngineResult[] {
    return [...document.querySelectorAll('#content_left > .result.c-container, #content_left > .result, #content_left > .c-container')].flatMap((block) => {
      if (block.matches('.result-op, [data-click*="ad" i], .ec_wise_ad')) return [];
      const anchor = block.querySelector<HTMLAnchorElement>('h3 > a, .t > a');
      const title = titleText(anchor);
      const url = absoluteHttpUrl(block.getAttribute('mu') ?? anchor?.getAttribute('href') ?? null, pageUrl);
      if (!title || !url) return [];
      const snippet = snippetText(block.querySelector('.c-abstract, .c-span-last')) || fallbackSnippet(block);
      return [{ title, url, snippet }];
    });
  },
};
