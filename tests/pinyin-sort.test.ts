import { describe, it, expect } from 'vitest';
import { compareByPinyin, pinyinSortKey } from '@/lib/pinyin-sort';

describe('pinyinSortKey', () => {
  it('converts CJK characters to toneless pinyin', () => {
    expect(pinyinSortKey('豆包')).toBe('doubao');
    expect(pinyinSortKey('抖音')).toBe('douyin');
    expect(pinyinSortKey('小红书')).toBe('xiaohongshu');
    expect(pinyinSortKey('哔哩哔哩')).toBe('bilibili');
  });

  it('keeps non-CJK characters as-is (lowercased)', () => {
    expect(pinyinSortKey('Baidu')).toBe('baidu');
    expect(pinyinSortKey('DuckDuckGo')).toBe('duckduckgo');
    expect(pinyinSortKey('Brave Search')).toBe('brave search');
  });

  it('interleaves CJK and non-CJK in mixed labels', () => {
    expect(pinyinSortKey('Stepfun 按量')).toBe('stepfun anliang');
    expect(pinyinSortKey('豆包搜索 Custom')).toBe('doubaosousuo custom');
  });

  it('handles empty input', () => {
    expect(pinyinSortKey('')).toBe('');
  });
});

describe('compareByPinyin', () => {
  it('sorts Chinese and Latin sources by spelling so they interleave', () => {
    const labels = ['Exa', 'Google', 'Bing', 'Baidu', '抖音', '小红书', '哔哩哔哩', 'Yandex', 'DuckDuckGo', '豆包'];
    const sorted = [...labels].sort(compareByPinyin);
    // 期望：Baidu, 哔哩哔哩(bilibili), Bing, 豆包(doubao), 抖音(douyin), DuckDuckGo, Exa, Google, 小红书(xiaohongshu), Yandex
    expect(sorted).toEqual(['Baidu', '哔哩哔哩', 'Bing', '豆包', '抖音', 'DuckDuckGo', 'Exa', 'Google', '小红书', 'Yandex']);
  });

  it('treats Latin labels case-insensitively at the key level', () => {
    expect(pinyinSortKey('bing')).toBe('bing');
    expect(pinyinSortKey('Bing')).toBe('bing');
    // 主键相同时由原串 localeCompare 兜底保证稳定；二者都排在 Baidu(key=baidu) 之后。
    const sorted = [...['Bing', 'baidu', 'Baidu']].sort(compareByPinyin);
    expect(sorted.indexOf('Bing')).toBe(2);
    expect(sorted.slice(0, 2)).toEqual(expect.arrayContaining(['baidu', 'Baidu']));
  });

  it('orders 豆包 before 豆包搜索 Custom (prefix first)', () => {
    expect(compareByPinyin('豆包', '豆包搜索 Custom')).toBeLessThan(0);
  });
});
