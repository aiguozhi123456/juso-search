// AI engine 注入器 extractQuery 纯逻辑测试。
//
// 只解析 URL 字符串，不碰 DOM——无需 mock 文档。extractQueryWithNavFallback 在 jsdom 里
// performance.getEntriesByType('navigation') 返回空数组（或不可用被 catch），
// 因此无 q 时自然回退到 null；navEntry 回退路径用 vi.stubGlobal 单独覆盖。

import { afterEach, describe, expect, it, vi } from 'vitest';
import { chatgptInjector } from '@/lib/ai-engines/injectors/generic-enter';
import { deepseekInjector } from '@/lib/ai-engines/injectors/deepseek';
import { doubaoInjector } from '@/lib/ai-engines/injectors/doubao';
import { geminiInjector } from '@/lib/ai-engines/injectors/gemini';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generic-enter (chatgpt) extractQuery', () => {
  it('extracts the q parameter', () => {
    expect(chatgptInjector.extractQuery('https://chatgpt.com/?q=foo')).toBe('foo');
  });

  it('decodes percent-encoded values', () => {
    expect(chatgptInjector.extractQuery('https://chatgpt.com/?q=foo%20bar')).toBe('foo bar');
  });

  it('returns null when there is no q parameter', () => {
    expect(chatgptInjector.extractQuery('https://chatgpt.com/')).toBeNull();
    expect(chatgptInjector.extractQuery('https://chatgpt.com/?prompt=bar')).toBeNull();
  });
});

describe('deepseek extractQuery', () => {
  it('extracts the q parameter from the current URL (main path, no navEntry dependency)', () => {
    expect(deepseekInjector.extractQuery('https://chat.deepseek.com/?q=foo')).toBe('foo');
  });

  it('returns null when neither the current URL nor a navigation entry carries q', () => {
    expect(deepseekInjector.extractQuery('https://chat.deepseek.com/')).toBeNull();
  });

  it('falls back to the navigation entry original URL when the SPA stripped the query', () => {
    vi.stubGlobal('performance', {
      getEntriesByType: () => [{ name: 'https://chat.deepseek.com/?q=from-nav-entry' }],
    } as unknown as Performance);
    expect(deepseekInjector.extractQuery('https://chat.deepseek.com/')).toBe('from-nav-entry');
  });
});

describe('doubao extractQuery', () => {
  it('extracts the q parameter from the current URL (main path)', () => {
    expect(doubaoInjector.extractQuery('https://www.doubao.com/chat/?q=foo')).toBe('foo');
  });

  it('returns null when neither the current URL nor a navigation entry carries q', () => {
    expect(doubaoInjector.extractQuery('https://www.doubao.com/chat/')).toBeNull();
  });

  it('falls back to the navigation entry original URL', () => {
    vi.stubGlobal('performance', {
      getEntriesByType: () => [{ name: 'https://www.doubao.com/chat/?q=from-nav-entry' }],
    } as unknown as Performance);
    expect(doubaoInjector.extractQuery('https://www.doubao.com/chat/')).toBe('from-nav-entry');
  });
});

describe('gemini extractQuery', () => {
  it('prefers the q parameter over prompt', () => {
    expect(geminiInjector.extractQuery('https://gemini.google.com/app?q=foo&prompt=bar')).toBe('foo');
  });

  it('extracts the q parameter', () => {
    expect(geminiInjector.extractQuery('https://gemini.google.com/app?q=foo')).toBe('foo');
  });

  it('falls back to the prompt parameter when q is absent', () => {
    expect(geminiInjector.extractQuery('https://gemini.google.com/app?prompt=bar')).toBe('bar');
  });

  it('returns null when neither q nor prompt is present', () => {
    expect(geminiInjector.extractQuery('https://gemini.google.com/app')).toBeNull();
  });
});
