import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, isChallenge, snippetText, titleText } from './shared';

function isBingHostname(hostname: string): boolean {
  return /(^|\.)bing\.com$/i.test(hostname);
}

function decodedBingUrl(value: string, pageUrl: string): string | null {
  const href = absoluteHttpUrl(value, pageUrl);
  if (!href) return null;
  const url = new URL(href);
  if (url.pathname !== '/ck/a' || !isBingHostname(url.hostname)) return href;
  const encoded = url.searchParams.get('u');
  if (!encoded?.startsWith('a1')) return null;
  try {
    const base64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='));
    return absoluteHttpUrl(decoded, pageUrl);
  } catch {
    return null;
  }
}

export const bingExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    if (isChallenge(document, pageUrl)) return 'challenge';
    if (/^\/fd\/ls\//i.test(new URL(pageUrl, 'https://invalid.local').pathname) || document.querySelector('#bnp_container, form[action*="consent" i]')) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector('#b_results') !== null,
  extract(document, pageUrl): EngineResult[] {
    return [...document.querySelectorAll('#b_results li.b_algo')].flatMap((item) => {
      if (item.matches('.b_ad, .b_ans, .b_pag, .b_msg') || item.closest('.b_ad, .b_ans, .b_pag, .b_msg')) return [];
      const anchor = item.querySelector<HTMLAnchorElement>('h2 a, .b_title a');
      const title = titleText(anchor);
      const url = anchor ? decodedBingUrl(anchor.href, pageUrl) : null;
      if (!title || !url) return [];
      return [{ title, url, snippet: snippetText(item.querySelector('.b_caption p, .b_snippet, p')) }];
    });
  },
};
