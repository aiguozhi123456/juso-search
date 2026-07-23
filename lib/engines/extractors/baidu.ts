import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, isChallenge, snippetText, titleText } from './shared';

function fallbackSnippet(block: Element): string {
  const clone = block.cloneNode(true) as Element;
  clone.querySelectorAll('h3, .t, cite, button, nav, script, style, svg').forEach((element) => element.remove());
  return snippetText(clone);
}

/** Baidu jump shells that are not usable destination URLs for agents. */
function isBaiduRedirectShell(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)baidu\.com$/i.test(parsed.hostname)) return false;
    return /\/link\b/i.test(parsed.pathname) || /\/from\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function parseMuFromDataLog(block: Element): string | null {
  const raw = block.getAttribute('data-log') ?? (block instanceof HTMLElement ? block.dataset.log : null);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw.replace(/'/g, '"')) as { mu?: unknown };
    return typeof parsed.mu === 'string' ? parsed.mu : null;
  } catch {
    return null;
  }
}

function scVurlFromHref(href: string | null, pageUrl: string): string | null {
  if (!href) return null;
  try {
    return new URL(href, pageUrl).searchParams.get('sc_vurl');
  } catch {
    return null;
  }
}

/**
 * Prefer page-embedded real URLs over baidu.com/link shells.
 * Order mirrors common SERP fields (desktop mu → mdurl → mobile log → scholar sc_vurl → bare href).
 * No network follow-redirect.
 */
function baiduResultUrl(block: Element, anchor: HTMLAnchorElement | null, pageUrl: string): string | null {
  const candidates = [
    block.getAttribute('mu'),
    anchor?.getAttribute('data-mdurl') ?? null,
    parseMuFromDataLog(block),
    scVurlFromHref(anchor?.getAttribute('href') ?? null, pageUrl),
    anchor?.getAttribute('href') ?? null,
  ];
  for (const candidate of candidates) {
    if (!candidate || candidate.includes('nourl')) continue;
    const resolved = absoluteHttpUrl(candidate, pageUrl);
    if (!resolved || isBaiduRedirectShell(resolved)) continue;
    return resolved;
  }
  return null;
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
      const url = baiduResultUrl(block, anchor, pageUrl);
      if (!title || !url) return [];
      const snippet = snippetText(block.querySelector('.c-abstract, .c-span-last')) || fallbackSnippet(block);
      return [{ title, url, snippet }];
    });
  },
};
