import { describe, it, expect, afterEach, vi } from 'vitest';
import { t, getUILanguage, MSG } from '@/lib/i18n';

// t()/getUILanguage() 依赖 browser.i18n；无 browser 时安全回退到 messageName / 'zh_CN'。
afterEach(() => vi.unstubAllGlobals());

describe('i18n t()', () => {
  it('returns the localized message when browser.i18n is available', () => {
    vi.stubGlobal('browser', { i18n: { getMessage: (n: string) => `(${n})` } });
    expect(t(MSG.btn_search)).toBe('(btn_search)');
  });

  it('passes substitutions through to browser.i18n.getMessage', () => {
    const getMessage = vi.fn(() => 'a:b');
    vi.stubGlobal('browser', { i18n: { getMessage } });
    expect(t('x', ['a', 'b'])).toBe('a:b');
    expect(getMessage).toHaveBeenCalledWith('x', ['a', 'b']);
  });

  it('falls back to messageName when getMessage returns empty', () => {
    vi.stubGlobal('browser', { i18n: { getMessage: () => '' } });
    expect(t('missing_key')).toBe('missing_key');
  });

  it('falls back to messageName when browser.i18n is undefined', () => {
    vi.stubGlobal('browser', {});
    expect(t('any_key')).toBe('any_key');
  });

  it('falls back to messageName when browser is undefined entirely', () => {
    vi.unstubAllGlobals();
    expect(t('any_key')).toBe('any_key');
  });
});

describe('i18n getUILanguage()', () => {
  it('returns the browser UI language', () => {
    vi.stubGlobal('browser', { i18n: { getUILanguage: () => 'en' } });
    expect(getUILanguage()).toBe('en');
  });

  it('defaults to zh_CN when browser.i18n is unavailable', () => {
    vi.unstubAllGlobals();
    expect(getUILanguage()).toBe('zh_CN');
  });
});
