import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnchorStrategy } from '@/lib/engines/types';
import { bingEngine } from '@/lib/engines/bing';
import { baiduEngine } from '@/lib/engines/baidu';
import {
  PAGE_STYLES_ID,
  injectPageStyles,
  pickAnchor,
  removePageStyles,
} from '@/lib/serp-bar-mount';

const A: AnchorStrategy = { selector: '#a', append: 'first' };
const B: AnchorStrategy = { selector: '#b', append: 'before', alignTo: '#b' };
const C: AnchorStrategy = { selector: '#c', append: 'before', alignTo: '#c' };

/** Helper: count <style#juso-serp-page-styles> currently in <head>. */
function countPageStyleEls(): number {
  return document.head.querySelectorAll(`style#${PAGE_STYLES_ID}`).length;
}

describe('pickAnchor', () => {
  it('returns the first candidate whose selector resolves', () => {
    // 假 querySelector：仅第二个候选 (#b) 命中。
    const query = (selector: string): Element | null =>
      selector === B.selector ? document.createElement('div') : null;

    expect(pickAnchor([A, B, C], query)).toBe(B);
  });

  it('falls through to the last candidate when no selector matches', () => {
    const query = (): Element | null => null;

    expect(pickAnchor([A, B, C], query)).toBe(C);
  });

  it('single-candidate array returns that candidate when it matches (Bing runtime path)', () => {
    const query = (): Element | null => document.createElement('div');

    expect(pickAnchor([A], query)).toBe(A);
  });

  it('single-candidate array returns that candidate even when it does not match', () => {
    // Bing 的运行时路径总是落入此分支并交 MutationObserver 等待；
    // 函数契约：仍返回该候选作为等待目标。
    const query = (): Element | null => null;

    expect(pickAnchor([A], query)).toBe(A);
  });

  it('uses document.querySelector as the default dependency', () => {
    // 默认参数路径：jsdom 下没有 #a/#b/#c，应落入末位候选 C。
    expect(pickAnchor([A, B, C])).toBe(C);
  });
});

describe('injectPageStyles', () => {
  afterEach(() => {
    removePageStyles(document);
  });

  it('creates exactly one <style> in <head> for an engine with pageStyles (baidu)', () => {
    injectPageStyles(baiduEngine, document);

    const els = document.head.querySelectorAll<HTMLStyleElement>(`style#${PAGE_STYLES_ID}`);
    expect(els).toHaveLength(1);

    const el = els[0]!;
    expect(el.id).toBe(PAGE_STYLES_ID);
    expect(el.dataset.engine).toBe('baidu');
    expect(el.textContent).toBe(baiduEngine.pageStyles);
  });

  it('is a no-op for an engine without pageStyles (bing)', () => {
    expect(bingEngine.pageStyles).toBeUndefined();

    injectPageStyles(bingEngine, document);

    expect(countPageStyleEls()).toBe(0);
  });

  it('is idempotent on re-mount: a second call replaces, does not duplicate', () => {
    injectPageStyles(baiduEngine, document);
    injectPageStyles(baiduEngine, document);

    const els = document.head.querySelectorAll<HTMLStyleElement>(`style#${PAGE_STYLES_ID}`);
    expect(els).toHaveLength(1);
    expect(els[0]!.dataset.engine).toBe('baidu');
    expect(els[0]!.textContent).toBe(baiduEngine.pageStyles);
  });
});

describe('removePageStyles', () => {
  beforeEach(() => {
    // 起始态：head 不含目标 <style>。
    removePageStyles(document);
  });

  it('removes the <style> injected by injectPageStyles', () => {
    injectPageStyles(baiduEngine, document);
    expect(countPageStyleEls()).toBe(1);

    removePageStyles(document);

    expect(countPageStyleEls()).toBe(0);
  });

  it('is a no-op when no such element exists (does not throw)', () => {
    expect(countPageStyleEls()).toBe(0);

    expect(() => removePageStyles(document)).not.toThrow();

    expect(countPageStyleEls()).toBe(0);
  });
});
