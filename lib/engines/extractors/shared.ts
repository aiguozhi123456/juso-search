import type { EngineResult } from './types';

const MAX_TITLE_LENGTH = 300;
const MAX_SNIPPET_LENGTH = 1_000;

export function normalizeText(value: string, maximumLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maximumLength ? normalized.slice(0, maximumLength).trimEnd() : normalized;
}

export function textOf(element: Element | null, maximumLength: number): string {
  return normalizeText(element?.textContent ?? '', maximumLength);
}

export function titleText(element: Element | null): string {
  return textOf(element, MAX_TITLE_LENGTH);
}

export function snippetText(element: Element | null): string {
  return textOf(element, MAX_SNIPPET_LENGTH);
}

export function absoluteHttpUrl(value: string | null, pageUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, pageUrl);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function uniqueResults(results: EngineResult[], maximumResults: number): EngineResult[] {
  // 去重语义（九个抽取器共用）：
  //   • URL 去重——完整 URL 视为同一条；
  //   • 内容去重——标题+摘要逐字相同视为同一条（镜像/转载重复投递），与 URL 无关。
  // contentKey 曾混入 URL，导致该子句永不被触发（同 URL 已被 seenUrls 先拦）形同死代码；
  // 剔除 URL 后内容去重才真正生效。
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const unique: EngineResult[] = [];
  for (const result of results) {
    const urlKey = result.url.toLowerCase();
    const contentKey = `${result.title}\n${result.snippet}`.toLowerCase();
    if (seenUrls.has(urlKey) || seenContent.has(contentKey)) continue;
    seenUrls.add(urlKey);
    seenContent.add(contentKey);
    unique.push(result);
    if (unique.length === maximumResults) break;
  }
  return unique;
}

export function clampedMaxResults(value: number | undefined): number {
  return Math.min(20, Math.max(1, Math.floor(value ?? 10)));
}

export function isGoogleHostname(hostname: string): boolean {
  return /(^|\.)google\.[a-z.]+$/i.test(hostname);
}

export function isChallenge(document: Document, pageUrl: string): boolean {
  return (
    /\/(?:sorry|captcha)(?:\/|$)/i.test(new URL(pageUrl, 'https://invalid.local').pathname) ||
    document.querySelector('[id*="captcha" i], form[action*="captcha" i], iframe[src*="recaptcha" i]') !== null
  );
}

// ── 社媒 SPA（小红书/抖音/B站）共用页态选择器 ─────────────────────────────
// 三个社媒抽取器的 challenge/consent 判定逐字重复，集中一处维护（选择器修正只改一处）。

/**
 * 验证码/风控挑战容器。刻意不收 [class*="verify" i]：社媒结果卡的作者认证徽章
 * 普遍携带 verify 类名，会把健康 SERP 误判为 challenge 并整页丢弃结果。
 */
export const SOCIAL_CHALLENGE_SELECTOR = '.captcha, #captcha, .geetest, #geetest-wrap, [class*="captcha" i]';

/** 全屏登录遮罩（未登录拦截态）。 */
export const SOCIAL_LOGIN_MODAL_SELECTOR = '.login-container, #login-container, [class*="login" i][class*="modal" i], [class*="login" i][class*="mask" i]';

/**
 * 元素是否实际渲染。SPA 外壳常把登录遮罩等节点常驻 DOM（display:none），
 * querySelector 不区分可见性——沿祖先链确认无 display:none 才算拦截态，
 * 否则已登录且有结果的页会被误报 consent、静默丢弃全部结果。
 */
export function isRenderedElement(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.ownerDocument.defaultView?.getComputedStyle(node).display === 'none') return false;
  }
  return true;
}
