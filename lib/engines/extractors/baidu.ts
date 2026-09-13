import type { EngineExtractor, EngineExtractionErrorKind, EngineResult } from './types';
import { absoluteHttpUrl, isChallenge, snippetText, titleText } from './shared';
import { isZhanneiSerpHostname } from '../scopes';

function fallbackSnippet(block: Element): string {
  const clone = block.cloneNode(true) as Element;
  clone.querySelectorAll('h3, .t, cite, button, nav, script, style, svg, .c-showurl').forEach((element) => element.remove());
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

// zhannei（CSE 站内搜索）结果容器：真机验证的骨架见 lib/engines/baidu-zhannei.ts
// （#wrap > #container > #center > #results.content-main > .result×N）。
// 卡片级 DOM 已真机校准（2026-09-13，zhannei.baidu.com/cse/site?q=…&cc=zhihu.com 实测）：
// 卡片 = div.result.f.s0，标题 = h3.c-title > a[cpos="title"]（内嵌 <em> 高亮，textContent 兼容），
// 摘要 = .c-abstract（语义正文，恒存在），.c-showurl 为「URL+日期」展示元数据（非真实 URL 来源）。
// 标题 href 为目标站直链（无 mu/data-log、无 baidu /link 壳）；仍走 baiduResultUrl 的真 URL 优先序，
// 若 baidu 未来改用跳转壳，无 mu 的壳链接卡片如实丢弃而非产出坏 URL。
const ZHANNEI_RESULTS_SELECTOR = '#results.content-main > .result';

function isZhanneiPage(pageUrl: string): boolean {
  try {
    return isZhanneiSerpHostname(new URL(pageUrl).hostname);
  } catch {
    return false;
  }
}

/** zhannei 卡片解析：标题 h3 链接（兜底首个锚点）、URL 复用主站「真 URL 优先于跳转壳」顺序、摘要 c-abstract。 */
function extractZhannei(document: Document, pageUrl: string): EngineResult[] {
  return [...document.querySelectorAll(ZHANNEI_RESULTS_SELECTOR)].flatMap((block) => {
    const anchor = block.querySelector<HTMLAnchorElement>('h3 a') ?? block.querySelector<HTMLAnchorElement>('a[href]');
    const title = titleText(anchor);
    const url = baiduResultUrl(block, anchor, pageUrl);
    if (!title || !url) return [];
    const snippet = snippetText(block.querySelector('.c-abstract, .c-span-last')) || fallbackSnippet(block);
    return [{ title, url, snippet }];
  });
}

export const baiduExtractor: EngineExtractor = {
  pageState(document, pageUrl): EngineExtractionErrorKind | null {
    if (isChallenge(document, pageUrl)) return 'challenge';
    if (/\/passport\//i.test(new URL(pageUrl, 'https://invalid.local').pathname) || document.querySelector('#passport-login-pop, form[action*="passport.baidu" i]')) return 'consent';
    return null;
  },
  hasNaturalResultsArea: (document) => document.querySelector('#content_left') !== null || document.querySelector('#results.content-main') !== null,
  extract(document, pageUrl): EngineResult[] {
    if (isZhanneiPage(pageUrl)) return extractZhannei(document, pageUrl);
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
