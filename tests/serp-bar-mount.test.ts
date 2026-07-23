import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AnchorStrategy } from '@/lib/engines/types';
import { bingEngine } from '@/lib/engines/bing';
import { baiduEngine } from '@/lib/engines/baidu';
import {
  PAGE_STYLES_ID,
  injectPageStyles,
  pickAnchor,
  removePageStyles,
  preferredAnchorCandidates,
  preferredAnchorsPresent,
  anyAnchorPresent,
  canAttemptMount,
  shouldUpgradeFromLastResort,
  isLastResortAnchorIndex,
  consumeRemountBudget,
  shouldMountForEngine,
  DEFAULT_REMOUNT_BUDGET,
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

describe('remount / upgrade policy (pure)', () => {
  const present = (ids: string[]) => (selector: string) =>
    ids.includes(selector) ? document.createElement('div') : null;

  it('preferredAnchorCandidates drops last-resort when multi-candidate', () => {
    expect(preferredAnchorCandidates([A, B, C])).toEqual([A, B]);
    expect(preferredAnchorCandidates([A])).toEqual([A]);
  });

  it('isLastResortAnchorIndex is true only for last of multi-candidate list', () => {
    expect(isLastResortAnchorIndex([A, B, C], 2)).toBe(true);
    expect(isLastResortAnchorIndex([A, B, C], 1)).toBe(false);
    expect(isLastResortAnchorIndex([A], 0)).toBe(false);
  });

  it('preferredAnchorsPresent ignores last-resort #app-style fallback', () => {
    expect(preferredAnchorsPresent([A, B, C], present(['#c']))).toBe(false);
    expect(preferredAnchorsPresent([A, B, C], present(['#b']))).toBe(true);
  });

  it('anyAnchorPresent includes last-resort', () => {
    expect(anyAnchorPresent([A, B, C], present(['#c']))).toBe(true);
    expect(anyAnchorPresent([A, B, C], present([]))).toBe(false);
  });

  it('canAttemptMount waits for preferred unless budget is last chance', () => {
    // 仅兜底存在、预算充足 → 不挂（继续等 #search-input / .feeds-container）
    expect(canAttemptMount({
      candidates: [A, B, C],
      remountBudget: DEFAULT_REMOUNT_BUDGET,
      querySelectorFn: present(['#c']),
    })).toBe(false);
    // 仅兜底 + 预算=1 → 允许最后一次挂兜底
    expect(canAttemptMount({
      candidates: [A, B, C],
      remountBudget: 1,
      querySelectorFn: present(['#c']),
    })).toBe(true);
    // 非兜底出现 → 可挂
    expect(canAttemptMount({
      candidates: [A, B, C],
      remountBudget: 3,
      querySelectorFn: present(['#a']),
    })).toBe(true);
    // 预算耗尽
    expect(canAttemptMount({
      candidates: [A, B, C],
      remountBudget: 0,
      querySelectorFn: present(['#a']),
    })).toBe(false);
  });

  it('shouldUpgradeFromLastResort only upgrades from last-resort index', () => {
    // 挂在 #search-input(index=1) 时，即使 .feeds-container 出现也不升级（防抖动）
    expect(shouldUpgradeFromLastResort({
      candidates: [A, B, C],
      mountedAnchorIndex: 1,
      querySelectorFn: present(['#a']),
    })).toBe(false);
    // 挂在 #app(index=2) 且 #search-input 出现 → 升级
    expect(shouldUpgradeFromLastResort({
      candidates: [A, B, C],
      mountedAnchorIndex: 2,
      querySelectorFn: present(['#b']),
    })).toBe(true);
    // 挂在首选 → 不升级
    expect(shouldUpgradeFromLastResort({
      candidates: [A, B, C],
      mountedAnchorIndex: 0,
      querySelectorFn: present(['#a']),
    })).toBe(false);
  });

  it('consumeRemountBudget decrements and floors at 0', () => {
    expect(consumeRemountBudget(3)).toBe(2);
    expect(consumeRemountBudget(1)).toBe(0);
    expect(consumeRemountBudget(0)).toBe(0);
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

describe('shouldMountForEngine (hidden engine gate)', () => {
  it('mounts when the engine is not in the hidden list', () => {
    expect(shouldMountForEngine('google', ['bing', 'baidu'])).toBe(true);
  });

  it('does not mount when the engine is hidden', () => {
    expect(shouldMountForEngine('douyin', ['douyin', 'xiaohongshu'])).toBe(false);
    expect(shouldMountForEngine('xiaohongshu', ['douyin', 'xiaohongshu'])).toBe(false);
  });

  it('mounts when the hidden list is undefined or empty', () => {
    expect(shouldMountForEngine('google', undefined)).toBe(true);
    expect(shouldMountForEngine('google', [])).toBe(true);
  });
});
