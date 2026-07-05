import { describe, it, expect, afterEach, vi } from 'vitest';
import { t, getUILanguage, setLocale, getCurrentLocale, getCurrentLocalePref, MSG } from '@/lib/i18n';

// 新 i18n 层用 import.meta.glob 在构建期打包 messages.json，t() 同步查表。
// browser.i18n 仅用于 auto 模式解析 UI 语言；getUILanguage 仍走 browser.i18n。

afterEach(() => {
  vi.unstubAllGlobals();
  // 重置回 auto，避免用例间 locale 串扰
  setLocale('auto');
});

describe('i18n t() lookup', () => {
  it('returns the localized message for the current locale', () => {
    // 测试环境默认 auto；getUILanguage 无 browser 时回退 zh_CN
    expect(t(MSG.btn_search)).toBe('搜索');
  });

  it('switches output when locale changes via setLocale', () => {
    setLocale('en');
    expect(t(MSG.btn_search)).toBe('Search');
    setLocale('zh_CN');
    expect(t(MSG.btn_search)).toBe('搜索');
  });

  it('applies positional substitutions ($1/$2)', () => {
    setLocale('zh_CN');
    expect(t(MSG.error_http_server, ['Tavily', '500'])).toBe('Tavily：服务端错误 500');
    setLocale('en');
    expect(t(MSG.error_http_server, ['Tavily', '500'])).toBe('Tavily: server error 500');
  });

  it('falls back to en when a key is missing in the current locale, then to the key name', () => {
    // 两份 locale 都没有的键 → 回退键名
    expect(t('totally_missing_key')).toBe('totally_missing_key');
  });

  it('tracks currentLocale / currentLocalePref', () => {
    setLocale('en');
    expect(getCurrentLocale()).toBe('en');
    expect(getCurrentLocalePref()).toBe('en');
    setLocale('auto');
    expect(getCurrentLocalePref()).toBe('auto');
  });
});

describe('i18n auto resolution from browser.i18n.getUILanguage', () => {
  it('maps zh* UI language to zh_CN', () => {
    vi.stubGlobal('browser', { i18n: { getUILanguage: () => 'zh-CN' } });
    setLocale('auto');
    expect(getCurrentLocale()).toBe('zh_CN');
  });

  it('maps non-zh UI language to en', () => {
    vi.stubGlobal('browser', { i18n: { getUILanguage: () => 'en-US' } });
    setLocale('auto');
    expect(getCurrentLocale()).toBe('en');
  });

  it('defaults to zh_CN when browser.i18n is unavailable', () => {
    vi.unstubAllGlobals();
    setLocale('auto');
    expect(getCurrentLocale()).toBe('zh_CN');
  });
});

describe('i18n getUILanguage()', () => {
  it('returns the browser UI language when available', () => {
    vi.stubGlobal('browser', { i18n: { getUILanguage: () => 'en-US' } });
    expect(getUILanguage()).toBe('en-US');
  });

  it('defaults to zh_CN when browser.i18n is unavailable', () => {
    vi.unstubAllGlobals();
    expect(getUILanguage()).toBe('zh_CN');
  });
});
