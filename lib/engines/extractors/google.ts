import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, isChallenge, isGoogleHostname, snippetText, titleText } from './shared';

function googleUrl(anchor: HTMLAnchorElement, pageUrl: string): string | null {
  const href = absoluteHttpUrl(anchor.getAttribute('href'), pageUrl);
  if (!href) return null;
  const url = new URL(href);
  const target = url.pathname === '/url' && isGoogleHostname(url.hostname)
    ? url.searchParams.get('q') ?? url.searchParams.get('url')
    : href;
  const resolved = absoluteHttpUrl(target, pageUrl);
  if (!resolved) return null;
  const resolvedUrl = new URL(resolved);
  return isGoogleHostname(resolvedUrl.hostname) ? null : resolved;
}

const GOOGLE_RESULT_BLOCK_SELECTOR = '.g, .MjjYud, div[data-hveid], .tF2Cxc';
const GOOGLE_SPECIAL_BLOCKS = [
  '[data-attrid]',
  '[data-async-context*="knowledge" i]',
  '.kp-wholepage',
  '.related-question-pair',
  '.xpdopen',
  '[jsname="N760b"]',
  '[data-text-ad]',
  '[data-ad-client]',
  '.commercial-unit-desktop-rhs',
].join(', ');

export const googleExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    if (isChallenge(document, pageUrl)) return 'challenge';
    if (/consent\.google\./i.test(new URL(pageUrl, 'https://invalid.local').hostname) || document.querySelector('form[action*="consent.google" i], #consent-bump')) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector('#rso, #search, #center_col') !== null,
  extract(document, pageUrl): EngineResult[] {
    const root = document.querySelector('#rso, #search, #center_col');
    if (!root) return [];
    const seen = new Set<Element>();
    return [...root.querySelectorAll('h3')].flatMap((heading) => {
      const block = heading.closest(GOOGLE_RESULT_BLOCK_SELECTOR);
      if (!(block instanceof HTMLElement) || seen.has(block)) return [];
      seen.add(block);
      if (block.matches(GOOGLE_SPECIAL_BLOCKS)) return [];
      const anchor = heading.closest('a') ?? heading.parentElement?.closest('a') ?? block.querySelector('a:has(h3)');
      if (!(anchor instanceof HTMLAnchorElement)) return [];
      const url = googleUrl(anchor, pageUrl);
      const title = titleText(heading);
      if (!url || !title) return [];
      const snippet = snippetText(block.querySelector('[data-sncf], .VwiC3b, div[style*="line-clamp"]')) || snippetText(block);
      return [{ title, url, snippet }];
    });
  },
};
