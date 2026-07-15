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
  const seenUrls = new Set<string>();
  const seenContent = new Set<string>();
  const unique: EngineResult[] = [];
  for (const result of results) {
    const urlKey = result.url.toLowerCase();
    const contentKey = `${result.title}\n${result.url}\n${result.snippet}`.toLowerCase();
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
